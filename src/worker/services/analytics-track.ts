/**
 * アクセス状況の記録 (Workers Analytics Engine)。
 *
 * データセットの列の使い方 (analytics-query.ts と対応):
 *   index1 = 種別内のルート名 (サンプリングの単位)
 *   blob1  = 種別: "pv" (HTMLページの表示) / "api" / "event" (業務イベント)
 *   blob2  = ルート名 ("/", "/s/:id", "/api/sessions" など。IDは含めない)
 *   blob3  = 詳細: pv の /s/:id では対談ID、event ではイベント名
 *   blob4  = キャッシュ: "HIT" / "MISS" / "NONE"
 *   blob5  = 国 (cf-ipcountry)
 *   blob6  = 参照元ホスト (自サイトからの遷移は空)
 *   blob7  = 端末: "pc" / "mobile" / "tablet" / "bot"
 *   blob8  = 訪問者の識別 (IP+UA+日付のソルト付きハッシュ。日をまたぐと別人扱い。生のIPは保存しない)
 *   double1 = HTTPステータス、double2 = 応答時間(ms)、double3/4 = イベントの数値 (LLMの入力/キャッシュ済みトークン)
 */
import type { Env } from "../types";

export const DATASET = "persona_cast_events";

export type Device = "pc" | "mobile" | "tablet" | "bot";

const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|curl|wget|python-requests|headless|lighthouse/iu;

export function classifyDevice(ua: string): Device {
  if (!ua || BOT_UA.test(ua)) {
    return "bot";
  }
  if (/ipad|tablet|kindle/iu.test(ua) || (/android/iu.test(ua) && !/mobile/iu.test(ua))) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android/iu.test(ua)) {
    return "mobile";
  }
  return "pc";
}

export interface TrackedRoute {
  detail: string;
  route: string;
  type: "pv" | "api";
}

const STATIC_EXT = /\.(png|jpe?g|webp|gif|svg|ico|css|js|mjs|map|woff2?|ttf|txt|xml|json)$/iu;

function isExcludedPath(pathname: string): boolean {
  const adminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const infra = pathname.startsWith("/assets/") || pathname.startsWith("/_serverFn") || pathname === "/api/health";
  return adminPage || pathname.startsWith("/api/admin/") || infra || STATIC_EXT.test(pathname);
}

const API_ROUTES: { pattern: RegExp; route: string }[] = [
  { pattern: /^\/api\/sessions$/u, route: "/api/sessions" },
  { pattern: /^\/api\/sessions\/[^/]+$/u, route: "/api/sessions/:id" },
  { pattern: /^\/api\/sessions\/[^/]+\/stream$/u, route: "/api/sessions/:id/stream" },
  { pattern: /^\/api\/personas$/u, route: "/api/personas" },
  { pattern: /^\/api\/memories\/search$/u, route: "/api/memories/search" },
  { pattern: /^\/api\/memories$/u, route: "/api/memories" },
];

const DIALOGUE_PAGE = /^\/s\/([^/]+)\/?$/u;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // 不正なエンコードはそのまま
    return value;
  }
}

/**
 * パスを集計用のルート名にする。対象外 (管理画面・静的ファイルなど) は null。
 * 未知のパスは "other" にまとめ、ランダムなパスを叩くスキャナで種類が増えないようにする。
 */
export function classifyRoute(pathname: string): TrackedRoute | null {
  if (isExcludedPath(pathname)) {
    return null;
  }

  if (pathname.startsWith("/api/")) {
    const route = API_ROUTES.find((r) => r.pattern.test(pathname))?.route ?? "/api/other";
    return { type: "api", route, detail: "" };
  }

  const dialogue = DIALOGUE_PAGE.exec(pathname);
  if (dialogue) {
    return { type: "pv", route: "/s/:id", detail: safeDecode(dialogue[1]).slice(0, 64) };
  }
  if (pathname === "/" || pathname === "/memories") {
    return { type: "pv", route: pathname, detail: "" };
  }
  return { type: "pv", route: "other", detail: "" };
}

/** 参照元のホスト名。自サイト内の遷移や、無い/不正な値は空 */
export function referrerHost(referer: string | null | undefined, selfHost: string): string {
  if (!referer) {
    return "";
  }
  try {
    const host = new URL(referer).hostname.replace(/^www\./u, "").toLowerCase();
    return host === selfHost.replace(/^www\./u, "").toLowerCase() ? "" : host.slice(0, 64);
  } catch {
    return "";
  }
}

export async function visitorHash(ip: string, ua: string, day: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${day}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 日本時間の日付 (YYYY-MM-DD)。訪問者ハッシュを日ごとに切り替えるために使う */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** リクエスト1件を記録する。応答は遅らせず、失敗してもアプリの動作に影響させない */
export function trackRequest(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  response: Response,
  startedAt: number
): void {
  const dataset = env.ANALYTICS;
  if (!dataset) {
    return;
  }
  try {
    const url = new URL(request.url);
    const tracked = classifyRoute(url.pathname);
    if (!tracked || request.method !== "GET") {
      // POST など: API だけは記録する (対談の作成・制限の把握のため)
      if (tracked?.type !== "api") {
        return;
      }
    } else if (tracked.type === "pv" && !(response.headers.get("content-type") ?? "").includes("text/html")) {
      return;
    }

    const ua = request.headers.get("user-agent") ?? "";
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const device = classifyDevice(ua);
    const cache = response.headers.get("x-cache") ?? "NONE";
    const country = request.headers.get("cf-ipcountry") ?? "";
    const referrer = referrerHost(request.headers.get("referer"), url.hostname);
    const duration = Date.now() - startedAt;

    ctx.waitUntil(
      visitorHash(ip, ua, jstDay(), env.ANALYTICS_SALT ?? "persona-cast")
        .then((visitor) =>
          dataset.writeDataPoint({
            indexes: [tracked.route],
            blobs: [tracked.type, tracked.route, tracked.detail, cache, country, referrer, device, visitor],
            doubles: [response.status, duration, 0, 0],
          })
        )
        .catch((err) => console.warn("analytics write failed:", err))
    );
  } catch (err) {
    console.warn("analytics track failed:", err);
  }
}

/** 業務イベント (対談の作成・18禁のブロック・LLM使用量など) を記録する */
export function trackEvent(env: Env, name: string, values: { value?: number; extra?: number } = {}): void {
  if (!env.ANALYTICS) {
    return;
  }
  try {
    env.ANALYTICS.writeDataPoint({
      indexes: ["event"],
      blobs: ["event", "event", name, "NONE", "", "", "", ""],
      doubles: [0, 0, values.value ?? 0, values.extra ?? 0],
    });
  } catch (err) {
    console.warn("analytics event failed:", err);
  }
}
