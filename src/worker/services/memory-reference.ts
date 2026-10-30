import { normalizeUrl } from "./url-normalize";

/**
 * 記憶参照フラグ (messages.referenced_session_id) の判定。
 * 参照判定は対談ストリーム本体から切り離し、純粋関数として単体テストできるようにしている。
 */

/** 参照判定に使う記事タイトルの最低文字数 (短すぎるタイトルは部分一致で誤検出するため) */
const TITLE_MIN_LENGTH = 4;

/** 本文中の URL 候補。末尾の句読点や閉じ括弧は URL の一部として扱わない */
const URL_PATTERN = /https?:\/\/[^\s<>"'`）)\]】、。」]+/gu;

/** 参照した記憶チャンクの識別情報 */
export interface MemoryReferenceMatch {
  articleTitle: string;
  sessionId: string;
}

/** 判定に必要な記憶チャンクの最小情報 */
export interface ReferenceCandidate {
  articleTitle: string;
  createdAt: string;
  sessionId: string;
  sourceUrl: string;
}

/**
 * 引用メッセージが過去記憶を実際に参照しているかを判定する。
 * 誤検出 (現在の記事を引用しただけ、タイトルの先頭一致、未来の記憶) を避けるため、
 * 以下をすべて満たす記憶だけを参照とみなす:
 *  (a) 現在のセッションの記憶ではない (自己参照の除外)
 *  (b) 記事タイトルの完全一致、または sourceUrl の正規化 URL 一致が本文にある
 *  (c) 記憶チャンクが、この発言を生成し始めた時刻より前に存在していた (時系列ガード)
 */
export function detectMemoryReference(
  content: string,
  memories: ReferenceCandidate[],
  currentSessionId: string,
  messageCreatedAt: string
): MemoryReferenceMatch | null {
  const haystack = content.toLowerCase();
  const normalizedUrls = extractUrls(content).flatMap((url) => {
    try {
      return [normalizeUrl(url)];
    } catch {
      return [];
    }
  });
  const messageAt = Date.parse(messageCreatedAt);

  for (const mem of memories) {
    if (!mem.articleTitle || mem.sessionId === currentSessionId) {
      continue;
    }
    if (!existedBefore(mem.createdAt, messageAt)) {
      continue;
    }
    if (containsTitle(haystack, mem.articleTitle) || containsUrl(normalizedUrls, mem.sourceUrl)) {
      return { sessionId: mem.sessionId, articleTitle: mem.articleTitle };
    }
  }

  return null;
}

/** 本文から URL 候補を取り出す (末尾の句読点は落とす) */
function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((url) => url.replace(/[.,;:!?]+$/u, ""));
}

/** 時系列ガード。createdAt が無い/壊れている記憶は存在時刻を示せないので参照とみなさない */
function existedBefore(createdAt: string, messageAt: number): boolean {
  if (!Number.isFinite(messageAt)) {
    return false;
  }
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) && createdAtMs <= messageAt;
}

/** 記事タイトルの完全一致 (本文にタイトル全体が現れるか) */
function containsTitle(haystack: string, articleTitle: string): boolean {
  const title = articleTitle.trim().toLowerCase();
  return title.length >= TITLE_MIN_LENGTH && haystack.includes(title);
}

/** 正規化 URL の一致 */
function containsUrl(normalizedUrls: string[], sourceUrl: string): boolean {
  if (!sourceUrl) {
    return false;
  }
  let target: string;
  try {
    target = normalizeUrl(sourceUrl);
  } catch {
    return false;
  }
  return normalizedUrls.includes(target);
}
