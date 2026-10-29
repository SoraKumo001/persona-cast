import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Env } from "../types";
import { cacheFor } from "../cache";
import { clampInt, rateLimit } from "../middleware/rate-limit";
import { ADULT_MESSAGE, isAdultHost } from "../services/adult-filter";
import { countTodaySessions, getDailyLimit } from "../services/settings";
import { scrapeUrl, ScrapeError } from "../services/scraper";
import { normalizeUrl } from "../services/url-normalize";
import { analyzeArticle, defaultTurns, PersonaCandidate } from "../services/analyze";
import { DEFAULT_GENRE } from "../services/genres";
import { PAGE_SIZE, SESSION_COLUMNS, getSessionDetail, listSessions, toSession } from "../services/session-queries";
import { searchSimilarMemories } from "../services/memory";
import { orchestrateDialogue } from "../services/dialogue";
import { getSessionOgpImage } from "../services/ogp-image";
import { ensureDatabaseTables } from "../presets";

const app = new Hono<{ Bindings: Env }>();

async function findSessionByNormalizedUrl(db: D1Database, normalizedUrl: string) {
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE normalized_url = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(normalizedUrl)
    .first();
}

// 対談の一覧。genre で絞り込み、ジャンル別の件数も返す
app.get("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  try {
    // 新しい対談が増えるので短く。管理操作で壊れた表示も1分で戻る
    cacheFor(60, { maxAge: 30 });
    return c.json(
      await listSessions(c.env.DB, {
        genre: c.req.query("genre"),
        page: clampInt(c.req.query("page"), 1, 100_000, 1),
        pageSize: clampInt(c.req.query("limit"), 1, 100, PAGE_SIZE),
      })
    );
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return c.json({ sessions: [], genres: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
  }
});

// セッション詳細と発言ログの取得
app.get("/:id", async (c) => {
  const detail = await getSessionDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json({ error: "セッションが見つかりません" }, 404);
  // 発言が保存された対談は変わらない。生成中・生成前は載せない
  if (detail.messages.length > 0) cacheFor(600, { maxAge: 60 });
  return c.json(detail);
});

// 対談ごとのOGP画像 (1200x630 PNG)。SNS/チャットのリンクプレビュー用
app.get("/:id/ogp.png", async (c) => {
  try {
    const png = await getSessionOgpImage(c.env, c.req.param("id"));
    if (!png) return c.json({ error: "セッションが見つかりません" }, 404);
    cacheFor(3600, { maxAge: 3600 });
    return new Response(png as BodyInit, { headers: { "Content-Type": "image/png" } });
  } catch (err: any) {
    console.error("OGP image generation failed:", err);
    return c.json({ error: "OGP画像の生成に失敗しました" }, 500);
  }
});

// 新規対談セッション作成: 入力はURLだけ。要約・ジャンル・参加ペルソナ・発言数は自動で決める
app.post("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });

  if (!body.url) {
    return c.json({ error: "URLは必須です" }, 400);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(body.url);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  // 成人向けのドメインは、取得も分析もせずに断る (外部アクセス・LLMのコストをかけない)
  if (isAdultHost(new URL(normalizedUrl).hostname)) return c.json({ error: ADULT_MESSAGE }, 400);

  // 1. 同じページの対談が既にあれば取得せずそれを返す
  const existingResponse = (row: any) => {
    const s = toSession(row);
    return c.json({
      existing: true,
      sessionId: s.id,
      genre: s.genre ?? DEFAULT_GENRE,
      articleTitle: s.articleTitle,
    });
  };
  const existing = await findSessionByNormalizedUrl(c.env.DB, normalizedUrl);
  if (existing) return existingResponse(existing);

  // 1日に作れる対談の総数 (管理者が設定。既定1000)。IPごとの制限より先に確認し、断られた送信は回数に数えない
  const [dailyLimit, todayCount] = await Promise.all([getDailyLimit(c.env.DB), countTodaySessions(c.env.DB)]);
  if (todayCount >= dailyLimit) {
    return c.json({ error: "本日の新しい対談の上限に達しました。日本時間の0時を過ぎてからもう一度お試しください。" }, 429);
  }

  // 新しい記事の取得 (外部アクセス + LLM) だけを制限する。保存済みの対談を開くだけなら対象外
  const limited =
    (await rateLimit(c, "create", 10, 3600)) ??
    // 1日の上限。日本時間の0時で区切る (UTC+9 = 32400秒)
    (await rateLimit(c, "create-day", 30, 86400, 9 * 3600));
  if (limited) return limited;

  // 2. URLから記事内容・OGPを抽出
  let article;
  try {
    article = await scrapeUrl(body.url);
  } catch (err: any) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return c.json({ error: `記事の取得に失敗しました: ${err.message}` }, status);
  }

  // リダイレクト先のドメイン、またはページ自身の成人向け宣言
  if (article.adultRated || isAdultHost(new URL(article.url).hostname)) {
    return c.json({ error: ADULT_MESSAGE }, 400);
  }

  // canonical / リダイレクト後のURLで一致する既存対談があればそれを返す
  if (article.normalizedUrl !== normalizedUrl) {
    const dup = await findSessionByNormalizedUrl(c.env.DB, article.normalizedUrl);
    if (dup) return existingResponse(dup);
  }

  const { results: candidates } = await c.env.DB.prepare(
    `SELECT id, name, role, personality,
            (SELECT COUNT(*) FROM sessions s WHERE s.persona_ids LIKE '%"' || personas.id || '"%') AS appearances
     FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC`
  ).all<PersonaCandidate>();
  if (candidates.length === 0) {
    return c.json({ error: "対談に参加できるペルソナがいません。管理画面でペルソナを追加してください" }, 409);
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  // 3. 要約・ジャンル・参加ペルソナの決定と、過去の類似対談記憶の検索
  const [analysis, pastMemories] = await Promise.all([
    analyzeArticle(c.env, sessionId, article, candidates),
    searchSimilarMemories(`${article.title}
${article.content.slice(0, 300)}`, c.env, 3, 0.45),
  ]);

  // 記事の内容が成人向けと判定されたら、保存せずに断る
  if (analysis.adult) return c.json({ error: ADULT_MESSAGE }, 400);

  // 4. セッションをD1に保存
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, source_url, normalized_url, article_title, article_summary, summary, genre, og_json, persona_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      article.url,
      article.normalizedUrl,
      article.title,
      article.content.slice(0, 3000), // 長すぎないよう保存
      analysis.summary,
      analysis.genre,
      JSON.stringify(article.ogp),
      JSON.stringify(analysis.personaIds),
      now
    )
    .run();

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

// SSEによるリアルタイム対談ストリーミング
// 対談の生成 (SSE)。生成済みの対談は作り直せない。発言数は人数から決め、モデルは固定 (クライアントからは指定できない)
app.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);

  const session: any = await c.env.DB.prepare(
    `SELECT persona_ids as personaIds, (SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id) as messageCount
     FROM sessions WHERE id = ?`
  )
    .bind(sessionId)
    .first();
  if (!session) return c.json({ error: "セッションが見つかりません" }, 404);
  if (session.messageCount > 0) return c.json({ error: "この対談は生成済みです" }, 409);

  const limited = await rateLimit(c, "stream", 20, 3600);
  if (limited) return limited;

  // 同じ対談を同時に生成させない (生成中の印を原子的に付ける。10分以上前の印は失効扱い)
  const now = new Date();
  const claim = await c.env.DB.prepare(
    "UPDATE sessions SET generating_at = ? WHERE id = ? AND (generating_at IS NULL OR generating_at < ?)"
  )
    .bind(now.toISOString(), sessionId, new Date(now.getTime() - 10 * 60 * 1000).toISOString())
    .run();
  if (!claim.meta.changes) return c.json({ error: "この対談は生成中です" }, 409);

  const totalTurns = defaultTurns(JSON.parse(session.personaIds || "[]").length);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of orchestrateDialogue(sessionId, c.env, totalTurns)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      }
      // 一覧のサムネイル用に、対談の完了後にOGP画像を先に生成してキャッシュしておく
      try {
        c.executionCtx.waitUntil(getSessionOgpImage(c.env, sessionId).catch((e) => console.warn("OGP prewarm failed:", e)));
      } catch {
        // executionCtx がない環境では、初回リクエスト時に生成される
      }
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err.message || "Unknown error" }),
      });
    } finally {
      // 失敗して発言が1件もなければ、やり直せるように印を外す
      await c.env.DB.prepare("UPDATE sessions SET generating_at = NULL WHERE id = ?").bind(sessionId).run().catch(() => {});
    }
  });
});

export default app;
