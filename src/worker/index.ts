import { Hono } from "hono";
import { cors } from "hono/cors";
import { cacheFor } from "./cache";
import { getSiteOgpImage } from "./services/ogp-image";
import { Env } from "./types";
import personasRouter from "./routes/personas";
import adminPersonasRouter from "./routes/admin-personas";
import adminAnalyticsRouter from "./routes/admin-analytics";
import adminSettingsRouter from "./routes/admin-settings";
import sessionsRouter from "./routes/sessions";
import memoriesRouter from "./routes/memories";

const app = new Hono<{ Bindings: Env }>();

// 公開APIのみ CORS を許可 (管理APIは同一オリジン + Cloudflare Access のみ)
app.use("/api/personas/*", cors());
app.use("/api/sessions/*", cors());
app.use("/api/memories/*", cors());

// APIルートのマウント
app.route("/api/personas", personasRouter);
app.route("/api/admin/personas", adminPersonasRouter);
app.route("/api/admin/settings", adminSettingsRouter);
app.route("/api/admin/analytics", adminAnalyticsRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/memories", memoriesRouter);

// トップページのOGP画像 (SNS/チャットのリンクプレビュー用)
app.get("/api/ogp.png", async (c) => {
  try {
    const png = await getSiteOgpImage(c.env);
    cacheFor(3600, { maxAge: 3600 });
    return new Response(png as BodyInit, { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("Site OGP image generation failed:", err);
    return c.json({ error: "OGP画像の生成に失敗しました" }, 500);
  }
});

// システムステータス確認
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    app: "persona-cast",
    hasAiBinding: !!c.env.AI,
    hasVectorizeBinding: !!c.env.VECTORIZE,
    hasApiKey: !!c.env.OPENCODE_API_KEY && c.env.OPENCODE_API_KEY !== "your-opencode-api-key-here",
    defaultModel: c.env.OPENCODE_DEFAULT_MODEL || "deepseek-v4.1-flash",
  });
});

// 静的アセット配信 (React SPA)
app.all("*", async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Persona-Cast API Server Running");
});

export default app;
