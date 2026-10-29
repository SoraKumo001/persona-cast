/**
 * URLの正規化: 表記ゆれがあっても同じページなら同じ文字列になるようにする。
 * - http/https のみ許可し、https に統一
 * - ホスト小文字化、先頭 www. 除去、デフォルトポート除去、fragment除去
 * - トラッキング用クエリを除去し、残りはキー順にソート
 * - パスの重複スラッシュ・末尾スラッシュ・index.html を整理
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "yclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref_src",
  "ref_url",
  "spm",
  "cmpid",
  "s_cid",
]);

const TRACKING_PREFIXES = ["utm_", "pk_", "hsa_", "mkt_", "vero_"];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch (err) {
    throw new Error("無効なURL形式です。有効なHTTP/HTTPS URLを入力してください。", { cause: err });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP/HTTPS 以外のURLは指定できません。");
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");

  // 認証情報・fragment は同一ページ判定に不要 (かつ漏えいを避ける)
  let path = url.pathname.replace(/\/{2,}/gu, "/");
  path = path.replace(/\/index\.(html?|php)$/iu, "/");
  if (path.length > 1) {
    path = path.replace(/\/+$/u, "");
  }
  if (!path) {
    path = "/";
  }

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  const query = new URLSearchParams(params).toString();

  // 非デフォルトポートのみ残す (http/https を https に統一するため 80 と 443 は除去)
  const port = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";

  return `https://${host}${port}${path}${query ? `?${query}` : ""}`;
}

/** canonical を採用してよいか: 同一ホスト内のみ (他ドメインへの付け替えを防ぐ) */
export function pickCanonical(pageUrl: string, canonicalHref: string | null | undefined): string | null {
  if (!canonicalHref) {
    return null;
  }
  try {
    const resolved = new URL(canonicalHref, pageUrl).toString();
    const a = new URL(normalizeUrl(pageUrl));
    const b = new URL(normalizeUrl(resolved));
    return a.host === b.host ? b.toString() : null;
  } catch {
    return null;
  }
}
