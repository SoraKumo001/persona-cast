import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types";
import personasRouter from "./routes/personas";
import sessionsRouter from "./routes/sessions";
import memoriesRouter from "./routes/memories";

const app = new Hono<{ Bindings: Env }>();

// CORS設定
app.use("/api/*", cors());

// APIルートのマウント
app.route("/api/personas", personasRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/memories", memoriesRouter);

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
