/**
 * Cloudflare Cache API による応答キャッシュ。
 *
 * Worker が返す動的な応答は、Cache-Control を付けてもエッジには自動でキャッシュされない。
 * そこで fetch の入口 (server.ts) で包み、ハンドラが `cacheFor()` で「この応答はキャッシュしてよい」と
 * 申告したときだけ caches.default に入れる。申告がなければ一切キャッシュしない (安全側)。
 *
 * - 申告はリクエストごとの AsyncLocalStorage に入れるので、SSR の loader 内の server function からも呼べる。
 * - 複数回申告されたら最も短い期間を採用する。
 * - GET 以外、認証ヘッダ付き、管理系のパスはキャッシュしない。管理系には no-store を付ける。
 * - Cache API は独自ドメインのゾーンでのみ効く (workers.dev では何もしない)。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface CacheHint {
  /** エッジ (共有キャッシュ) に置く秒数 */
  sMaxAge: number;
  /** ブラウザに置く秒数 */
  maxAge: number;
  immutable?: boolean;
}

const store = new AsyncLocalStorage<{ hint?: CacheHint }>();

/** この応答はキャッシュしてよい、と申告する。キャッシュの外 (テストなど) で呼ばれても何もしない */
export function cacheFor(sMaxAge: number, options: { maxAge?: number; immutable?: boolean } = {}): void {
  const state = store.getStore();
  if (!state) return;
  const next: CacheHint = { sMaxAge, maxAge: options.maxAge ?? 0, immutable: options.immutable };
  const cur = state.hint;
  state.hint = cur
    ? { sMaxAge: Math.min(cur.sMaxAge, next.sMaxAge), maxAge: Math.min(cur.maxAge, next.maxAge), immutable: cur.immutable && next.immutable }
    : next;
}

export function cacheControl(hint: CacheHint): string {
  return `public, max-age=${hint.maxAge}, s-maxage=${hint.sMaxAge}${hint.immutable ? ", immutable" : ""}`;
}

/** 管理画面・管理API。Access で守っているので、共有キャッシュに入れてはいけない */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  handler: () => Promise<Response>
): Promise<Response> {
  const url = new URL(request.url);

  if (isAdminPath(url.pathname)) {
    return withHeaders(await handler(), { "Cache-Control": "private, no-store" });
  }

  const cacheable =
    request.method === "GET" && !request.headers.has("Authorization") && !request.headers.has("Cf-Access-Jwt-Assertion");
  const cache = cacheable && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  if (!cache) return handler();

  // ヘッダ (Cookie など) の違いで分かれないよう、URLだけをキーにする
  const key = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { "X-Cache": "HIT" });

  const state: { hint?: CacheHint } = {};
  const res = await store.run(state, handler);
  if (!state.hint || res.status !== 200 || res.headers.has("Set-Cookie")) return res;

  const out = withHeaders(res, { "Cache-Control": cacheControl(state.hint), "X-Cache": "MISS" });
  ctx.waitUntil(cache.put(key, out.clone()).catch((err) => console.warn("cache.put failed:", err)));
  return out;
}
