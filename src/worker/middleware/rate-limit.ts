import type { Context } from "hono";
import { Env } from "../types";

/**
 * D1 を使った簡易レート制限 (固定ウィンドウ)。公開エンドポイントが LLM・Workers AI を呼ぶため、
 * IPごとの回数を制限してコストの悪用を防ぐ。
 * - IP は Cloudflare が付ける CF-Connecting-IP。無ければ (ローカル開発など) 制限しない。
 * - 制限のための DB 障害でサービスを止めないよう、エラー時は通す。
 * 超過時は 429 の Response を返し、通すときは null を返す。
 */
export async function rateLimit(
  c: Context<{ Bindings: Env }>,
  name: string,
  limit: number,
  windowSeconds: number
): Promise<Response | null> {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip || !c.env.DB) return null;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSec / windowSeconds);
    const expiresAt = (bucket + 1) * windowSeconds;
    const row = await c.env.DB.prepare(
      "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count"
    )
      .bind(`${name}:${ip}:${bucket}`, expiresAt)
      .first<{ count: number }>();

    // 期限切れの行を、たまに掃除する
    if (Math.random() < 0.02) {
      await c.env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(nowSec).run();
    }

    if (row && row.count > limit) {
      return c.json({ error: "リクエストが多すぎます。しばらくしてからもう一度お試しください。" }, 429, {
        "Retry-After": String(Math.max(expiresAt - nowSec, 1)),
      });
    }
  } catch (err) {
    console.warn("rateLimit failed (allowing request):", err);
  }
  return null;
}

/** クエリ文字列などの数値を範囲内の整数にする。不正なら既定値 */
export function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** クエリ文字列の 0〜1 の小数。不正なら既定値 */
export function clampFloat(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
