import { type Context, Hono } from "hono";
import { purgeSessionCache } from "../cache";
import { errorMessage } from "../errors";
import { requireAccess } from "../middleware/access";
import { clampInt } from "../middleware/rate-limit";
import { ensureDatabaseTables } from "../presets";
import { regenerateSession } from "../services/regenerate";
import { escapeLike } from "../services/session-queries";
import type { Env } from "../types";

interface AppEnv {
  Bindings: Env;
  Variables: { adminEmail: string };
}

const app = new Hono<AppEnv>();

app.use("*", requireAccess);
app.use("*", async (c, next) => {
  await ensureDatabaseTables(c.env.DB);
  await next();
});

const PAGE_SIZE = 30;

interface AdminSessionRow {
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  hiddenAt: string | null;
  id: string;
  messageCount: number;
  sourceUrl: string;
}

// 管理用の一覧 (非表示も含む)。q はタイトルまたはURLの部分一致
app.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const hiddenOnly = c.req.query("hidden") === "1";
  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (q) {
    conditions.push("(article_title LIKE ? ESCAPE '\\' OR source_url LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(q)}%`;
    binds.push(pattern, pattern);
  }
  if (hiddenOnly) {
    conditions.push("hidden_at IS NOT NULL");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM sessions ${where}`)
    .bind(...binds)
    .first<{ count: number }>();
  const total = countRow?.count ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const page = Math.min(clampInt(c.req.query("page"), 1, 100_000, 1), totalPages);

  const { results } = await c.env.DB.prepare(
    `SELECT id, article_title as articleTitle, source_url as sourceUrl, genre, created_at as createdAt,
            hidden_at as hiddenAt,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id) as messageCount
     FROM sessions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    .all<AdminSessionRow>();

  return c.json({ sessions: results, page, total, totalPages });
});

async function setHidden(c: Context<AppEnv>, hidden: boolean) {
  const id = c.req.param("id") ?? "";
  const result = await c.env.DB.prepare("UPDATE sessions SET hidden_at = ? WHERE id = ?")
    .bind(hidden ? new Date().toISOString() : null, id)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "対談が見つかりません" }, 404);
  }
  // 非表示にしたら、エッジのコピーも消す。復元の場合も、古い「見つかりません」を残さない
  try {
    c.executionCtx.waitUntil(purgeSessionCache(new URL(c.req.url).origin, id));
  } catch {
    // executionCtx がない環境では、有効期限で切れる
  }
  return c.json({ success: true });
}

// 要約・ジャンル・参加者を取り直し、発言と記憶を消して未生成に戻す。生成は、対談ページを開くと始まる
app.post("/:id/regenerate", async (c) => {
  const id = c.req.param("id");
  let result: Awaited<ReturnType<typeof regenerateSession>>;
  try {
    result = await regenerateSession(c.env, id);
  } catch (err) {
    console.error("Session regeneration failed:", err);
    return c.json({ error: `再生成に失敗しました: ${errorMessage(err)}` }, 500);
  }
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  try {
    c.executionCtx.waitUntil(purgeSessionCache(new URL(c.req.url).origin, id));
  } catch {
    // executionCtx がない環境では、有効期限で切れる
  }
  return c.json({ success: true, sessionId: id, genre: result.genre, scraped: result.scraped });
});

app.post("/:id/hide", (c) => setHidden(c, true));
app.post("/:id/restore", (c) => setHidden(c, false));

export default app;
