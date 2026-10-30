import { Hono } from "hono";
import type { PersonaRow } from "../db-types";
import { errorMessage } from "../errors";
import { requireAccess } from "../middleware/access";
import {
  generatePersonaDraft,
  INSTRUCTION_MAX_CHARS,
  isLlmConfigured,
  type PersonaDraft,
} from "../services/persona-generate";
import { PERSONA_COLUMNS, toPersona } from "../services/persona-store";
import type { Env, Persona } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>();

app.use("*", requireAccess);

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

const AVATAR_TYPES: Record<string, { ext: string; matches: (b: Uint8Array) => boolean }> = {
  "image/png": {
    ext: "png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  "image/jpeg": { ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": {
    ext: "webp",
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
};

function validate(body: Partial<Persona>, partial: boolean): string | null {
  const required = ["name", "personality", "speakingStyle"] as const;
  if (!partial) {
    for (const k of required) {
      if (!body[k]) {
        return "名前、性格、口調は必須です";
      }
    }
  }
  for (const k of required) {
    if (k in body && !body[k]) {
      return `${k} は空にできません`;
    }
  }
  if (body.themeColor && !HEX_COLOR.test(body.themeColor)) {
    return "テーマ色は #RRGGBB 形式で指定してください";
  }
  return null;
}

async function loadPersona(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id = ?`).bind(id).first<PersonaRow>();
  return row ? toPersona(row) : null;
}

// 管理用一覧 (アーカイブ済みも含む)
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${PERSONA_COLUMNS} FROM personas ORDER BY created_at ASC`
  ).all<PersonaRow>();
  return c.json({ personas: results.map(toPersona) });
});

// AIによるペルソナ生成: 指示から下書きを返す(保存はしない)。base があれば、その内容を指示で修正する
app.post("/generate", async (c) => {
  if (!isLlmConfigured(c.env)) {
    return c.json({ error: "LLM (OPENCODE_API_KEY) が未設定のため、AI生成は使えません" }, 503);
  }
  const body = await c.req
    .json<{ instruction?: string; base?: Partial<PersonaDraft> }>()
    .catch(() => ({}) as { instruction?: string; base?: Partial<PersonaDraft> });
  const instruction = body.instruction?.trim();
  if (!instruction) {
    return c.json({ error: "指示を入力してください" }, 400);
  }
  if (instruction.length > INSTRUCTION_MAX_CHARS) {
    return c.json({ error: `指示は${INSTRUCTION_MAX_CHARS}文字以内にしてください` }, 400);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT name, role, theme_color as themeColor FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC"
  ).all<{ name: string; role: string; themeColor: string }>();
  // 修正対象の本人は「被らないようにする」一覧から外す
  const others = results.filter((p) => p.name !== body.base?.name);

  try {
    const draft = await generatePersonaDraft(c.env, instruction, body.base ?? null, others);
    return c.json({ draft });
  } catch (err) {
    console.error("Persona generation failed:", err);
    return c.json({ error: errorMessage(err, "生成に失敗しました") }, 502);
  }
});

app.post("/", async (c) => {
  const body = await c.req.json<Partial<Persona>>();
  const error = validate(body, false);
  if (error) {
    return c.json({ error }, 400);
  }

  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO personas (id, name, role, avatar, avatar_type, theme_color, personality, speaking_style, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'emoji', ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name,
      body.role || "コメンテーター",
      body.avatar || "🎙️",
      body.themeColor || "#3b82f6",
      body.personality,
      body.speakingStyle,
      now,
      now
    )
    .run();

  return c.json({ persona: await loadPersona(c.env.DB, id) }, 201);
});

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<Persona>>();
  const error = validate(body, true);
  if (error) {
    return c.json({ error }, 400);
  }

  const fields: Record<string, string | undefined> = {
    name: body.name,
    role: body.role,
    avatar: body.avatar,
    theme_color: body.themeColor,
    personality: body.personality,
    speaking_style: body.speakingStyle,
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as [string, string][];
  const sets = [...entries.map(([k]) => `${k} = ?`), "updated_at = ?"];
  const result = await c.env.DB.prepare(`UPDATE personas SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...entries.map(([, v]) => v), new Date().toISOString(), id)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "ペルソナが見つかりません" }, 404);
  }

  return c.json({ persona: await loadPersona(c.env.DB, id) });
});

// 論理削除 (過去の発言が persona_id を参照するため物理削除しない)
app.delete("/:id", async (c) => {
  const result = await c.env.DB.prepare("UPDATE personas SET archived_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), c.req.param("id"))
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "ペルソナが見つかりません" }, 404);
  }
  return c.json({ success: true });
});

app.post("/:id/restore", async (c) => {
  await c.env.DB.prepare("UPDATE personas SET archived_at = NULL WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ success: true });
});

// アバター画像アップロード: リクエストボディに画像バイナリ (Content-Type 必須)
app.put("/:id/avatar", async (c) => {
  if (!c.env.AVATARS) {
    return c.json({ error: "R2 (AVATARS) が未設定です" }, 503);
  }
  const id = c.req.param("id");

  const type = (c.req.header("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const spec = AVATAR_TYPES[type];
  if (!spec) {
    return c.json({ error: "PNG / JPEG / WebP のみアップロードできます" }, 415);
  }

  if (Number(c.req.header("Content-Length") || 0) > MAX_AVATAR_BYTES) {
    return c.json({ error: "画像は2MB以下にしてください" }, 413);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "画像は2MB以下にしてください" }, 413);
  }
  if (!spec.matches(bytes)) {
    return c.json({ error: "画像ファイルの内容が形式と一致しません" }, 415);
  }

  const existing = await c.env.DB.prepare("SELECT avatar_key FROM personas WHERE id = ?")
    .bind(id)
    .first<{ avatar_key: string | null }>();
  if (!existing) {
    return c.json({ error: "ペルソナが見つかりません" }, 404);
  }

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `avatars/${id}/${hash}.${spec.ext}`;

  await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare("UPDATE personas SET avatar_type = 'image', avatar_key = ?, updated_at = ? WHERE id = ?")
    .bind(key, new Date().toISOString(), id)
    .run();
  if (existing.avatar_key && existing.avatar_key !== key) {
    await c.env.AVATARS.delete(existing.avatar_key);
  }

  return c.json({ persona: await loadPersona(c.env.DB, id) });
});

// 画像アバターを取り消して絵文字に戻す
app.delete("/:id/avatar", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT avatar_key FROM personas WHERE id = ?")
    .bind(id)
    .first<{ avatar_key: string | null }>();
  if (!existing) {
    return c.json({ error: "ペルソナが見つかりません" }, 404);
  }
  await c.env.DB.prepare("UPDATE personas SET avatar_type = 'emoji', avatar_key = NULL, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
  if (existing.avatar_key && c.env.AVATARS) {
    await c.env.AVATARS.delete(existing.avatar_key);
  }
  return c.json({ success: true });
});

export default app;
