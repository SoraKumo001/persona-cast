import { Hono } from "hono";
import { cacheFor } from "../cache";
import { getSessionDetail } from "../services/session-queries";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// セッション詳細と発言ログの取得
app.get("/:id", async (c) => {
  const detail = await getSessionDetail(c.env.DB, c.req.param("id"));
  if (!detail) {
    return c.json({ error: "セッションが見つかりません" }, 404);
  }
  // 発言が保存された対談は変わらない。生成中・生成前は載せない
  if (detail.messages.length > 0) {
    cacheFor(600);
  }
  return c.json(detail);
});

export default app;
