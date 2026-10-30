import { Hono } from "hono";
import type { MemoryChunkDbRow } from "../db-types";
import { errorMessage } from "../errors";
import { requireAccess } from "../middleware/access";
import { ensureDatabaseTables } from "../presets";
import { generateEmbedding, toVectorRecord } from "../services/memory";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>();

app.use("*", requireAccess);
app.use("*", async (c, next) => {
  await ensureDatabaseTables(c.env.DB);
  await next();
});

/** 1回の呼び出しで処理する件数 (埋め込みの生成と Vectorize への書き込みを、1回の実行に収める) */
const BATCH = 50;

function parseEmbedding(json: string | null): number[] | null {
  if (!json) {
    return null;
  }
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.length > 0 ? (v as number[]) : null;
  } catch {
    return null;
  }
}

// 記憶の件数と、再同期できる状態か
app.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as total FROM memory_chunks").first<{ total: number }>();
  return c.json({ total: row?.total ?? 0, vectorize: !!c.env.VECTORIZE });
});

// D1 の記憶を Vectorize に登録し直す。after (前回の next) の次から BATCH 件ずつ。画面が next がなくなるまで繰り返す
app.post("/resync", async (c) => {
  if (!c.env.VECTORIZE) {
    return c.json({ error: "Vectorize (VECTORIZE) が未設定です" }, 503);
  }
  const body = await c.req.json<{ after?: unknown }>().catch(() => ({}) as { after?: unknown });
  const after = typeof body.after === "string" ? body.after : "";

  const { results } = await c.env.DB.prepare(
    `SELECT id, session_id, article_title, source_url, topic_summary, key_quotes, persona_ids, embedding_json, created_at
     FROM memory_chunks WHERE id > ? ORDER BY id ASC LIMIT ?`
  )
    .bind(after, BATCH)
    .all<MemoryChunkDbRow>();
  if (results.length === 0) {
    return c.json({ processed: 0, regenerated: 0, next: null });
  }

  let regenerated = 0;
  const records: ReturnType<typeof toVectorRecord>[] = [];
  for (const row of results) {
    let embedding = parseEmbedding(row.embedding_json);
    if (!embedding) {
      // D1 に埋め込みが無い分は作り直す。本物の埋め込みが得られないときは
      // ダミーを保存せず、この行を登録対象から外す
      embedding = await generateEmbedding(`${row.article_title}\n${row.topic_summary}\n${row.key_quotes}`, c.env);
      if (!embedding) {
        console.warn("Embedding unavailable; skipping memory chunk:", row.id);
        continue;
      }
      await c.env.DB.prepare("UPDATE memory_chunks SET embedding_json = ? WHERE id = ?")
        .bind(JSON.stringify(embedding), row.id)
        .run();
      regenerated++;
    }
    let personaIds: string[] = [];
    try {
      personaIds = JSON.parse(row.persona_ids || "[]");
    } catch {
      // 壊れた値は空として扱う
    }
    records.push(
      toVectorRecord(
        {
          id: row.id,
          sessionId: row.session_id,
          articleTitle: row.article_title,
          sourceUrl: row.source_url,
          topicSummary: row.topic_summary,
          keyQuotes: row.key_quotes,
          personaIds,
        },
        embedding,
        row.created_at
      )
    );
  }

  try {
    if (records.length > 0) {
      await c.env.VECTORIZE.upsert(records);
    }
  } catch (err) {
    console.error("Memory resync failed:", err);
    return c.json({ error: `Vectorize への登録に失敗しました: ${errorMessage(err)}` }, 502);
  }

  const last = results.at(-1)?.id ?? null;
  return c.json({
    processed: results.length,
    regenerated,
    next: results.length === BATCH ? last : null,
  });
});

export default app;
