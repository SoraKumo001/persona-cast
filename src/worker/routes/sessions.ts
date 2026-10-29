import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Env } from "../types";
import { scrapeUrl } from "../services/scraper";
import { searchSimilarMemories } from "../services/memory";
import { orchestrateDialogue } from "../services/dialogue";

const app = new Hono<{ Bindings: Env }>();

// セッション一覧取得
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, source_url as sourceUrl, article_title as articleTitle, article_summary as articleSummary, persona_ids as personaIds, created_at as createdAt FROM sessions ORDER BY created_at DESC LIMIT 30"
  ).all();

  const formatted = results.map((r: any) => ({
    ...r,
    personaIds: JSON.parse(r.personaIds || "[]"),
  }));

  return c.json({ sessions: formatted });
});

// セッション詳細と発言ログの取得
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const session: any = await c.env.DB.prepare(
    "SELECT id, source_url as sourceUrl, article_title as articleTitle, article_summary as articleSummary, persona_ids as personaIds, created_at as createdAt FROM sessions WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!session) {
    return c.json({ error: "セッションが見つかりません" }, 404);
  }

  const { results: messages } = await c.env.DB.prepare(
    `SELECT m.id, m.session_id as sessionId, m.persona_id as personaId, m.turn_index as turnIndex, 
            m.content, m.referenced_session_id as referencedSessionId, m.referenced_article_title as referencedArticleTitle,
            m.created_at as createdAt, p.name as personaName, p.avatar as personaAvatar, p.theme_color as personaThemeColor
     FROM messages m
     LEFT JOIN personas p ON m.persona_id = p.id
     WHERE m.session_id = ?
     ORDER BY m.turn_index ASC`
  )
    .bind(id)
    .all();

  return c.json({
    session: {
      ...session,
      personaIds: JSON.parse(session.personaIds || "[]"),
    },
    messages,
  });
});

// 新規対談セッション作成 (URL抽出・記憶照会)
app.post("/", async (c) => {
  const body = await c.req.json<{
    url: string;
    personaIds: string[];
    totalTurns?: number;
    modelName?: string;
  }>();

  if (!body.url) {
    return c.json({ error: "URLは必須です" }, 400);
  }
  if (!body.personaIds || body.personaIds.length === 0) {
    return c.json({ error: "少なくとも1人以上のペルソナを選択してください" }, 400);
  }

  // 1. URLから記事内容を抽出
  let article;
  try {
    article = await scrapeUrl(body.url);
  } catch (err: any) {
    return c.json({ error: `記事の取得に失敗しました: ${err.message}` }, 400);
  }

  // 2. 過去の類似対談記憶を検索 (Workers AI Embedding + Vectorize/D1)
  const pastMemories = await searchSimilarMemories(
    `${article.title}\n${article.summary}`,
    c.env,
    3,
    0.45
  );

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  // 3. セッションをD1に保存
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, source_url, article_title, article_summary, persona_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      article.url,
      article.title,
      article.content.slice(0, 3000), // 長すぎないよう保存
      JSON.stringify(body.personaIds),
      now
    )
    .run();

  return c.json({
    sessionId,
    articleTitle: article.title,
    articleSummary: article.summary,
    sourceUrl: article.url,
    personaIds: body.personaIds,
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
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err.message || "Unknown error" }),
      });
    }
  });
});

export default app;
