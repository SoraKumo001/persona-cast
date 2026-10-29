import { Hono } from "hono";
import { Env } from "../types";
import { searchSimilarMemories } from "../services/memory";

const app = new Hono<{ Bindings: Env }>();

// 記憶のセマンティック検索
app.get("/search", async (c) => {
  const query = c.req.query("q");
  if (!query) {
    return c.json({ error: "検索クエリ (q) を指定してください" }, 400);
  }

  const limit = parseInt(c.req.query("limit") || "5", 10);
  const minScore = parseFloat(c.req.query("minScore") || "0.35");

  try {
    const results = await searchSimilarMemories(query, c.env, limit, minScore);
    return c.json({ query, results });
  } catch (err: any) {
    return c.json({ error: `検索に失敗しました: ${err.message}` }, 500);
  }
});

// 最近蓄積された記憶チャンク一覧
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, session_id as sessionId, article_title as articleTitle, source_url as sourceUrl,
            topic_summary as topicSummary, key_quotes as keyQuotes, persona_ids as personaIds, created_at as createdAt
     FROM memory_chunks
     ORDER BY created_at DESC
     LIMIT 30`
  ).all();

  const formatted = results.map((r: any) => ({
    ...r,
    personaIds: JSON.parse(r.personaIds || "[]"),
  }));

  return c.json({ memories: formatted });
});

export default app;
