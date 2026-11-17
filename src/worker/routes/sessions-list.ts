import { type Context, Hono } from "hono";
import { stream } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { cacheFor } from "../cache";
import type { ExistingSessionRow } from "../db-types";
import { errorMessage } from "../errors";
import { clampInt, rateLimit } from "../middleware/rate-limit";
import { ADULT_MESSAGE, isAdultHost } from "../services/adult-filter";
import { trackEvent } from "../services/analytics-track";
import { analyzeArticle, buildArticleSummary, defaultTurns } from "../services/analyze";
import { DEFAULT_GENRE } from "../services/genres";
import { MEMORY_MIN_SCORE, searchSimilarMemories } from "../services/memory";
import { listPersonaCandidates } from "../services/persona-store";
import { ScrapeError, scrapeUrl } from "../services/scraper";
import {
  countSessionMessages,
  deleteEmptySession,
  findSessionByNormalizedUrl,
  insertSession,
  listSessions,
  PAGE_SIZE,
  toSession,
} from "../services/session-queries";
import { countTodaySessions, getDailyLimit } from "../services/settings";
import {
  displayTheme,
  heatedSourceUrl,
  isUnresearchedThemeSummary,
  THEME_MAX_CHARS,
  themeSourceUrl,
} from "../services/theme";
import { researchTheme } from "../services/theme-research";
import { normalizeUrl } from "../services/url-normalize";
import type { Env, SessionMode } from "../types";

/** Accept にこれを付けた POST には、進行状況を1行1JSONで順に返す */
const PROGRESS_CONTENT_TYPE = "application/x-ndjson";

export type CreateSessionStep = "fetching" | "researching" | "analyzing";

interface CreateOutcome {
  body: Record<string, unknown>;
  status: ContentfulStatusCode;
}

const app = new Hono<{ Bindings: Env }>();

// 対談の一覧。genre で絞り込み、ジャンル別の件数も返す
app.get("/", async (c) => {
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

/** NDJSON で進行を返しつつ create を実行する */
function streamCreate(
  c: Context<{ Bindings: Env }>,
  run: (onProgress: (step: CreateSessionStep) => Promise<void>) => Promise<CreateOutcome>,
  failLabel: string
) {
  c.header("Content-Type", PROGRESS_CONTENT_TYPE);
  c.header("Cache-Control", "no-cache, no-transform");
  return stream(c, async (s) => {
    const writeLine = (line: object) => s.writeln(JSON.stringify(line));
    let result: CreateOutcome;
    try {
      result = await run(async (step) => {
        await writeLine({ type: "progress", step });
      });
    } catch (err) {
      console.error(`Failed to create session (${failLabel}):`, err);
      result = { status: 500, body: { error: `${failLabel}: ${errorMessage(err)}` } };
    }
    await writeLine({ type: "result", ...result });
  });
}

async function postThemeSession(
  c: Context<{ Bindings: Env }>,
  rawTheme: string,
  sessionMode: "debate" | "heated"
) {
  const theme = displayTheme(rawTheme);
  if (!theme) {
    return c.json({ error: "テーマを入力してください" }, 400);
  }
  if (theme.length > THEME_MAX_CHARS) {
    return c.json({ error: `テーマは${THEME_MAX_CHARS}文字以内にしてください` }, 400);
  }
  const sourceKey = sessionMode === "heated" ? heatedSourceUrl(theme) : themeSourceUrl(theme);
  const existing = await findSessionByNormalizedUrl(c.env.DB, sourceKey);
  if (existing) {
    const hiddenLabel = sessionMode === "heated" ? "このテーマの激論は公開されていません" : "このテーマの論戦は公開されていません";
    // 調査失敗だけの未生成セッションは捨てて作り直す (薄い結果の固定化を防ぐ)
    if (
      !existing.hiddenAt &&
      isUnresearchedThemeSummary(existing.articleSummary) &&
      (await countSessionMessages(c.env.DB, existing.id)) === 0
    ) {
      await deleteEmptySession(c.env.DB, existing.id);
    } else {
      const outcome = existingOutcome(existing, hiddenLabel);
      return c.json(outcome.body, outcome.status);
    }
  }
  const limitOutcome = await enforceCreateLimits(c);
  if (limitOutcome) {
    return limitOutcome;
  }
  const failLabel = sessionMode === "heated" ? "激論の準備に失敗しました" : "論戦の準備に失敗しました";
  if (!c.req.header("accept")?.includes(PROGRESS_CONTENT_TYPE)) {
    const outcome = await createFromTheme(c.env, theme, () => Promise.resolve(), sessionMode);
    return c.json(outcome.body, outcome.status);
  }
  return streamCreate(c, (onProgress) => createFromTheme(c.env, theme, onProgress, sessionMode), failLabel);
}

async function postUrlSession(c: Context<{ Bindings: Env }>, rawUrl: string) {
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(rawUrl);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }

  // 成人向けのドメインは、取得も分析もせずに断る (外部アクセス・LLMのコストをかけない)
  if (isAdultHost(new URL(normalizedUrl).hostname)) {
    trackEvent(c.env, "adult_blocked");
    return c.json({ error: ADULT_MESSAGE }, 400);
  }

  // 1. 同じページの対談が既にあれば取得せずそれを返す
  const existing = await findSessionByNormalizedUrl(c.env.DB, normalizedUrl);
  if (existing) {
    const outcome = existingOutcome(existing);
    return c.json(outcome.body, outcome.status);
  }

  const limitOutcome = await enforceCreateLimits(c);
  if (limitOutcome) {
    return limitOutcome;
  }

  if (!c.req.header("accept")?.includes(PROGRESS_CONTENT_TYPE)) {
    const outcome = await createFromUrl(c.env, rawUrl, normalizedUrl, () => Promise.resolve());
    return c.json(outcome.body, outcome.status);
  }

  // 取得と分析は数十秒かかるので、進むたびに1行ずつ返す。
  // ヘッダーは最初の行で確定するため、ここから先の失敗は最終行の status で伝える
  return streamCreate(
    c,
    (onProgress) => createFromUrl(c.env, rawUrl, normalizedUrl, onProgress),
    "対談の準備に失敗しました"
  );
}

// 新規対談セッション作成: URL または theme (排他)。要約・ジャンル・参加ペルソナ・発言数は自動で決める
app.post("/", async (c) => {
  const body = await c.req
    .json<{ url?: string; theme?: string; heated?: boolean }>()
    .catch(() => ({}) as { url?: string; theme?: string; heated?: boolean });

  const hasUrl = typeof body.url === "string" && body.url.trim().length > 0;
  const hasTheme = typeof body.theme === "string" && body.theme.trim().length > 0;
  if (hasUrl === hasTheme) {
    return c.json({ error: "URLかテーマのどちらか一方を指定してください" }, 400);
  }
  if (hasTheme) {
    return postThemeSession(c, body.theme ?? "", body.heated === true ? "heated" : "debate");
  }
  return postUrlSession(c, body.url ?? "");
});

/** 日次上限と IP レート制限。断るときは Response、通すときは null */
async function enforceCreateLimits(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const [dailyLimit, todayCount] = await Promise.all([getDailyLimit(c.env.DB), countTodaySessions(c.env.DB)]);
  if (todayCount >= dailyLimit) {
    trackEvent(c.env, "daily_limit_reached");
    return c.json(
      { error: "本日の新しい対談の上限に達しました。日本時間の0時を過ぎてからもう一度お試しください。" },
      429
    );
  }

  return (
    (await rateLimit(c, "create", 10, 3600)) ??
    // 1日の上限。日本時間の0時で区切る (UTC+9 = 32400秒)
    (await rateLimit(c, "create-day", 30, 86_400, 9 * 3600))
  );
}

/** 既に対談があるURL / テーマへの応答 */
function existingOutcome(row: ExistingSessionRow, hiddenMessage = "この記事の対談は公開されていません"): CreateOutcome {
  if (row.hiddenAt) {
    return { status: 409, body: { error: hiddenMessage } };
  }
  const s = toSession(row);
  return {
    status: 200,
    body: {
      existing: true,
      sessionId: s.id,
      genre: s.genre ?? DEFAULT_GENRE,
      articleTitle: s.articleTitle,
      mode: s.mode,
    },
  };
}

/** 記事の取得から保存まで。各段階の開始時に onProgress を呼ぶ */
async function createFromUrl(
  env: Env,
  sourceUrl: string,
  normalizedUrl: string,
  onProgress: (step: CreateSessionStep) => Promise<void>
): Promise<CreateOutcome> {
  // 2. URLから記事内容・OGPを抽出
  await onProgress("fetching");
  let article: Awaited<ReturnType<typeof scrapeUrl>>;
  try {
    article = await scrapeUrl(sourceUrl);
  } catch (err) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return { status, body: { error: `記事の取得に失敗しました: ${errorMessage(err)}` } };
  }

  // リダイレクト先のドメイン、またはページ自身の成人向け宣言
  if (article.adultRated || isAdultHost(new URL(article.url).hostname)) {
    trackEvent(env, "adult_blocked");
    return { status: 400, body: { error: ADULT_MESSAGE } };
  }

  // canonical / リダイレクト後のURLで一致する既存対談があればそれを返す
  if (article.normalizedUrl !== normalizedUrl) {
    const dup = await findSessionByNormalizedUrl(env.DB, article.normalizedUrl);
    if (dup) {
      return existingOutcome(dup);
    }
  }

  const candidates = await listPersonaCandidates(env.DB);
  if (candidates.length === 0) {
    return { status: 409, body: { error: "対談に参加できるペルソナがいません。管理画面でペルソナを追加してください" } };
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  // 3. 要約・ジャンル・参加ペルソナの決定と、過去の類似対談記憶の検索
  await onProgress("analyzing");
  const [analysis, pastMemories] = await Promise.all([
    analyzeArticle(env, sessionId, article, candidates),
    searchSimilarMemories(
      `${article.title}
${article.content.slice(0, 300)}`,
      env,
      3,
      MEMORY_MIN_SCORE
    ),
  ]);

  // 記事の内容が成人向けと判定されたら、保存せずに断る
  if (analysis.adult) {
    trackEvent(env, "adult_blocked");
    return { status: 400, body: { error: ADULT_MESSAGE } };
  }

  // 4. セッションをD1に保存
  await insertSession(env.DB, {
    id: sessionId,
    sourceUrl: article.url,
    normalizedUrl: article.normalizedUrl,
    articleTitle: article.title,
    articleSummary: buildArticleSummary(analysis, article.content),
    summary: analysis.summary,
    genre: analysis.genre,
    mode: "article",
    ogJson: JSON.stringify(article.ogp),
    personaIds: JSON.stringify(analysis.personaIds),
    createdAt: now,
  });

  trackEvent(env, "dialogue_created");
  return {
    status: 200,
    body: {
      existing: false,
      sessionId,
      genre: analysis.genre,
      articleTitle: article.title,
      mode: "article",
      totalTurns: defaultTurns(analysis.personaIds.length),
      pastMemories: pastMemories.map((m) => ({
        sessionId: m.sessionId,
        articleTitle: m.articleTitle,
        topicSummary: m.topicSummary,
        score: Math.round(m.score * 100) / 100,
      })),
    },
  };
}

/** テーマ調査から論戦 / 激論セッションを保存する */
async function createFromTheme(
  env: Env,
  theme: string,
  onProgress: (step: CreateSessionStep) => Promise<void>,
  sessionMode: Extract<SessionMode, "debate" | "heated"> = "debate"
): Promise<CreateOutcome> {
  const normalizedThemeUrl = sessionMode === "heated" ? heatedSourceUrl(theme) : themeSourceUrl(theme);
  const candidates = await listPersonaCandidates(env.DB);
  if (candidates.length === 0) {
    return { status: 409, body: { error: "対談に参加できるペルソナがいません。管理画面でペルソナを追加してください" } };
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  await onProgress("researching");
  const research = await researchTheme(theme, env, sessionId, candidates, normalizedThemeUrl);

  if (research.analysis.adult) {
    trackEvent(env, "adult_blocked");
    return { status: 400, body: { error: ADULT_MESSAGE } };
  }

  await onProgress("analyzing");
  const pastMemories = await searchSimilarMemories(
    `${research.title}\n${research.analysis.summary}`,
    env,
    3,
    MEMORY_MIN_SCORE
  );

  await insertSession(env.DB, {
    id: sessionId,
    sourceUrl: normalizedThemeUrl,
    normalizedUrl: normalizedThemeUrl,
    articleTitle: research.title,
    articleSummary: research.articleSummary,
    summary: research.analysis.summary,
    genre: research.analysis.genre,
    mode: sessionMode,
    ogJson: JSON.stringify(research.ogp),
    personaIds: JSON.stringify(research.analysis.personaIds),
    createdAt: now,
  });

  trackEvent(env, "dialogue_created");
  return {
    status: 200,
    body: {
      existing: false,
      sessionId,
      genre: research.analysis.genre,
      articleTitle: research.title,
      mode: sessionMode,
      researched: research.researched,
      totalTurns: defaultTurns(research.analysis.personaIds.length),
      pastMemories: pastMemories.map((m) => ({
        sessionId: m.sessionId,
        articleTitle: m.articleTitle,
        topicSummary: m.topicSummary,
        score: Math.round(m.score * 100) / 100,
      })),
    },
  };
}

export default app;
