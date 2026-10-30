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
/** 保存する本文冒頭の長さ (分析要約・論点と合わせて 3000 字弱に収める) */
const HYBRID_BODY_CHARS = 1500;
const BODY_MARKER = "【本文冒頭】";
const MIN_PERSONAS = 3;
const MAX_PERSONAS = 4;
/** 分析の LLM 呼び出しを試す回数 (1回目が失敗・不完全だったときに、1回だけやり直す) */
const ANALYZE_ATTEMPTS = 2;
/** 分析は要約・論点・引用・ジャンル・ペルソナIDを1つの JSON で返すため、途切れないよう長めに取る */
const ANALYZE_MAX_OUTPUT_TOKENS = 2000;

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
  const body = articleBody(content).replace(/\s+/gu, " ").trim().slice(0, HYBRID_BODY_CHARS);
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

/** LLM が返した JSON を検証して、分析結果の形に整える */
function normalizeAnalysis(raw: Record<string, unknown>, candidates: PersonaCandidate[]): ParsedAnalysis {
  const valid = new Set(candidates.map((c) => c.id));
  const ids: string[] = Array.isArray(raw.personaIds)
    ? [
        ...new Set<string>(
          raw.personaIds.filter((id: unknown): id is string => typeof id === "string" && valid.has(id))
        ),
      ]
    : [];

  const keyPoints = Array.isArray(raw.keyPoints)
    ? [
        ...new Set(
          raw.keyPoints
            .filter((p: unknown): p is string => typeof p === "string")
            .map((p) => p.replace(/\s+/gu, " ").trim())
            .filter(Boolean)
            .map((p) => p.slice(0, KEY_POINT_MAX_CHARS))
        ),
      ].slice(0, KEY_POINTS_MAX)
    : [];

  const quoteSource = Array.isArray(raw.keyQuotes) ? raw.keyQuotes : raw.key_quotes;
  const rawQuotes = Array.isArray(quoteSource) ? quoteSource : [];
  const keyQuotes = [
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
  ].slice(0, KEY_QUOTES_MAX);

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
export function parseAnalysis(text: string, candidates: PersonaCandidate[]): ParsedAnalysis {
  const extracted = extractJsonObject(text);
  return extracted ? normalizeAnalysis(extracted.raw, candidates) : {};
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
 * 記事を分析し、短い要約・ジャンル・対談に参加するペルソナを一度のLLM呼び出しで決める。
 * 失敗してもセッション作成は止めず、ヒューリスティックにフォールバックする。
 */
export async function analyzeArticle(
  env: Env,
  sessionId: string,
  article: { title: string; content: string; ogp: OgpInfo; normalizedUrl: string },
  candidates: PersonaCandidate[],
  complete: typeof generateChatCompletion = generateChatCompletion
): Promise<Analysis> {
  const adultByKeywords = looksAdult(
    `${article.title}\n${article.ogp.description ?? ""}\n${article.content.slice(0, 3000)}`
  );
  const guessedGenre = guessGenre(`${article.title}\n${article.content.slice(0, 1500)}`);
  const fallback: Analysis = {
    summary: extractiveSummary(article.content, article.ogp),
    keyPoints: extractiveKeyPoints(article.content),
    keyQuotes: extractiveKeyQuotes(article.content),
    genre: guessedGenre,
    personaIds: fallbackPersonas(candidates, article.normalizedUrl, MIN_PERSONAS, guessedGenre),
    adult: adultByKeywords,
  };

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

  // 通信の失敗・JSON として読めない応答・トークン上限で切れた応答は、1回だけやり直す。
  // 切れていても読めた項目は保持しておき、やり直しも失敗したらそれを使う
  let parsed: ParsedAnalysis = {};
  for (let attempt = 1; attempt <= ANALYZE_ATTEMPTS; attempt++) {
    try {
      const text = await complete(messages, env, sessionId, undefined, {
        maxOutputTokens: ANALYZE_MAX_OUTPUT_TOKENS,
      });
      const extracted = extractJsonObject(text);
      const current = extracted ? normalizeAnalysis(extracted.raw, candidates) : {};
      parsed = current;
      if (current.summary && current.genre && current.personaIds && !extracted?.truncated) {
        break;
      }
      console.warn(
        `analyzeArticle: incomplete response (attempt ${attempt}/${ANALYZE_ATTEMPTS}) session=${sessionId} ` +
          `truncated=${extracted?.truncated ?? false} ` +
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
