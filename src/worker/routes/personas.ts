import { Hono } from "hono";
import { Env, Persona } from "../types";
import { DEFAULT_PERSONAS, ensureDatabaseTables } from "../presets";

const app = new Hono<{ Bindings: Env }>();

// ペルソナ一覧取得
app.get("/", async (c) => {
  try {
    if (c.env.DB) {
      await ensureDatabaseTables(c.env.DB);
      const { results } = await c.env.DB.prepare(
        "SELECT id, name, role, avatar, theme_color as themeColor, personality, speaking_style as speakingStyle, created_at as createdAt FROM personas ORDER BY created_at ASC"
      ).all();

      if (results && results.length > 0) {
        return c.json({ personas: results });
      }
    }
  } catch (err) {
    console.warn("DB query for personas failed, falling back to presets:", err);
  }

  // フォールバック: デフォルトプリセットを返却
  return c.json({ personas: DEFAULT_PERSONAS });
});

// 新規ペルソナ作成
app.post("/", async (c) => {
  const body = await c.req.json<Partial<Persona>>();
  if (!body.name || !body.personality || !body.speakingStyle) {
    return c.json({ error: "名前、性格、口調は必須です" }, 400);
  }

  const id = body.id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  if (c.env.DB) {
    try {
      await ensureDatabaseTables(c.env.DB);
      await c.env.DB.prepare(
        `INSERT INTO personas (id, name, role, avatar, theme_color, personality, speaking_style, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          body.name,
          body.role || "コメンテーター",
          body.avatar || "🎙️",
          body.themeColor || "#3b82f6",
          body.personality,
          body.speakingStyle,
          now
        )
        .run();
    } catch (err: any) {
      console.error("Failed to insert persona:", err);
    }
  }

  return c.json({
    id,
    name: body.name,
    role: body.role || "コメンテーター",
    avatar: body.avatar || "🎙️",
    themeColor: body.themeColor || "#3b82f6",
    personality: body.personality,
    speakingStyle: body.speakingStyle,
    createdAt: now,
  });
});

// ペルソナ削除
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (c.env.DB) {
    try {
      await ensureDatabaseTables(c.env.DB);
      await c.env.DB.prepare("DELETE FROM personas WHERE id = ?").bind(id).run();
    } catch (err) {
      console.warn("Failed to delete persona:", err);
    }
  }
  return c.json({ success: true });
});

export default app;
