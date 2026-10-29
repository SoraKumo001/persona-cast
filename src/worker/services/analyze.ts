import { buildAnalyzeMessages } from "../prompts";
import type { Env } from "../types";
import { looksAdult } from "./adult-filter";
import { GENRES, type Genre, guessGenre, isGenre } from "./genres";
import { generateChatCompletion } from "./llm";
import type { OgpInfo } from "./scraper";

const SUMMARY_MAX_CHARS = 200;
const MIN_PERSONAS = 3;
const MAX_PERSONAS = 4;

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

/** URLから決まる順序でペルソナを選ぶ (同じ記事なら同じ顔ぶれ、記事ごとにばらける) */
export function fallbackPersonas(candidates: PersonaCandidate[], seed: string, count = MIN_PERSONAS): string[] {
  if (candidates.length === 0) {
    return [];
  }
  const start = hash(seed) % candidates.length;
  return Array.from(
    { length: Math.min(count, candidates.length) },
    (_, i) => candidates[(start + i) % candidates.length].id
  );
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
function completePersonas(chosen: string[] | undefined, candidates: PersonaCandidate[], seed: string): string[] {
  const ids = [...(chosen ?? [])];
  if (ids.length >= Math.min(MIN_PERSONAS, candidates.length)) {
    return ids;
  }
  for (const id of fallbackPersonas(candidates, seed, MAX_PERSONAS)) {
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
  candidates: PersonaCandidate[]
): Promise<Analysis> {
  const adultByKeywords = looksAdult(
    `${article.title}\n${article.ogp.description ?? ""}\n${article.content.slice(0, 3000)}`
  );
  const fallback: Analysis = {
    summary: extractiveSummary(article.content, article.ogp),
    genre: guessGenre(`${article.title}\n${article.content.slice(0, 1500)}`),
    personaIds: fallbackPersonas(candidates, article.normalizedUrl),
    adult: adultByKeywords,
  };

  const apiKey = env.OPENCODE_API_KEY;
  // 未設定時は generateChatCompletion がデモ用の対談文を返してしまうため呼ばない
  if (!apiKey || apiKey === "your-opencode-api-key-here" || !article.content) {
    return fallback;
  }

  try {
    // 先頭の候補に偏らないよう、URLごとに候補の並びを回転させる
    const offset = hash(article.normalizedUrl) % candidates.length;
    const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
    const text = await generateChatCompletion(
      buildAnalyzeMessages({
        title: article.title,
        content: article.content,
        genres: GENRES,
        minPersonas: MIN_PERSONAS,
        maxPersonas: MAX_PERSONAS,
        candidates: rotated,
      }),
      env,
      sessionId
    );

    const parsed = parseAnalysis(text, candidates);
    return {
      summary: parsed.summary ?? fallback.summary,
      genre: parsed.genre ?? fallback.genre,
      personaIds: completePersonas(parsed.personaIds, candidates, article.normalizedUrl),
      // LLM が false でも、強い語が複数あれば成人向けとして扱う
      adult: (parsed.adult ?? false) || adultByKeywords,
    };
  } catch (err) {
    console.warn("analyzeArticle failed, using fallback:", err);
    return fallback;
  }
}
