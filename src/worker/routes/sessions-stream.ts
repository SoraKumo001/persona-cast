import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { errorMessage } from "../errors";
import { rateLimit } from "../middleware/rate-limit";
import { defaultTurns } from "../services/analyze";
import { orchestrateDialogue } from "../services/dialogue";
import { getSessionOgpImage } from "../services/ogp-image";
import { claimSessionGeneration, clearSessionGeneration, getSessionGenerationState } from "../services/session-queries";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

/**
 * 生成中の印を外す。ここで失敗しても SSE の結果は変えず、警告して1回だけ再試行する。
 * (それでも外せない場合は GENERATION_STALE_MS 経過後に失効する)
 */
async function releaseSessionGeneration(db: Env["DB"], sessionId: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await clearSessionGeneration(db, sessionId);
      return;
    } catch (err) {
      console.warn(`Failed to clear generating_at (session ${sessionId}, attempt ${attempt}):`, err);
    }
  }
}

// SSEによるリアルタイム対談ストリーミング
// 対談の生成 (SSE)。生成済みの対談は作り直せない。発言数は人数から決め、モデルは固定 (クライアントからは指定できない)
app.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");

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

  // claim より前に確定させる。ここで例外が出ても、生成中の印を付けたままにしない
  let totalTurns: number;
  try {
    totalTurns = defaultTurns((JSON.parse(session.personaIds || "[]") as string[]).length);
  } catch {
    totalTurns = defaultTurns(0);
  }

  // 同じ対談を同時に生成させない (生成中の印を原子的に付ける。GENERATION_STALE_MS 以上前の印は失効扱い)
  const now = new Date();
  const claimed = await claimSessionGeneration(c.env.DB, sessionId, now);
  if (!claimed) {
    return c.json({ error: "この対談は生成中です" }, 409);
  }

  try {
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
        // LLM の中断や書き込み失敗。切断済みで error イベントも送れないことがあるので、送信失敗は握り潰す
        try {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: errorMessage(err) }),
          });
        } catch (writeErr) {
          console.warn("Failed to send SSE error event:", writeErr);
        }
      } finally {
        // 成否によらず印を外す (発言が1件もない場合は、やり直せるようにする)
        await releaseSessionGeneration(c.env.DB, sessionId);
      }
    });
  } catch (err) {
    // ストリームを開始できなかった場合も印を残さない
    await releaseSessionGeneration(c.env.DB, sessionId);
    throw err;
  }
});

export default app;
