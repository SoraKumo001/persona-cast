import { describe, expect, test } from "bun:test";
import type { Env, Persona } from "../types";
import { type ChatMessage, type generateChatCompletion } from "./llm";
import { generateStances, parseStance, STANCE_MAX_CHARS } from "./stance";

const personas = [
  { id: "ken", name: "ケン", role: "エンジニア", personality: "P", speakingStyle: "S" },
  { id: "yuki", name: "ユキ", role: "PM", personality: "P", speakingStyle: "S" },
].map((p) => ({ ...p, avatar: "🧑", themeColor: "#2563eb" })) as Persona[];

describe("parseStance", () => {
  test("前置きやコードフェンス付きのJSONから立場を取り出し、200字以内に収める", () => {
    const raw = [
      "はい、以下です。",
      "```json",
      JSON.stringify({ claim: "この記事の主張には賛成", reason: "あ".repeat(300), counter: "ただし運用コストは不明" }),
      "```",
    ].join("\n");

    const stance = parseStance(raw);

    expect(stance).toContain("主張: この記事の主張には賛成");
    expect(stance).toContain("反論: ただし運用コストは不明");
    expect(stance?.length).toBeLessThanOrEqual(STANCE_MAX_CHARS);
    // JSONとして壊れている応答は立場なし
    expect(parseStance("すみません、うまく答えられません")).toBeNull();
  });
});

describe("generateStances", () => {
  test("全ペルソナ分を並列生成し、失敗したペルソナだけ立場なしで返す (例外を投げない)", async () => {
    const generate: typeof generateChatCompletion = async (messages: ChatMessage[]) => {
      if (messages.at(-1)?.content.includes("名前: ユキ")) {
        throw new Error("boom");
      }
      return '{"claim":"賛成","reason":"記事の数字が根拠","counter":"反例もある"}';
    };

    const stances = await generateStances(
      { personas, articleTitle: "記事", articleSummary: "要約" },
      {} as Env,
      "ses_test",
      { generate }
    );

    expect(stances.get("ken")).toContain("主張: 賛成");
    expect(stances.get("ken")).toContain("反論: 反例もある");
    expect(stances.has("yuki")).toBe(false);
  });
});
