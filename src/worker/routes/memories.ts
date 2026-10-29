import { Hono } from "hono";
import { clampFloat, clampInt, rateLimit } from "../middleware/rate-limit";
import { ensureDatabaseTables } from "../presets";
import { searchSimilarMemories } from "../services/memory";
import type { Env } from "../types";

interface MemoryChunkRow {
  articleTitle: string;
  createdAt: string;
  id: string;
  keyQuotes: string;
  personaIds: string;
  sessionId: string;
  sourceUrl: string;
  topicSummary: string;
}

const app = new Hono<{ Bindings: Env }>();

// 記憶のセマンティック検索
app.get("/search", async (c) => {
  if (c.env.DB) {
    await ensureDatabaseTables(c.env.DB);
  }
  const query = c.req.query("q");
  if (!query) {
    return c.json({ error: "検索クエリ (q) を指定してください" }, 400);
  }

  if (query.length > 500) {
    return c.json({ error: "検索クエリは500文字以内にしてください" }, 400);
  }
  const limit = clampInt(c.req.query("limit"), 1, 20, 5);
  const minScore = clampFloat(c.req.query("minScore"), 0, 1, 0.35);

  // 埋め込み (Workers AI) を呼ぶので回数を制限する
  const limited = await rateLimit(c, "memory-search", 60, 60);
  if (limited) {
    return limited;
  }

  try {
    const results = await searchSimilarMemories(query, c.env, limit, minScore);
    return c.json({ query, results });
  } catch (err) {
    console.error("Memory search failed:", err);
    return c.json({ error: "検索に失敗しました" }, 500);
  }
});

// 最近蓄積された記憶チャンク一覧
app.get("/", async (c) => {
  if (c.env.DB) {
    await ensureDatabaseTables(c.env.DB);
  }
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, session_id as sessionId, article_title as articleTitle, source_url as sourceUrl,
              topic_summary as topicSummary, key_quotes as keyQuotes, persona_ids as personaIds, created_at as createdAt
       FROM memory_chunks
       ORDER BY created_at DESC
       LIMIT 30`
    ).all<MemoryChunkRow>();

    const formatted = results.map((r) => ({
      ...r,
      personaIds: JSON.parse(r.personaIds || "[]") as string[],
    }));

    return c.json({ memories: formatted });
  } catch {
    return c.json({ memories: [] });
  }
});

export default app;
