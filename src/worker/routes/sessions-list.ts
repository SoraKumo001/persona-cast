import { Hono } from "hono";
import { cacheFor } from "../cache";
import type { ExistingSessionRow } from "../db-types";
import { errorMessage } from "../errors";
import { clampInt, rateLimit } from "../middleware/rate-limit";
import { ensureDatabaseTables } from "../presets";
import { ADULT_MESSAGE, isAdultHost } from "../services/adult-filter";
import { trackEvent } from "../services/analytics-track";
import { analyzeArticle, defaultTurns } from "../services/analyze";
import { DEFAULT_GENRE } from "../services/genres";
import { searchSimilarMemories } from "../services/memory";
import { listPersonaCandidates } from "../services/persona-store";
import { ScrapeError, scrapeUrl } from "../services/scraper";
import {
  findSessionByNormalizedUrl,
  insertSession,
  listSessions,
  PAGE_SIZE,
  toSession,
} from "../services/session-queries";
import { countTodaySessions, getDailyLimit } from "../services/settings";
import { normalizeUrl } from "../services/url-normalize";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// 対談の一覧。genre で絞り込み、ジャンル別の件数も返す
app.get("/", async (c) => {
  if (c.env.DB) {
    await ensureDatabaseTables(c.env.DB);
  }
  try {
    // 新しい対談が増えるので短く。管理操作で壊れた表示も1分で戻る
    cacheFor(15);
    return c.json(
      await listSessions(c.env.DB, {
        genre: c.req.query("genre"),
        q: c.req.query("q"),
        page: clampInt(c.req.query("page"), 1, 100_000, 1),
        pageSize: clampInt(c.req.query("limit"), 1, 100, PAGE_SIZE),
      })
    );
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return c.json({ sessions: [], genres: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
  }
});

// 新規対談セッション作成: 入力はURLだけ。要約・ジャンル・参加ペルソナ・発言数は自動で決める
app.post("/", async (c) => {
  if (c.env.DB) {
    await ensureDatabaseTables(c.env.DB);
  }
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });

  if (!body.url) {
    return c.json({ error: "URLは必須です" }, 400);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(body.url);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }

  // 成人向けのドメインは、取得も分析もせずに断る (外部アクセス・LLMのコストをかけない)
  if (isAdultHost(new URL(normalizedUrl).hostname)) {
    trackEvent(c.env, "adult_blocked");
    return c.json({ error: ADULT_MESSAGE }, 400);
  }

  // 1. 同じページの対談が既にあれば取得せずそれを返す
  const existingResponse = (row: ExistingSessionRow) => {
    if (row.hiddenAt) {
      return c.json({ error: "この記事の対談は公開されていません" }, 409);
    }
    const s = toSession(row);
    return c.json({
      existing: true,
      sessionId: s.id,
      genre: s.genre ?? DEFAULT_GENRE,
      articleTitle: s.articleTitle,
    });
  };
  const existing = await findSessionByNormalizedUrl(c.env.DB, normalizedUrl);
  if (existing) {
    return existingResponse(existing);
  }

  // 1日に作れる対談の総数 (管理者が設定。既定1000)。IPごとの制限より先に確認し、断られた送信は回数に数えない
  const [dailyLimit, todayCount] = await Promise.all([getDailyLimit(c.env.DB), countTodaySessions(c.env.DB)]);
  if (todayCount >= dailyLimit) {
    trackEvent(c.env, "daily_limit_reached");
    return c.json(
      { error: "本日の新しい対談の上限に達しました。日本時間の0時を過ぎてからもう一度お試しください。" },
      429
    );
  }

  // 新しい記事の取得 (外部アクセス + LLM) だけを制限する。保存済みの対談を開くだけなら対象外
  const limited =
    (await rateLimit(c, "create", 10, 3600)) ??
    // 1日の上限。日本時間の0時で区切る (UTC+9 = 32400秒)
    (await rateLimit(c, "create-day", 30, 86_400, 9 * 3600));
  if (limited) {
    return limited;
  }

  // 2. URLから記事内容・OGPを抽出
  let article: Awaited<ReturnType<typeof scrapeUrl>>;
  try {
    article = await scrapeUrl(body.url);
  } catch (err) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return c.json({ error: `記事の取得に失敗しました: ${errorMessage(err)}` }, status);
  }

  // リダイレクト先のドメイン、またはページ自身の成人向け宣言
  if (article.adultRated || isAdultHost(new URL(article.url).hostname)) {
    trackEvent(c.env, "adult_blocked");
    return c.json({ error: ADULT_MESSAGE }, 400);
  }

  // canonical / リダイレクト後のURLで一致する既存対談があればそれを返す
  if (article.normalizedUrl !== normalizedUrl) {
    const dup = await findSessionByNormalizedUrl(c.env.DB, article.normalizedUrl);
    if (dup) {
      return existingResponse(dup);
    }
  }

  const candidates = await listPersonaCandidates(c.env.DB);
  if (candidates.length === 0) {
    return c.json({ error: "対談に参加できるペルソナがいません。管理画面でペルソナを追加してください" }, 409);
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  // 3. 要約・ジャンル・参加ペルソナの決定と、過去の類似対談記憶の検索
  const [analysis, pastMemories] = await Promise.all([
    analyzeArticle(c.env, sessionId, article, candidates),
    searchSimilarMemories(
      `${article.title}
${article.content.slice(0, 300)}`,
      c.env,
      3,
      0.45
    ),
  ]);

  // 記事の内容が成人向けと判定されたら、保存せずに断る
  if (analysis.adult) {
    trackEvent(c.env, "adult_blocked");
    return c.json({ error: ADULT_MESSAGE }, 400);
  }

  // 4. セッションをD1に保存
  await insertSession(c.env.DB, {
    id: sessionId,
    sourceUrl: article.url,
    normalizedUrl: article.normalizedUrl,
    articleTitle: article.title,
    articleSummary: article.content.slice(0, 3000), // 長すぎないよう保存
    summary: analysis.summary,
    genre: analysis.genre,
    ogJson: JSON.stringify(article.ogp),
    personaIds: JSON.stringify(analysis.personaIds),
    createdAt: now,
  });

  trackEvent(c.env, "dialogue_created");
  return c.json({
    existing: false,
    sessionId,
    genre: analysis.genre,
    articleTitle: article.title,
    totalTurns: defaultTurns(analysis.personaIds.length),
    pastMemories: pastMemories.map((m) => ({
      sessionId: m.sessionId,
      articleTitle: m.articleTitle,
      topicSummary: m.topicSummary,
      score: Math.round(m.score * 100) / 100,
    })),
  });
});

export default app;
