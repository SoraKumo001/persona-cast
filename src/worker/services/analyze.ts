import { Env } from "../types";
import { generateChatCompletion } from "./llm";
import { OgpInfo } from "./scraper";
import { DEFAULT_GENRE, GENRES, Genre, guessGenre, isGenre } from "./genres";
import { buildAnalyzeMessages } from "../prompts";

const SUMMARY_MAX_CHARS = 200;
const MIN_PERSONAS = 2;
const MAX_PERSONAS = 3;

export interface PersonaCandidate {
  id: string;
  name: string;
  role: string;
  personality: string;
}

export interface Analysis {
  summary: string;
  genre: Genre;
  personaIds: string[];
}

/** LLM を使わない要約: OGP説明文 → 本文先頭 */
export function extractiveSummary(content: string, ogp: OgpInfo): string {
  const base = ogp.description || content;
  return base.length > SUMMARY_MAX_CHARS ? base.slice(0, SUMMARY_MAX_CHARS) + "…" : base;
}

/** 参加人数に応じた発言数 (全員が3回ずつ話せる程度) */
export function defaultTurns(personaCount: number): number {
  return Math.min(9, Math.max(6, personaCount * 3));
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** URLから決まる順序でペルソナを選ぶ (同じ記事なら同じ顔ぶれ、記事ごとにばらける) */
export function fallbackPersonas(candidates: PersonaCandidate[], seed: string, count = MIN_PERSONAS): string[] {
  if (candidates.length === 0) return [];
  const start = hash(seed) % candidates.length;
  return Array.from({ length: Math.min(count, candidates.length) }, (_, i) => candidates[(start + i) % candidates.length].id);
}

/** LLMの出力から JSON を取り出し、ジャンル・ペルソナIDを検証して返す。不正な項目は捨てる */
export function parseAnalysis(
  text: string,
  candidates: PersonaCandidate[]
): { summary?: string; genre?: Genre; personaIds?: string[] } {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return {};
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }

  const valid = new Set(candidates.map((c) => c.id));
  const ids: string[] = Array.isArray(raw.personaIds)
    ? [...new Set<string>(raw.personaIds.filter((id: unknown): id is string => typeof id === "string" && valid.has(id)))]
    : [];

  return {
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_CHARS * 2) : undefined,
    genre: isGenre(raw.genre) ? raw.genre : undefined,
    personaIds: ids.length > 0 ? ids.slice(0, MAX_PERSONAS) : undefined,
  };
}

/** 参加者が足りなければ補い、候補が複数あるのに1人だけにならないようにする */
function completePersonas(chosen: string[] | undefined, candidates: PersonaCandidate[], seed: string): string[] {
  const ids = [...(chosen ?? [])];
  if (ids.length >= Math.min(MIN_PERSONAS, candidates.length)) return ids;
  for (const id of fallbackPersonas(candidates, seed, MAX_PERSONAS)) {
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= MIN_PERSONAS) break;
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
  const fallback: Analysis = {
    summary: extractiveSummary(article.content, article.ogp),
    genre: guessGenre(`${article.title}\n${article.content.slice(0, 1500)}`),
    personaIds: fallbackPersonas(candidates, article.normalizedUrl),
  };

  const apiKey = env.OPENCODE_API_KEY;
  // 未設定時は generateChatCompletion がデモ用の対談文を返してしまうため呼ばない
  if (!apiKey || apiKey === "your-opencode-api-key-here" || !article.content) return fallback;

  try {
    const text = await generateChatCompletion(
      buildAnalyzeMessages({
        title: article.title,
        content: article.content,
        genres: GENRES,
        minPersonas: MIN_PERSONAS,
        maxPersonas: MAX_PERSONAS,
        candidates,
      }),
      env,
      sessionId
    );

    const parsed = parseAnalysis(text, candidates);
    return {
      summary: parsed.summary ?? fallback.summary,
      genre: parsed.genre ?? fallback.genre,
      personaIds: completePersonas(parsed.personaIds, candidates, article.normalizedUrl),
    };
  } catch (err) {
    console.warn("analyzeArticle failed, using fallback:", err);
    return fallback;
  }
}

export { DEFAULT_GENRE };
