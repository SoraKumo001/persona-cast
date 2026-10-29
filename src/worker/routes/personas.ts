import { Hono } from "hono";
import { Env, Persona } from "../types";

const app = new Hono<{ Bindings: Env }>();

// ペルソナ一覧取得
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, role, avatar, theme_color as themeColor, personality, speaking_style as speakingStyle, created_at as createdAt FROM personas ORDER BY created_at ASC"
  ).all();
  return c.json({ personas: results });
});

// 新規ペルソナ作成
app.post("/", async (c) => {
  const body = await c.req.json<Partial<Persona>>();
  if (!body.name || !body.personality || !body.speakingStyle) {
    return c.json({ error: "名前、性格、口調は必須です" }, 400);
  }

  const id = body.id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

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
  await c.env.DB.prepare("DELETE FROM personas WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

export default app;
