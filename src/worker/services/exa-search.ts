/**
 * Exa Search API (type: lite)。結果 URL だけを抜き出す。
 * https://api.exa.ai/search
 */
import { assertPublicHttpUrl } from "./scraper";

const EXA_SEARCH = "https://api.exa.ai/search";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS_PER_QUERY = 8;

export class ExaSearchError extends Error {}

interface ExaResult {
  url?: unknown;
}

interface ExaSearchResponse {
  results?: ExaResult[];
}

/** Exa Search の JSON から公開 HTTP(S) URL を順に抜く */
export function parseExaSearchResults(payload: unknown, limit = MAX_RESULTS_PER_QUERY): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const results =
    payload && typeof payload === "object" && "results" in payload
      ? (payload as ExaSearchResponse).results
      : undefined;
  if (!Array.isArray(results)) {
    return [];
  }

  for (const item of results) {
    if (!item || typeof item.url !== "string") {
      continue;
    }
    let normalized: string;
    try {
      const u = new URL(item.url);
      assertPublicHttpUrl(u);
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

/**
 * 1クエリ分の検索 (Exa Lite)。API キー未設定・失敗時は例外 (呼び出し側でフォールバック)。
 * URL 一覧だけ欲しいので contents は要求しない (キャッシュ欠落で結果が落ちるのを避ける)。
 */
export async function searchExaLite(
  query: string,
  apiKey: string,
  limit = MAX_RESULTS_PER_QUERY
): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  if (!apiKey.trim()) {
    throw new ExaSearchError("Exa の API キーが設定されていません");
  }

  const numResults = Math.min(10, Math.max(1, limit));
  let response: Response;
  try {
    response = await fetch(EXA_SEARCH, {
      method: "POST",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        query: trimmed,
        type: "lite",
        numResults,
        userLocation: "JP",
      }),
    });
  } catch (err) {
    throw new ExaSearchError(
      `検索に失敗しました (${err instanceof Error && err.name === "TimeoutError" ? "タイムアウト" : "接続エラー"})`,
      { cause: err }
    );
  }

  if (!response.ok) {
    throw new ExaSearchError(`検索に失敗しました (HTTP ${response.status})`);
  }

  const json: unknown = await response.json().catch(() => null);
  if (json === null) {
    throw new ExaSearchError("検索に失敗しました (応答が不正です)");
  }
  return parseExaSearchResults(json, limit);
}
