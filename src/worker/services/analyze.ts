import { buildAnalyzeMessages } from "../prompts";
import type { Env } from "../types";
import { looksAdult } from "./adult-filter";
import { GENRES, type Genre, guessGenre, isGenre } from "./genres";
import { extractJsonObject } from "./json-object";
import { generateChatCompletion } from "./llm";
import type { OgpInfo } from "./scraper";

const SUMMARY_MAX_CHARS = 300;
/** 対談プロンプトに渡す論点の数と、1件あたりの長さ */
const KEY_POINTS_MAX = 3;
const KEY_POINT_MAX_CHARS = 80;
/** 記事から抜き出すキー引用の数と、1件あたりの長さ */
const KEY_QUOTES_MAX = 3;
const KEY_QUOTE_MAX_CHARS = 120;
/**
 * 保存する本文の長さ (分析要約・論点と合わせて 3000 字弱に収める)。
 * 先頭の続き (800字) + 後半の重要文 (700字) の合計で、以前の 1500 字と同じ枠に収める
 */
const HYBRID_BODY_HEAD_CHARS = 800;
const HYBRID_BODY_KEY_CHARS = 700;
const HYBRID_BODY_CHARS = HYBRID_BODY_HEAD_CHARS + HYBRID_BODY_KEY_CHARS;
/** 先頭の続きと重要文の間に入れる区切り (間に飛ばした本文があることを示す) */
const HYBRID_BODY_GAP = " … ";
/**
 * 後半から拾う「重要文」の手がかり。数値 (主張の裏付け) と、逆接・対比・反論 (議論の分かれ目) を含む文。
 * embedding は使わず、正規表現だけで判定する
 */
const KEY_SENTENCE_HINT = /[0-9０-９]|しかし|だが|ただし|一方|反論/u;
/** 文の切れ目 (句点・感嘆・疑問) と改行 */
const SENTENCE_SPLIT = /(?<=[。．！？!?])|\n/u;
/**
 * 文末とみなす位置。日本語の句点・感嘆・疑問と、英語のピリオド (直後が空白か末尾のとき)。
 * 先頭部の切出しを文境界に丸めるときに使う
 */
const SENTENCE_END = /[。．！？!?]|\.(?=\s|$)/gu;
const BODY_MARKER = "【本文冒頭】";
const MIN_PERSONAS = 3;
const MAX_PERSONAS = 4;
/** 分析の LLM 呼び出しを試す回数 (1回目が失敗・不完全だったときに、1回だけやり直す) */
const ANALYZE_ATTEMPTS = 2;
/**
 * 分析は要約・論点・引用・ジャンル・ペルソナIDを1つの JSON で返すため、途切れないよう長めに取る。
 * 要約Top3 の制約文を入れた treat 側は 2650〜3150 トークン程度を要し、2000 では必ず length で切れる。
 * 推論トークンも上限に含まれるので、打ち切りが起きない十分大きな値にする
 */
const ANALYZE_MAX_OUTPUT_TOKENS = 8000;

/**
 * 要約Top3 で analyze-system.md に足した制約文の先頭。
 * SUMMARY_TOP3=off の A/B では、この行だけを外して導入前のプロンプトに戻す。
 */
const TOP3_CONSTRAINT_PREFIXES = [
  "summary は、記事の主張",
  "3つの論点は「主張と根拠」",
  "3件は本文の互いに重ならない箇所",
] as const;

/** 制約付きプロンプトから要約Top3 の指示行だけを取り除く (既定 ON では何もしない) */
export function stripTop3Constraints(prompt: string): string {
  return prompt
    .split("\n")
    .filter((line) => !TOP3_CONSTRAINT_PREFIXES.some((prefix) => line.startsWith(prefix)))
    .join("\n");
}

export interface PersonaCandidate {
  /** これまでに出演した対談の数 (偏りを避けるため選定に使う) */
  appearances?: number;
  id: string;
  name: string;
  personality: string;
  role: string;
}

export interface Analysis {
  /** 18歳未満の閲覧に適さない内容か (LLM の判定 + キーワード) */
  adult: boolean;
  genre: Genre;
  /** 対談で掘り下げる論点 (最大3つ) */
  keyPoints: string[];
  /** 記事本文からのキー引用 (最大3つ)。P0 の articleKeyQuotes に対応 */
  keyQuotes: string[];
  personaIds: string[];
  summary: string;
}

/** LLM の応答から取り出せた項目 (欠けた項目は undefined) */
interface ParsedAnalysis {
  adult?: boolean;
  genre?: Genre;
  keyPoints?: string[];
  keyQuotes?: string[];
  personaIds?: string[];
  summary?: string;
}

/** LLM を使わない要約: OGP説明文 → 本文先頭 */
export function extractiveSummary(content: string, ogp: OgpInfo): string {
  const base = ogp.description || content;
  return base.length > SUMMARY_MAX_CHARS ? `${base.slice(0, SUMMARY_MAX_CHARS)}…` : base;
}

/** LLM を使わない論点抽出: 本文冒頭の文を、まとまった長さのものから最大3つ拾う */
export function extractiveKeyPoints(content: string): string[] {
  return content
    .split(/(?<=[。．！？!?])|\n/u)
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter((s) => s.length >= 20)
    .slice(0, KEY_POINTS_MAX)
    .map((s) => s.slice(0, KEY_POINT_MAX_CHARS));
}

/** LLM を使わないキー引用抽出: 本文中の「」『』の引用を優先し、無ければ数字を含む文を拾う */
export function extractiveKeyQuotes(content: string): string[] {
  const quoted = [...content.matchAll(/[「『]([^」』]{8,120})[」』]/gu)]
    .map((m) => m[1].replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const pool =
    quoted.length > 0
      ? quoted
      : content
          .split(/(?<=[。．！？!?])|\n/u)
          .map((s) => s.replace(/\s+/gu, " ").trim())
          .filter((s) => s.length >= 20 && /\d/u.test(s));
  return [...new Set(pool)].slice(0, KEY_QUOTES_MAX).map((s) => s.slice(0, KEY_QUOTE_MAX_CHARS));
}

/** 保存済みのハイブリッド要約からも本文部分を取り出せるようにする */
export function articleBody(content: string): string {
  const index = content.indexOf(BODY_MARKER);
  return (index >= 0 ? content.slice(index + BODY_MARKER.length) : content).trim();
}

/**
 * 本文の後半から、数値や逆接・対比・反論を含む文だけを読み順で最大 maxChars 字ぶん拾う。
 * 該当する文が無ければ空文字を返す
 */
export function extractKeySentences(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  const seen = new Set<string>();
  const picked: string[] = [];
  let total = 0;
  for (const raw of text.split(SENTENCE_SPLIT)) {
    if (total >= maxChars) {
      break;
    }
    const sentence = raw.replace(/\s+/gu, " ").trim();
    if (!sentence || seen.has(sentence) || !KEY_SENTENCE_HINT.test(sentence)) {
      continue;
    }
    // 文の間に空白を1文字入れるため、2文目以降はその分だけ枠を減らす
    const room = maxChars - total - (picked.length > 0 ? 1 : 0);
    if (room <= 0) {
      break;
    }
    // 1文だけで枠を超えるときは、最初の1文だけ切り詰めて拾う (2文目以降は飛ばす)
    if (sentence.length > room && picked.length > 0) {
      continue;
    }
    seen.add(sentence);
    const piece = sentence.slice(0, room);
    picked.push(piece);
    total += piece.length + (picked.length > 1 ? 1 : 0);
  }
  return picked.join(" ");
}

/**
 * 先頭部の切出し。maxChars を超えない最後の文末の直後で切る (語中で切らない)。
 * 文末が1つも無ければ maxChars で切る
 */
function headExcerpt(text: string, maxChars: number): string {
  let end = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const at = match.index + match[0].length;
    if (at > maxChars) {
      break;
    }
    end = at;
  }
  return text.slice(0, end > 0 ? end : maxChars);
}

/**
 * 本文の切出し。先頭 800 字に、後半の重要文 (数値・逆接・対比・反論) を最大 700 字ぶん足す。
 * 先頭部は文境界に丸めるため、語中で切れない。
 * 後半に重要文が無ければ、先頭部だけを返す
 */
function bodyExcerpt(content: string): string {
  const flat = articleBody(content).replace(/\s+/gu, " ").trim();
  if (flat.length <= HYBRID_BODY_CHARS) {
    return flat;
  }
  const head = headExcerpt(flat, HYBRID_BODY_HEAD_CHARS);
  const key = extractKeySentences(flat.slice(head.length), HYBRID_BODY_KEY_CHARS);
  return key ? `${head}${HYBRID_BODY_GAP}${key}` : head;
}

const QUOTES_MARKER = "【キー引用】";
const POINTS_MARKER = "【論点】";
/** 見出し (【...】) の直前までを1セクションとして取り出す */
const NEXT_SECTION = /(?=【[^】]+】)/u;

/**
 * 保存済みのハイブリッド要約 (buildArticleSummary の出力) から、
 * 対談プロンプトに渡すキー引用と論点を取り出す。
 * 見出しの無い古いデータでは空配列を返し、summary は元の文字列のままになる。
 */
export function parseArticleSummary(articleSummary: string): {
  keyPoints: string[];
  keyQuotes: string[];
  /** キー引用・論点のセクションを除いた本文 (要約 + 本文冒頭) */
  summary: string;
} {
  const section = (marker: string): string => {
    const index = articleSummary.indexOf(marker);
    if (index < 0) {
      return "";
    }
    const rest = articleSummary.slice(index + marker.length);
    const end = rest.search(NEXT_SECTION);
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  };

  const keyQuotes = section(QUOTES_MARKER)
    .split("\n")
    .map((line) => line.replace(/^[\s「『"]+|[\s」』"]+$/gu, "").trim())
    .filter(Boolean);
  const keyPoints = section(POINTS_MARKER)
    .split("\n")
    .map((line) => line.replace(/^[\s・\-*]+/u, "").trim())
    .filter(Boolean);
  const summary = articleSummary
    .replace(/【キー引用】[\s\S]*?(?=【[^】]+】|$)/u, "")
    .replace(/【論点】[\s\S]*?(?=【[^】]+】|$)/u, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return { keyPoints, keyQuotes, summary };
}

/**
 * 保存用の記事要約。分析要約 (300字) + 論点 + 本文冒頭のハイブリッド。
 * 対談プロンプトの articleSummary にはこの文字列をそのまま渡す。
 */
export function buildArticleSummary(
  analysis: { summary: string; keyPoints?: readonly string[]; keyQuotes?: readonly string[] },
  content: string
): string {
  const sections: string[] = [];
  const summary = analysis.summary.trim();
  if (summary) {
    sections.push(`【要約】\n${summary}`);
  }
  const quotes = (analysis.keyQuotes ?? []).map((q) => q.trim()).filter(Boolean);
  if (quotes.length > 0) {
    sections.push(`【キー引用】\n${quotes.map((q) => `「${q}」`).join("\n")}`);
  }
  const points = (analysis.keyPoints ?? []).map((p) => p.trim()).filter(Boolean);
  if (points.length > 0) {
    sections.push(`【論点】\n${points.map((p) => `- ${p}`).join("\n")}`);
  }
  const body = bodyExcerpt(content);
  if (body) {
    sections.push(`${BODY_MARKER}\n${body}`);
  }
  return sections.join("\n\n");
}

/** 参加人数に応じた発言数 (全員が3回ずつ話せる程度) */
export function defaultTurns(personaCount: number): number {
  return Math.min(9, Math.max(6, personaCount * 3));
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: 32bit整数に丸めるハッシュ計算
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 技術系のジャンルで、その分野に詳しそうなペルソナを見分ける手がかり (役割・性格の文) */
const TECH_HINT = /エンジニア|技術|開発|プログラ|システム|セキュリティ|リサーチャー|アナリスト|研究|サイエンティスト/u;
const GENRE_HINTS: Partial<Record<Genre, RegExp>> = {
  "プログラミング・開発": TECH_HINT,
  "AI・機械学習": TECH_HINT,
  "テクノロジー・ガジェット": TECH_HINT,
  サイエンス: TECH_HINT,
};

/** seed から決まる位置を起点に並べ替える (同じ記事なら同じ順、記事ごとにばらける) */
function rotate<T>(items: T[], seed: string): T[] {
  if (items.length === 0) {
    return [];
  }
  const start = hash(seed) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * URLから決まる順序でペルソナを選ぶ (同じ記事なら同じ顔ぶれ、記事ごとにばらける)。
 * ジャンルが技術系なら、その分野に詳しそうな役割 (エンジニアなど) を優先して入れる。
 * ただし議論に幅が出るよう、候補が足りれば1人は別の持ち味のペルソナにする
 */
export function fallbackPersonas(
  candidates: PersonaCandidate[],
  seed: string,
  count = MIN_PERSONAS,
  genre?: Genre
): string[] {
  const size = Math.min(count, candidates.length);
  const hint = genre ? GENRE_HINTS[genre] : undefined;
  const matched = hint ? candidates.filter((c) => hint.test(`${c.role} ${c.personality}`)) : [];
  if (matched.length === 0) {
    return rotate(candidates, seed)
      .slice(0, size)
      .map((c) => c.id);
  }
  const rotatedMatched = rotate(matched, seed);
  const others = rotate(
    candidates.filter((c) => !matched.includes(c)),
    seed
  );
  const picked = [...rotatedMatched.slice(0, Math.max(size - 1, 1)), ...others];
  // 別の持ち味のペルソナが足りないときは、残りも該当する側から補う
  for (const c of rotatedMatched) {
    if (!picked.includes(c)) {
      picked.push(c);
    }
  }
  return picked.slice(0, size).map((c) => c.id);
}

/** 論点の重複判定に使う文字 n-gram の長さと、重複とみなす Jaccard 類似度 */
const KEY_POINT_GRAM = 4;
const KEY_POINT_DUPLICATE_SIMILARITY = 0.5;

/**
 * 本文との突き合わせで無視する文字 (空白・句読点・括弧・約物)。
 * LLM が引用符や読点を足したり落としたりしても、本文と照合できるようにする
 */
const MATCH_NOISE =
  /[\s。、．.，,・･:：;；!?！？…‥「」『』（）()［］\u005B\u005D【】〈〉《》〔〕｛｝{}＜＞<>"'“”‘’‐‑–—―~〜=＝+＋*＊/／\\|｜#＃&＆@＠^＾%％$＄¥￥`｀°-]+/gu;

/**
 * 本文との突き合わせ用の正規化。全半角・大文字小文字・空白・約物の違いをすべて吸収する。
 * 引用符や末尾の句読点だけでなく、文中の読点や括弧の有無も無視する
 */
function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(MATCH_NOISE, "");
}

/**
 * 論点の類似度用の正規化。空白・全半角・大文字小文字・末尾の句読点だけを吸収する。
 * 重複判定の挙動を変えないよう、引用の照合とは別に保つ
 */
function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^[\s「『“”"'’]+|[\s」』“”"'’]+$/gu, "")
    .replace(/\s+/gu, "")
    .replace(/[。．.、,，!?！？…]+$/u, "")
    .toLowerCase();
}

/** 文字 n-gram の集合 (短い文字列はその文字列自体を1件として扱う) */
function ngramSet(text: string): Set<string> {
  const normalized = normalizeForSimilarity(text);
  if (!normalized) {
    return new Set();
  }
  if (normalized.length <= KEY_POINT_GRAM) {
    return new Set([normalized]);
  }
  const grams = new Set<string>();
  for (let i = 0; i + KEY_POINT_GRAM <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + KEY_POINT_GRAM));
  }
  return grams;
}

/** 文字4-gramの Jaccard 係数。語順や助詞の違いに強い簡易な類似度 */
export function keyPointSimilarity(a: string, b: string): number {
  const left = ngramSet(a);
  const right = ngramSet(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      intersection++;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

/** 似すぎた論点 (Jaccard > 0.5) を落とし、後ろの候補を繰り上げて最大3つにする */
function dedupeKeyPoints(points: string[]): string[] {
  const kept: string[] = [];
  for (const point of points) {
    if (kept.some((k) => keyPointSimilarity(point, k) > KEY_POINT_DUPLICATE_SIMILARITY)) {
      continue;
    }
    kept.push(point);
    if (kept.length >= KEY_POINTS_MAX) {
      break;
    }
  }
  return kept;
}

/**
 * 引用の照合で、完全な包含に加えて許容する揺れ。
 * 引用にだけ現れる文字 (本文に無い語の足し込み) を、この割合・長さまでなら見逃す。
 * 数値の改変 (3社→5社 など) は幻覚として落としたいので、数字の食い違いは別途禁じる
 */
const QUOTE_MATCH_MIN_COVERAGE = 0.9;
/** 一致が途切れてよい連続文字数 (これを超える足し込みは引用とみなさない) */
const QUOTE_MATCH_MAX_GAP = 2;
/** 被覆率で判定する最短の引用長 (短い引用は完全一致のみ認める) */
const QUOTE_MATCH_MIN_CHARS = 8;

/**
 * needle の start 文字目から伸ばせる最長の一致を二分探索で求め、
 * 本文側の開始位置と一致長を返す (見つからなければ length は 0)
 */
function longestMatchFrom(
  needle: string,
  start: number,
  content: string,
  from: number
): { at: number; length: number } {
  let best = 0;
  let bestAt = 0;
  let lo = 1;
  let hi = needle.length - start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const at = content.indexOf(needle.slice(start, start + mid), from);
    if (at < 0) {
      hi = mid - 1;
      continue;
    }
    best = mid;
    bestAt = at;
    lo = mid + 1;
  }
  return { at: bestAt, length: best };
}

/**
 * 正規化済みの引用が本文中に実在するか。
 * まず包含判定 (約物・空白・全半角・大小文字の差は normalizeForMatch で吸収済み) を見て、
 * 一致しない場合だけ、本文側の語順を保ったまま断片をたどる被覆率で判定する。
 * 本文から語を落とした引用 (「…」での省略や文の連結) は cursor が進むだけで減点されない
 */
function isGroundedIn(needle: string, normalizedContent: string): boolean {
  if (!needle) {
    return false;
  }
  if (normalizedContent.includes(needle)) {
    return true;
  }
  if (needle.length < QUOTE_MATCH_MIN_CHARS) {
    return false;
  }
  const required = needle.length * QUOTE_MATCH_MIN_COVERAGE;
  let covered = 0;
  let cursor = 0;
  let previousEnd = -1;
  let jumped = 0;
  let skippedRun = 0;
  let i = 0;
  while (i < needle.length) {
    // 残りをすべて一致させても閾値に届かないなら、ここで打ち切る
    if (covered + (needle.length - i) < required) {
      return false;
    }
    const match = longestMatchFrom(needle, i, normalizedContent, cursor);
    if (match.length === 0) {
      // 数字の食い違いは数値の改変なので、たとえ1文字でも引用として認めない
      if (/\d/u.test(needle[i])) {
        return false;
      }
      i += 1;
      skippedRun += 1;
      if (skippedRun > QUOTE_MATCH_MAX_GAP) {
        return false;
      }
      continue;
    }
    // 飛ばした本文が引用の長さを超えるなら、離れた文を継ぎ合わせた幻覚とみなす
    if (previousEnd >= 0) {
      jumped += Math.max(0, match.at - previousEnd);
      if (jumped > needle.length) {
        return false;
      }
    }
    covered += match.length;
    previousEnd = match.at + match.length;
    cursor = previousEnd;
    i += match.length;
    skippedRun = 0;
  }
  return covered >= required;
}

/**
 * 引用を本文と突き合わせ、本文に実在しない引用 (幻覚) を落とす。
 * 落とした分は本文からの抜き出し (extractiveKeyQuotes) で補充する。
 */
function groundKeyQuotes(quotes: string[], content: string): string[] {
  const normalizedContent = normalizeForMatch(content);
  const candidates = quotes.slice(0, KEY_QUOTES_MAX);
  const seen = new Set<string>();
  const grounded: string[] = [];
  for (const quote of candidates) {
    const needle = normalizeForMatch(quote);
    if (!needle || seen.has(needle) || !isGroundedIn(needle, normalizedContent)) {
      continue;
    }
    seen.add(needle);
    grounded.push(quote);
  }
  // 本文に無い引用 (幻覚) を落とした分だけ、本文からの抜き出しで補充する
  const target = Math.min(KEY_QUOTES_MAX, new Set(candidates.map(normalizeForMatch).filter(Boolean)).size);
  for (const quote of extractiveKeyQuotes(content)) {
    if (grounded.length >= target) {
      break;
    }
    const needle = normalizeForMatch(quote);
    if (!needle || seen.has(needle)) {
      continue;
    }
    seen.add(needle);
    grounded.push(quote);
  }
  return grounded;
}

/** LLM が返した JSON を検証して、分析結果の形に整える */
function normalizeAnalysis(
  raw: Record<string, unknown>,
  candidates: PersonaCandidate[],
  /** 本文。渡されたときだけ引用を本文と突き合わせる (幻覚引用の除去) */
  content?: string,
  /** false にすると導入前の挙動 (論点の重複除去・引用のグラウンディングをしない) に戻す */
  options: { top3?: boolean } = {}
): ParsedAnalysis {
  const top3 = options.top3 !== false;
  const valid = new Set(candidates.map((c) => c.id));
  const ids: string[] = Array.isArray(raw.personaIds)
    ? [
        ...new Set<string>(
          raw.personaIds.filter((id: unknown): id is string => typeof id === "string" && valid.has(id))
        ),
      ]
    : [];

  const rawPoints = Array.isArray(raw.keyPoints)
    ? [
        ...new Set(
          raw.keyPoints
            .filter((p: unknown): p is string => typeof p === "string")
            .map((p) => p.replace(/\s+/gu, " ").trim())
            .filter(Boolean)
            .map((p) => p.slice(0, KEY_POINT_MAX_CHARS))
        ),
      ]
    : [];
  const keyPoints = top3 ? dedupeKeyPoints(rawPoints) : rawPoints.slice(0, KEY_POINTS_MAX);

  const quoteSource = Array.isArray(raw.keyQuotes) ? raw.keyQuotes : raw.key_quotes;
  const rawQuotes = Array.isArray(quoteSource) ? quoteSource : [];
  const normalizedQuotes = [
    ...new Set(
      rawQuotes
        .filter((q: unknown): q is string => typeof q === "string")
        .map((q) =>
          q
            .replace(/^[「『"]|[」』"]$/gu, "")
            .replace(/\s+/gu, " ")
            .trim()
        )
        .filter(Boolean)
        .map((q) => q.slice(0, KEY_QUOTE_MAX_CHARS))
    ),
  ];
  // 本文が分からないとき (直接 parseAnalysis を呼ぶ場合) は従来どおり検証しない
  const keyQuotes =
    top3 && typeof content === "string"
      ? groundKeyQuotes(normalizedQuotes, content)
      : normalizedQuotes.slice(0, KEY_QUOTES_MAX);

  const result: ParsedAnalysis = {
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, SUMMARY_MAX_CHARS * 2)
        : undefined,
    genre: isGenre(raw.genre) ? raw.genre : undefined,
    personaIds: ids.length > 0 ? ids.slice(0, MAX_PERSONAS) : undefined,
    adult: typeof raw.adult === "boolean" ? raw.adult : undefined,
  };
  if (keyPoints.length > 0) {
    result.keyPoints = keyPoints;
  }
  if (keyQuotes.length > 0) {
    result.keyQuotes = keyQuotes;
  }
  return result;
}

/** LLMの出力から JSON を取り出し、ジャンル・ペルソナIDを検証して返す。不正な項目は捨てる */
export function parseAnalysis(text: string, candidates: PersonaCandidate[], content?: string): ParsedAnalysis {
  const extracted = extractJsonObject(text);
  return extracted ? normalizeAnalysis(extracted.raw, candidates, content) : {};
}

/** 参加者が足りなければ補い、候補が複数あるのに1人だけにならないようにする */
function completePersonas(
  chosen: string[] | undefined,
  candidates: PersonaCandidate[],
  seed: string,
  genre: Genre
): string[] {
  const ids = [...(chosen ?? [])];
  if (ids.length >= Math.min(MIN_PERSONAS, candidates.length)) {
    return ids;
  }
  for (const id of fallbackPersonas(candidates, seed, MAX_PERSONAS, genre)) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= MIN_PERSONAS) {
      break;
    }
  }
  return ids;
}

/**
 * 応答の良さ。要約・ジャンル・ペルソナIDは無いとフォールバックになるため重く数え、
 * 途中で切れた応答は同点なら負けにする (欠けた項目の多さより、切れていないことを優先する)
 */
function analysisScore(parsed: ParsedAnalysis, truncated: boolean): number {
  const required = [parsed.summary, parsed.genre, parsed.personaIds].filter((v) => v !== undefined).length;
  const optional = [parsed.keyPoints, parsed.keyQuotes, parsed.adult].filter((v) => v !== undefined).length;
  return required * 2 + optional - (truncated ? 1 : 0);
}

/**
 * 記事を分析し、短い要約・ジャンル・対談に参加するペルソナを一度のLLM呼び出しで決める。
 * 失敗してもセッション作成は止めず、ヒューリスティックにフォールバックする。
 */
function extractiveFallback(
  article: { title: string; content: string; ogp: OgpInfo; normalizedUrl: string },
  candidates: PersonaCandidate[]
): Analysis {
  const adultByKeywords = looksAdult(
    `${article.title}\n${article.ogp.description ?? ""}\n${article.content.slice(0, 3000)}`
  );
  const guessedGenre = guessGenre(`${article.title}\n${article.content.slice(0, 1500)}`);
  return {
    summary: extractiveSummary(article.content, article.ogp),
    keyPoints: extractiveKeyPoints(article.content),
    keyQuotes: extractiveKeyQuotes(article.content),
    genre: guessedGenre,
    personaIds: fallbackPersonas(candidates, article.normalizedUrl, MIN_PERSONAS, guessedGenre),
    adult: adultByKeywords,
  };
}

export async function analyzeArticle(
  env: Env,
  sessionId: string,
  article: { title: string; content: string; ogp: OgpInfo; normalizedUrl: string },
  candidates: PersonaCandidate[],
  complete: typeof generateChatCompletion = generateChatCompletion
): Promise<Analysis> {
  // A/B比較用: SUMMARY_TOP3=off で導入前の挙動 (制約文なし・引用検証/重複除去なし) に戻す
  const top3 = env.SUMMARY_TOP3 !== "off";
  const fallback = extractiveFallback(article, candidates);
  const adultByKeywords = fallback.adult;

  const apiKey = env.OPENCODE_API_KEY;
  // 未設定時は generateChatCompletion がデモ用の対談文を返してしまうため呼ばない
  if (!apiKey || apiKey === "your-opencode-api-key-here" || !article.content) {
    return fallback;
  }

  // 先頭の候補に偏らないよう、URLごとに候補の並びを回転させる
  const offset = hash(article.normalizedUrl) % candidates.length;
  const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  const messages = buildAnalyzeMessages({
    title: article.title,
    content: article.content,
    genres: GENRES,
    minPersonas: MIN_PERSONAS,
    maxPersonas: MAX_PERSONAS,
    candidates: rotated,
  });
  if (!top3) {
    messages[0].content = stripTop3Constraints(messages[0].content);
  }

  // 通信の失敗・JSON として読めない応答・トークン上限で切れた応答は、1回だけやり直す。
  // 切れていても読めた項目は保持しておき、やり直しも失敗したらそれを使う
  let parsed: ParsedAnalysis = {};
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let attempt = 1; attempt <= ANALYZE_ATTEMPTS; attempt++) {
    try {
      const text = await complete(messages, env, sessionId, undefined, {
        maxOutputTokens: ANALYZE_MAX_OUTPUT_TOKENS,
      });
      const extracted = extractJsonObject(text);
      const current = extracted ? normalizeAnalysis(extracted.raw, candidates, article.content, { top3 }) : {};
      const truncated = extracted?.truncated ?? false;
      // 2回目の応答が空でも、1回目に読めた部分結果を捨てず、良い方 (より揃っている方) を残す
      const score = analysisScore(current, truncated);
      if (score > bestScore) {
        parsed = current;
        bestScore = score;
      }
      if (current.summary && current.genre && current.personaIds && !truncated) {
        break;
      }
      console.warn(
        `analyzeArticle: incomplete response (attempt ${attempt}/${ANALYZE_ATTEMPTS}) session=${sessionId} ` +
          `truncated=${truncated} ` +
          `has summary=${!!current.summary} genre=${!!current.genre} personaIds=${!!current.personaIds} ` +
          `head=${JSON.stringify(text.slice(0, 200))}`
      );
    } catch (err) {
      console.warn(`analyzeArticle: call failed (attempt ${attempt}/${ANALYZE_ATTEMPTS}) session=${sessionId}:`, err);
    }
  }

  // 取れた項目は使い、欠けた項目だけキーワードによる簡易な判定で補う
  const genre = parsed.genre ?? fallback.genre;
  return {
    summary: parsed.summary ?? fallback.summary,
    keyPoints: parsed.keyPoints ?? fallback.keyPoints,
    keyQuotes: parsed.keyQuotes ?? fallback.keyQuotes,
    genre,
    personaIds: completePersonas(parsed.personaIds, candidates, article.normalizedUrl, genre),
    // LLM が false でも、強い語が複数あれば成人向けとして扱う
    adult: (parsed.adult ?? false) || adultByKeywords,
  };
}
