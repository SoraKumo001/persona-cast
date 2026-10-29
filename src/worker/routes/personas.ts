import { Hono } from "hono";
import { cacheFor } from "../cache";
import type { PersonaRow } from "../db-types";
import { DEFAULT_PERSONAS, ensureDatabaseTables } from "../presets";
import { PERSONA_COLUMNS, toPersona } from "../services/persona-store";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// ペルソナ一覧取得 (公開・アーカイブ済みは除く)
app.get("/", async (c) => {
  try {
    if (c.env.DB) {
      await ensureDatabaseTables(c.env.DB);
      const { results } = await c.env.DB.prepare(
        `SELECT ${PERSONA_COLUMNS} FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC`
      ).all<PersonaRow>();

      if (results && results.length > 0) {
        cacheFor(60, { maxAge: 30 });
        return c.json({ personas: results.map(toPersona) });
      }
    }
  } catch (err) {
    console.warn("DB query for personas failed, falling back to presets:", err);
  }

  // フォールバック: デフォルトプリセットを返却
  return c.json({ personas: DEFAULT_PERSONAS });
});

// アバター画像の配信 (R2)
app.get("/:id/avatar", async (c) => {
  if (!(c.env.AVATARS && c.env.DB)) {
    return c.notFound();
  }
  const row = await c.env.DB.prepare("SELECT avatar_key FROM personas WHERE id = ? AND avatar_type = 'image'")
    .bind(c.req.param("id"))
    .first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) {
    return c.notFound();
  }

  const object = await c.env.AVATARS.get(row.avatar_key);
  if (!object) {
    return c.notFound();
  }

  const etag = object.httpEtag;
  if (c.req.header("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  // URL の ?v= に内容のハッシュが入るので、長期キャッシュしてよい (エッジにも置く)
  cacheFor(31_536_000, { maxAge: 31_536_000, immutable: true });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export default app;
