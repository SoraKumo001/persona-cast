import { errorMessage } from "../errors";
import { buildStanceMessages } from "../prompts";
import type { Env, Persona } from "../types";
import { extractJsonObject } from "./json-object";
import { type ChatMessage, generateChatCompletion } from "./llm";

/** 立場の最大文字数。プロンプト・パース後の両方でこの長さに収める */
export const STANCE_MAX_CHARS = 200;

/** 1ペルソナ分の立場。対談の出発点としてだけ使い、永続化しない (エフェメラル) */
export interface Stance {
  claim: string;
  counter: string;
  reason: string;
}

export interface GenerateStancesParams {
  personas: Persona[];
  articleTitle: string;
  articleSummary: string;
  articleKeyQuotes?: string;
  keyPoints?: readonly string[] | string;
}

export interface GenerateStancesOptions {
  /** テストや差し替え用。既定は通常の一括生成 */
  generate?: typeof generateChatCompletion;
  modelName?: string;
}

/** 項目ごとの上限。合計が 200 字に収まるよう、プロンプトの指定と揃えておく */
const STANCE_FIELD_LIMITS = { claim: 40, reason: 70, counter: 50 } as const;

/**
 * 立場 JSON は 3 項目 (合計 200 字) だけだが、日本語はトークン効率が悪く、
 * 途中で切れると JSON として読めなくなる。余裕を持って長めに取る
 */
const STANCE_MAX_OUTPUT_TOKENS = 800;

/** 立場生成の試行回数 (読めない応答・失敗時に1回だけやり直す) */
const STANCE_ATTEMPTS = 2;

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

/** 壊れたJSONでも拾えるように、最後の手段としてフィールドを正規表現で抜く */
function extractField(raw: string, name: string): string {
  const matched = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "u").exec(raw);
  if (!matched) {
    return "";
  }
  return toText(matched[1].replace(/\\"/gu, '"'));
}

/**
 * LLMの応答から立場を取り出す。
 * コードフェンスや前置きが付いていてもよく、トークン上限で切れた JSON も補完して読む。
 * 3項目が空なら null (立場なしとして扱う)。
 */
export function parseStance(raw: string): string | null {
  const cleaned = raw
    .replace(/```json/giu, "")
    .replace(/```/gu, "")
    .trim();

  const parsed = extractJsonObject(cleaned)?.raw ?? {};

  const claim = toText(parsed.claim) || extractField(cleaned, "claim");
  const reason = toText(parsed.reason) || extractField(cleaned, "reason");
  const counter = toText(parsed.counter) || extractField(cleaned, "counter");

  if (!(claim || reason || counter)) {
    return null;
  }

  const formatted = [
    claim ? `主張: ${clampText(claim, STANCE_FIELD_LIMITS.claim)}` : "",
    reason ? `根拠: ${clampText(reason, STANCE_FIELD_LIMITS.reason)}` : "",
    counter ? `反論: ${clampText(counter, STANCE_FIELD_LIMITS.counter)}` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return formatted.length > STANCE_MAX_CHARS ? `${formatted.slice(0, STANCE_MAX_CHARS - 1)}…` : formatted;
}

/**
 * Phase 1: 全ペルソナ分の立場を並列生成する (逐次ループ禁止)。
 * 1人分が失敗しても、その人だけ立場なしで続行できるよう Map から欠落させる。例外は投げない。
 */
export async function generateStances(
  params: GenerateStancesParams,
  env: Env,
  sessionId: string,
  options: GenerateStancesOptions = {}
): Promise<Map<string, string>> {
  const generate = options.generate ?? generateChatCompletion;

  const results = await Promise.allSettled(
    params.personas.map(async (persona) => {
      const messages: ChatMessage[] = buildStanceMessages({
        currentPersona: persona,
        allPersonas: params.personas,
        articleTitle: params.articleTitle,
        articleSummary: params.articleSummary,
        articleKeyQuotes: params.articleKeyQuotes,
        keyPoints: params.keyPoints,
      });
      // 読めない応答 (JSON 崩れ・途中切れ) と通信失敗は、1回だけやり直す
      for (let attempt = 1; attempt <= STANCE_ATTEMPTS; attempt++) {
        try {
          const raw = await generate(messages, env, sessionId, options.modelName, {
            maxOutputTokens: STANCE_MAX_OUTPUT_TOKENS,
          });
          const stance = parseStance(raw);
          if (stance) {
            return { personaId: persona.id, stance };
          }
          console.warn(
            `Stance generation returned no parsable stance for ${persona.id} ` +
              `(attempt ${attempt}/${STANCE_ATTEMPTS}) head=${JSON.stringify(raw.slice(0, 200))}`
          );
        } catch (err) {
          console.warn(
            `Stance generation failed for ${persona.id} (attempt ${attempt}/${STANCE_ATTEMPTS}):`,
            errorMessage(err)
          );
        }
      }
      return { personaId: persona.id, stance: null };
    })
  );

  const stances = new Map<string, string>();
  for (const [index, result] of results.entries()) {
    const personaId = params.personas[index]?.id;
    if (!personaId) {
      continue;
    }
    if (result.status === "fulfilled" && result.value.stance) {
      stances.set(personaId, result.value.stance);
    } else if (result.status === "rejected") {
      // 立場生成の失敗は対談本体を止めない
      console.warn(`Stance generation failed for ${personaId}:`, errorMessage(result.reason));
    }
  }
  return stances;
}
