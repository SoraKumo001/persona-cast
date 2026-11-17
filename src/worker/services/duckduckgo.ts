/**
 * DuckDuckGo HTML 検索 (API キー不要)。結果リンクだけを抜き出す。
 * HTML 構造の変更に弱いので、パーサはここに閉じる。
 */
import { assertPublicHttpUrl } from "./scraper";

const DDG_HTML = "https://html.duckduckgo.com/html/";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS_PER_QUERY = 8;

export class DuckDuckGoError extends Error {}

/** DDG のリダイレクトリンク (`//duckduckgo.com/l/?uddg=…`) から実 URL を取り出す */
export function unwrapDdgHref(href: string, base = "https://html.duckduckgo.com"): string | null {
  try {
    const absolute = new URL(href, base);
    const uddg = absolute.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    if (absolute.protocol === "http:" || absolute.protocol === "https:") {
      // 検索結果そのものや DDG 内部リンクは除外
      if (absolute.hostname.includes("duckduckgo.com")) {
        return null;
      }
      return absolute.toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * DuckDuckGo HTML の結果リンクを抽出する。
 * 想定マークアップ: `<a rel="nofollow" class="result__a" href="…">`
 */
export function parseDuckDuckGoResults(html: string, limit = MAX_RESULTS_PER_QUERY): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /class="result__a"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="result__a"/giu;
  for (const match of html.matchAll(re)) {
    const raw = match[1] || match[2];
    if (!raw) {
      continue;
    }
    const unwrapped = unwrapDdgHref(raw.replace(/&amp;/gu, "&"));
    if (!unwrapped) {
      continue;
    }
    let normalized: string;
    try {
      const u = new URL(unwrapped);
      assertPublicHttpUrl(u);
      // フラグメントとよくあるトラッキングは落とす程度に正規化
      u.hash = "";
      normalized = u.toString();
    } catch {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= limit) {
      break;
    }
  }
  return urls;
}

/** 1クエリ分の検索。失敗時は空配列 (呼び出し側でフォールバック) */
export async function searchDuckDuckGo(query: string, limit = MAX_RESULTS_PER_QUERY): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const target = new URL(DDG_HTML);
  target.searchParams.set("q", trimmed);
  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // DDG HTML は Bot 向け UA だと 202 チャレンジになることがある
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
    });
  } catch (err) {
    throw new DuckDuckGoError(
      `検索に失敗しました (${err instanceof Error && err.name === "TimeoutError" ? "タイムアウト" : "接続エラー"})`,
      { cause: err }
    );
  }
  if (!response.ok) {
    throw new DuckDuckGoError(`検索に失敗しました (HTTP ${response.status})`);
  }
  const html = await response.text();
  return parseDuckDuckGoResults(html, limit);
}
