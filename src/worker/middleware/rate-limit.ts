import type { Context } from "hono";
import type { Env } from "../types";

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
  windowSeconds: number,
  /** ウィンドウの区切りをずらす秒数 (日本時間の0時区切りなら 9時間 = 32400) */
  offsetSeconds = 0
): Promise<Response | null> {
  const ip = c.req.header("CF-Connecting-IP");
  if (!(ip && c.env.DB)) {
    return null;
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor((nowSec + offsetSeconds) / windowSeconds);
    const expiresAt = (bucket + 1) * windowSeconds - offsetSeconds;
    const row = await c.env.DB.prepare(
      "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count"
    )
      .bind(`${name}:${clientKey(ip)}:${bucket}`, expiresAt)
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

/**
 * レート制限のキーにする識別子。IPv6 は利用者に /64 がまとめて割り当てられるため、
 * 先頭64ビット (4グループ) で数える。IPv4 はそのまま。
 */
export function clientKey(ip: string): string {
  if (!ip.includes(":")) {
    return ip;
  }
  const [head, tail] = ip.toLowerCase().split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail ? tail.split(":") : [];
  const missing = Math.max(8 - headParts.length - tailParts.length, 0);
  const groups = tail === undefined ? headParts : [...headParts, ...new Array(missing).fill("0"), ...tailParts];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/u, ""))
    .join(":")}::/64`;
}

/** クエリ文字列などの数値を範囲内の整数にする。不正なら既定値 */
export function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(n, min), max);
}

/** クエリ文字列の 0〜1 の小数。不正なら既定値 */
export function clampFloat(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(n, min), max);
}
