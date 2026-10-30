import { Hono } from "hono";
import { cacheFor } from "../cache";
import { getSessionOgpImage } from "../services/ogp-image";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// 対談ごとのOGP画像 (1200x630 PNG)。SNS/チャットのリンクプレビュー用
app.get("/:id/ogp.png", async (c) => {
  try {
    const png = await getSessionOgpImage(c.env, c.req.param("id"));
    if (!png) {
      return c.json({ error: "セッションが見つかりません" }, 404);
    }
    cacheFor(3600, { maxAge: 3600 });
    return new Response(png as BodyInit, { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("OGP image generation failed:", err);
    return c.json({ error: "OGP画像の生成に失敗しました" }, 500);
  }
});

export default app;
