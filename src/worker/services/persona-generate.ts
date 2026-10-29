import { Env } from "../types";
import { ChatMessage, generateChatCompletion } from "./llm";

export interface PersonaDraft {
  name: string;
  role: string;
  avatar: string;
  themeColor: string;
  personality: string;
  speakingStyle: string;
}

/** 既存ペルソナの要約 (新規生成時に、被らない個性にするための参考) */
export interface PersonaBrief {
  name: string;
  role: string;
  themeColor: string;
}

const LIMITS = { name: 40, role: 40, personality: 600, speakingStyle: 400 } as const;
const DEFAULT_COLOR = "#6366f1";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }

  const name = clip(raw.name, LIMITS.name);
  const personality = clip(raw.personality, LIMITS.personality);
  const speakingStyle = clip(raw.speakingStyle, LIMITS.speakingStyle);
  if (!name || !personality || !speakingStyle) return null;

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
  const system = [
    "あなたは、記事について語り合う対談番組の出演者(AIペルソナ)を設計する担当です。",
    "指示に従ってペルソナを1人分設計し、次のJSONだけを出力してください(前置き・コードブロック・解説は不要)。",
    `{"name": "名前 (英字表記を括弧で添える)", "role": "肩書き", "avatar": "絵文字1つ", "themeColor": "#RRGGBB", "personality": "性格・価値観", "speakingStyle": "口調・話し方"}`,
    "",
    "書き方の基準:",
    `- name は${LIMITS.name}文字以内、role は${LIMITS.role}文字以内。`,
    "- personality: 何を重視し、何に厳しく/甘いか、議論でどんな視点を持ち込むかを2〜4文で具体的に。",
    '- speakingStyle: 一人称、語尾、口癖、典型的なセリフ例を「」で2〜3個含めて、口調を再現できるように。',
    "- themeColor: 画面で読みやすい中程度の明るさの色。他の出演者と被らない色相にする。",
    "- 特定の実在人物・団体の名前や、差別的・攻撃的な性格づけは避ける。",
    "",
    "出力例:",
    JSON.stringify(EXAMPLE),
  ];

  if (others.length > 0) {
    system.push("", "既存の出演者 (個性・肩書き・色が被らないようにする):", ...others.map((o) => `- ${o.name} (${o.role}) 色: ${o.themeColor}`));
  }

  const user = base
    ? [
        "次の現在のペルソナを、指示に従って修正してください。指示に関係しない項目は、できるだけそのまま残します。",
        `現在: ${JSON.stringify(base)}`,
        `指示: ${instruction}`,
      ].join("\n")
    : `次の指示でペルソナを新しく設計してください。\n指示: ${instruction}`;

  return [
    { role: "system", content: system.join("\n") },
    { role: "user", content: user },
  ];
}

/** 指示からペルソナの下書きを生成する (保存はしない)。解釈できない出力は例外にする */
export async function generatePersonaDraft(
  env: Env,
  instruction: string,
  base: Partial<PersonaDraft> | null,
  others: PersonaBrief[]
): Promise<PersonaDraft> {
  const text = await generateChatCompletion(buildPersonaMessages(instruction, base, others), env, "persona-generate");
  const draft = parsePersonaDraft(text, base?.themeColor && HEX_COLOR.test(base.themeColor) ? base.themeColor : DEFAULT_COLOR);
  if (!draft) throw new Error("生成結果を解釈できませんでした。もう一度お試しください。");
  return draft;
}
