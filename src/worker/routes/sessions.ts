import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Env } from "../types";
import { cacheFor } from "../cache";
import { scrapeUrl, ScrapeError } from "../services/scraper";
import { normalizeUrl } from "../services/url-normalize";
import { analyzeArticle, defaultTurns, PersonaCandidate } from "../services/analyze";
import { DEFAULT_GENRE } from "../services/genres";
import { SESSION_COLUMNS, getSessionDetail, listSessions, toSession } from "../services/session-queries";
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
      await listSessions(c.env.DB, { genre: c.req.query("genre"), limit: parseInt(c.req.query("limit") || "48", 10) || 48 })
    );
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return c.json({ sessions: [], genres: [] });
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

  // 2. URLから記事内容・OGPを抽出
  let article;
  try {
    article = await scrapeUrl(body.url);
  } catch (err: any) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return c.json({ error: `記事の取得に失敗しました: ${err.message}` }, status);
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
app.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const totalTurns = parseInt(c.req.query("turns") || "6", 10);
  const modelName = c.req.query("model") || undefined;

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of orchestrateDialogue(sessionId, c.env, totalTurns, modelName)) {
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
    }
  });
});

export default app;
