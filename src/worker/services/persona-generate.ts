import { buildPersonaGenerateMessages } from "../prompts";
import type { Env } from "../types";
import { type ChatMessage, generateChatCompletion } from "./llm";

export interface PersonaDraft {
  avatar: string;
  name: string;
  personality: string;
  role: string;
  speakingStyle: string;
  themeColor: string;
}

/** 既存ペルソナの要約 (新規生成時に、被らない個性にするための参考) */
export interface PersonaBrief {
  name: string;
  role: string;
  themeColor: string;
}

const LIMITS = { name: 40, role: 40, personality: 600, speakingStyle: 400 } as const;
const DEFAULT_COLOR = "#6366f1";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

export const INSTRUCTION_MAX_CHARS = 500;

export function isLlmConfigured(env: Env): boolean {
  return !!env.OPENCODE_API_KEY && env.OPENCODE_API_KEY !== "your-opencode-api-key-here";
}

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * LLMの出力からJSONを取り出し、各項目を検証・整形して返す。
 * 必須項目(名前・性格・口調)が欠けている場合は null。色が不正ならフォールバック色を使う。
 */
export function parsePersonaDraft(text: string, fallbackColor: string = DEFAULT_COLOR): PersonaDraft | null {
  const json = text.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) {
    return null;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const name = clip(raw.name, LIMITS.name);
  const personality = clip(raw.personality, LIMITS.personality);
  const speakingStyle = clip(raw.speakingStyle, LIMITS.speakingStyle);
  if (!(name && personality && speakingStyle)) {
    return null;
  }

  const color = typeof raw.themeColor === "string" ? raw.themeColor.trim() : "";
  const avatar = clip(raw.avatar, 8);

  return {
    name,
    role: clip(raw.role, LIMITS.role) || "コメンテーター",
    avatar: avatar || "🎙️",
    themeColor: HEX_COLOR.test(color) ? color.toLowerCase() : fallbackColor,
    personality,
    speakingStyle,
  };
}

const EXAMPLE = {
  name: "ケン (Ken)",
  role: "辛口シニアエンジニア",
  avatar: "💻",
  themeColor: "#2563eb",
  personality:
    "技術的な実現可能性、アーキテクチャの堅牢性、保守性、技術的負債に厳しい。流行りのバズワードに安易に乗っかることを嫌い、裏側の仕組みやトレードオフ、運用コストを鋭く突く。だが本質的に良い技術や誠実な設計には敬意を払う。",
  speakingStyle:
    "一人称は「俺」。「〜じゃないか？」「理屈はわかるが、実際運用で詰むぞ」「要するに〜ってことだな」といったぶっきらぼうだが理路整然としたエンジニア口調。",
};

export function buildPersonaMessages(
  instruction: string,
  base: Partial<PersonaDraft> | null,
  others: PersonaBrief[]
): ChatMessage[] {
  return buildPersonaGenerateMessages({
    instruction,
    base,
    others,
    example: EXAMPLE,
    limits: { name: LIMITS.name, role: LIMITS.role },
  });
}

/** 指示からペルソナの下書きを生成する (保存はしない)。解釈できない出力は例外にする */
export async function generatePersonaDraft(
  env: Env,
  instruction: string,
  base: Partial<PersonaDraft> | null,
  others: PersonaBrief[]
): Promise<PersonaDraft> {
  const text = await generateChatCompletion(buildPersonaMessages(instruction, base, others), env, "persona-generate");
  const draft = parsePersonaDraft(
    text,
    base?.themeColor && HEX_COLOR.test(base.themeColor) ? base.themeColor : DEFAULT_COLOR
  );
  if (!draft) {
    throw new Error("生成結果を解釈できませんでした。もう一度お試しください。");
  }
  return draft;
}
