import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { errorMessage } from "../errors";
import { rateLimit } from "../middleware/rate-limit";
import { ensureDatabaseTables } from "../presets";
import { defaultTurns } from "../services/analyze";
import { orchestrateDialogue } from "../services/dialogue";
import { getSessionOgpImage } from "../services/ogp-image";
import {
  claimSessionGeneration,
  clearSessionGeneration,
  getSessionGenerationState,
} from "../services/session-queries";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// SSEによるリアルタイム対談ストリーミング
// 対談の生成 (SSE)。生成済みの対談は作り直せない。発言数は人数から決め、モデルは固定 (クライアントからは指定できない)
app.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  if (c.env.DB) {
    await ensureDatabaseTables(c.env.DB);
  }

  const session = await getSessionGenerationState(c.env.DB, sessionId);
  if (!session) {
    return c.json({ error: "セッションが見つかりません" }, 404);
  }
  if (session.messageCount > 0) {
    return c.json({ error: "この対談は生成済みです" }, 409);
  }

  const limited = await rateLimit(c, "stream", 20, 3600);
  if (limited) {
    return limited;
  }

  // 同じ対談を同時に生成させない (生成中の印を原子的に付ける。10分以上前の印は失効扱い)
  const now = new Date();
  const claimed = await claimSessionGeneration(c.env.DB, sessionId, now);
  if (!claimed) {
    return c.json({ error: "この対談は生成中です" }, 409);
  }

  const totalTurns = defaultTurns(JSON.parse(session.personaIds || "[]").length);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of orchestrateDialogue(sessionId, c.env, totalTurns)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      }
      // 一覧のサムネイル用に、対談の完了後にOGP画像を先に生成してキャッシュしておく
      try {
        c.executionCtx.waitUntil(
          getSessionOgpImage(c.env, sessionId).catch((e) => console.warn("OGP prewarm failed:", e))
        );
      } catch {
        // executionCtx がない環境では、初回リクエスト時に生成される
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: errorMessage(err) }),
      });
    } finally {
      // 失敗して発言が1件もなければ、やり直せるように印を外す
      await clearSessionGeneration(c.env.DB, sessionId).catch(() => undefined);
    }
  });
});

export default app;
