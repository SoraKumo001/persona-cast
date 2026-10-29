import { buildAnalyzeMessages } from "../prompts";
import type { Env } from "../types";
import { looksAdult } from "./adult-filter";
import { GENRES, type Genre, guessGenre, isGenre } from "./genres";
import { generateChatCompletion } from "./llm";
import type { OgpInfo } from "./scraper";

const SUMMARY_MAX_CHARS = 200;
const MIN_PERSONAS = 3;
const MAX_PERSONAS = 4;
/** 分析の LLM 呼び出しを試す回数 (1回目が失敗・不完全だったときに、1回だけやり直す) */
const ANALYZE_ATTEMPTS = 2;

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
  personaIds: string[];
  summary: string;
}

/** LLM を使わない要約: OGP説明文 → 本文先頭 */
export function extractiveSummary(content: string, ogp: OgpInfo): string {
  const base = ogp.description || content;
  return base.length > SUMMARY_MAX_CHARS ? `${base.slice(0, SUMMARY_MAX_CHARS)}…` : base;
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

/** LLMの出力から JSON を取り出し、ジャンル・ペルソナIDを検証して返す。不正な項目は捨てる */
export function parseAnalysis(
  text: string,
  candidates: PersonaCandidate[]
): { summary?: string; genre?: Genre; personaIds?: string[]; adult?: boolean } {
  const json = text.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) {
    return {};
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }

  const valid = new Set(candidates.map((c) => c.id));
  const ids: string[] = Array.isArray(raw.personaIds)
    ? [
        ...new Set<string>(
          raw.personaIds.filter((id: unknown): id is string => typeof id === "string" && valid.has(id))
        ),
      ]
    : [];

  return {
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

  // 通信の失敗や、JSON として読めない・項目が欠けた応答は、1回だけやり直す。失敗の理由はログに残す
  let parsed: ReturnType<typeof parseAnalysis> = {};
  for (let attempt = 1; attempt <= ANALYZE_ATTEMPTS; attempt++) {
    try {
      const text = await complete(messages, env, sessionId);
      parsed = parseAnalysis(text, candidates);
      if (parsed.summary && parsed.genre && parsed.personaIds) {
        break;
      }
      console.warn(
        `analyzeArticle: incomplete response (attempt ${attempt}/${ANALYZE_ATTEMPTS}) session=${sessionId} ` +
          `has summary=${!!parsed.summary} genre=${!!parsed.genre} personaIds=${!!parsed.personaIds} ` +
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
    genre,
    personaIds: completePersonas(parsed.personaIds, candidates, article.normalizedUrl, genre),
    // LLM が false でも、強い語が複数あれば成人向けとして扱う
    adult: (parsed.adult ?? false) || adultByKeywords,
  };
}
