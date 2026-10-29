/**
 * URLから記事のタイトル・本文・OGP情報を抽出するスクレーパーサービス (HTMLRewriter ベース)
 */
import { normalizeUrl, pickCanonical } from "./url-normalize";
import { hasAdultRating } from "./adult-filter";

export interface OgpInfo {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
  type: string | null;
}

export interface ScrapedArticle {
  /** リダイレクト後の最終URL */
  url: string;
  /** canonical・最終URLを考慮した正規化URL (同一ページ判定キー) */
  normalizedUrl: string;
  title: string;
  content: string;
  ogp: OgpInfo;
  /** ページ自身が成人向けと宣言している (rating メタ / RTA ラベル) */
  adultRated: boolean;
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 6000;

export class ScrapeError extends Error {}

/** SSRF 対策: ローカル/プライベート宛てのホストを拒否する */
export function assertPublicHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("HTTP/HTTPS 以外のURLは取得できません。");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") && !host.includes(":");
  if (blockedName || isPrivateIp(host)) {
    throw new ScrapeError("このアドレスのURLは取得できません。");
  }
}

function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (host.includes(":")) {
    // IPv6 リテラルは (ループバック・ULA・リンクローカル・IPv4射影含め) 一律拒否
    return true;
  }
  return false;
}

async function fetchHtml(startUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicHttpUrl(current);
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PersonaCastBot/1.0)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        },
      });
    } catch (err: any) {
      throw new ScrapeError(`URLに接続できませんでした (${err?.name === "TimeoutError" ? "タイムアウト" : "接続エラー"})`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ScrapeError("リダイレクト先が不正です。");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new ScrapeError(`URLの取得に失敗しました (HTTP ${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/html|xml/i.test(contentType)) {
      throw new ScrapeError("HTMLページではないため取得できません。");
    }

    return { html: await readLimited(response, MAX_BODY_BYTES), finalUrl: current };
  }
  throw new ScrapeError("リダイレクトが多すぎます。");
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= limit) {
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}

interface Extracted {
  title: string;
  meta: Map<string, string>;
  canonical: string | null;
  icon: string | null;
  buckets: Record<"article" | "main" | "body", string>;
}

const BLOCKS = "p, h1, h2, h3, h4, li";

async function extract(html: string): Promise<Extracted> {
  const out: Extracted = {
    title: "",
    meta: new Map(),
    canonical: null,
    icon: null,
    buckets: { article: "", main: "", body: "" },
  };

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(t) {
        out.title += t.text;
      },
    })
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") || el.getAttribute("name"))?.toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !out.meta.has(key)) out.meta.set(key, content);
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase().split(/\s+/);
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel.includes("canonical") && !out.canonical) out.canonical = href;
        if (rel.includes("icon") && !out.icon) out.icon = href;
      },
    });

  for (const scope of ["article", "main", "body"] as const) {
    const selector = BLOCKS.split(",")
      .map((b) => `${scope} ${b.trim()}`)
      .join(", ");
    rewriter.on(selector, {
      element(el) {
        el.onEndTag(() => {
          out.buckets[scope] += "\n";
        });
      },
      text(t) {
        out.buckets[scope] += t.text;
      },
    });
  }

  // 変換結果は使わず、ハンドラの副作用だけを利用する
  await rewriter.transform(new Response(html, { headers: { "content-type": "text/html" } })).arrayBuffer();
  return out;
}

export async function scrapeUrl(urlStr: string): Promise<ScrapedArticle> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new ScrapeError("無効なURL形式です。有効なHTTP/HTTPS URLを入力してください。");
  }

  const { html, finalUrl } = await fetchHtml(url);
  const page = await extract(html);
  const meta = (k: string) => cleanText(page.meta.get(k) ?? "") || null;

  const title =
    cleanText(page.title) || meta("og:title") || meta("twitter:title") || finalUrl.hostname;
  const ogp: OgpInfo = {
    title: meta("og:title") ?? (cleanText(page.title) || null),
    description: meta("og:description") ?? meta("twitter:description") ?? meta("description"),
    image: resolvePublicUrl(page.meta.get("og:image") ?? page.meta.get("twitter:image"), finalUrl),
    siteName: meta("og:site_name"),
    favicon: resolvePublicUrl(page.icon ?? "/favicon.ico", finalUrl),
    type: meta("og:type"),
  };

  // 本文: article > main > 全体 の順で、十分な長さのあるものを採用
  const candidates = [page.buckets.article, page.buckets.main, page.buckets.body].map(cleanText);
  let content = candidates.find((c) => c.length >= 200) ?? candidates.sort((a, b) => b.length - a.length)[0] ?? "";
  if (content.length > MAX_CONTENT_CHARS) content = content.slice(0, MAX_CONTENT_CHARS) + "...(省略)";
  if (!content) content = ogp.description ?? "";

  const canonical = pickCanonical(finalUrl.toString(), page.canonical ?? meta("og:url"));
  const normalizedUrl = normalizeUrl(canonical ?? finalUrl.toString());

  return { url: finalUrl.toString(), normalizedUrl, title, content, ogp, adultRated: hasAdultRating(page.meta) };
}

/** 画像・favicon は http(s) のみ許可し、絶対URLに解決する */
function resolvePublicUrl(href: string | null | undefined, base: URL): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeHtmlEntities(str: string): string {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function cleanText(s: string): string {
  return decodeHtmlEntities(s).replace(/\s+/g, " ").trim();
}
