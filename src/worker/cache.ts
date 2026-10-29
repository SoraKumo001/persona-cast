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
 * - エッジ (s-maxage) とブラウザで、別の Cache-Control を使う。保存するコピーにはエッジ用だけを付け、
 *   ブラウザ向けの値は X-Browser-Cache に持たせて、返すときに Cache-Control へ移す。
 *   ブラウザは maxAge が 0 なら no-cache (毎回エッジに確認する)。これで、画面遷移で一覧などを
 *   取り直したとき、ブラウザに残った古い応答が使われない。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface CacheHint {
  immutable?: boolean;
  /** ブラウザに置く秒数 */
  maxAge: number;
  /** エッジ (共有キャッシュ) に置く秒数 */
  sMaxAge: number;
}

const store = new AsyncLocalStorage<{ hint?: CacheHint }>();

/** この応答はキャッシュしてよい、と申告する。キャッシュの外 (テストなど) で呼ばれても何もしない */
export function cacheFor(sMaxAge: number, options: { maxAge?: number; immutable?: boolean } = {}): void {
  const state = store.getStore();
  if (!state) {
    return;
  }
  const next: CacheHint = { sMaxAge, maxAge: options.maxAge ?? 0, immutable: options.immutable };
  const cur = state.hint;
  state.hint = cur
    ? {
        sMaxAge: Math.min(cur.sMaxAge, next.sMaxAge),
        maxAge: Math.min(cur.maxAge, next.maxAge),
        immutable: cur.immutable && next.immutable,
      }
    : next;
}

/** ブラウザ向け。maxAge が 0 なら、保存せず毎回確認させる (エッジのキャッシュは使える) */
export function browserCacheControl(hint: CacheHint): string {
  if (hint.maxAge <= 0) {
    return "no-cache";
  }
  return `public, max-age=${hint.maxAge}${hint.immutable ? ", immutable" : ""}`;
}

/** エッジ (Cache API に保存するコピー) 向け */
export function edgeCacheControl(hint: CacheHint): string {
  return `public, s-maxage=${hint.sMaxAge}`;
}

const BROWSER_HEADER = "X-Browser-Cache";

/** 管理画面・管理API。Access で守っているので、共有キャッシュに入れてはいけない */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) {
    out.headers.set(k, v);
  }
  return out;
}

/** 対談を非表示にしたときに、エッジに残った応答を消す (消せなければ、有効期限で自然に切れる) */
export async function purgeSessionCache(origin: string, sessionId: string): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  const cache = (caches as unknown as { default: Cache }).default;
  const id = encodeURIComponent(sessionId);
  const paths = [`/s/${id}`, `/api/sessions/${id}`, `/api/sessions/${id}/ogp.png`, "/", "/sitemap.xml", "/rss.xml"];
  await Promise.all(paths.map((p) => cache.delete(new Request(`${origin}${p}`, { method: "GET" })).catch(() => false)));
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
    request.method === "GET" &&
    !request.headers.has("Authorization") &&
    !request.headers.has("Cf-Access-Jwt-Assertion");
  const cache = cacheable && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  if (!cache) {
    return handler();
  }

  // ヘッダ (Cookie など) の違いで分かれないよう、URLだけをキーにする
  const key = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    const out = withHeaders(hit, { "Cache-Control": hit.headers.get(BROWSER_HEADER) ?? "no-cache", "X-Cache": "HIT" });
    out.headers.delete(BROWSER_HEADER);
    return out;
  }

  const state: { hint?: CacheHint } = {};
  const res = await store.run(state, handler);
  if (!state.hint || res.status !== 200 || res.headers.has("Set-Cookie")) {
    return res;
  }

  const browser = browserCacheControl(state.hint);
  // 保存するコピーには、エッジ用の Cache-Control とブラウザ向けの値を持たせる
  const stored = withHeaders(res.clone(), { "Cache-Control": edgeCacheControl(state.hint), [BROWSER_HEADER]: browser });
  ctx.waitUntil(cache.put(key, stored).catch((err) => console.warn("cache.put failed:", err)));
  return withHeaders(res, { "Cache-Control": browser, "X-Cache": "MISS" });
}
