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

  test("トークン上限で途中から切れたJSONでも、読める項目から立場を作る", () => {
    const truncated = '{"claim":"この記事には反対","reason":"引用した数値の前提が記事内で説明されていない';

    const stance = parseStance(truncated);

    expect(stance).toContain("主張: この記事には反対");
    expect(stance).toContain("根拠: 引用した数値の前提が記事内で説明されていない");
    expect(stance?.length).toBeLessThanOrEqual(STANCE_MAX_CHARS);
  });

  test("JSONの途中で値が切れてもキーだけ拾って立場にする", () => {
    const cut = '{"claim":"賛成","reason":"';

    expect(parseStance(cut)).toBe("主張: 賛成");
  });

  test("閉じ括弧が欠けていても3項目を拾える", () => {
    const stance = parseStance('{"claim":"条件付きで賛成","reason":"実測値が示されている","counter":"再現性は未確認"');

    expect(stance).toContain("主張: 条件付きで賛成");
    expect(stance).toContain("根拠: 実測値が示されている");
    expect(stance).toContain("反論: 再現性は未確認");
  });

  test("JSONが完全に崩れていても、引用符付きのキーと値から拾う", () => {
    const broken = 'うまくまとまりませんでした "claim": "判定は保留", "reason": "記事の数字が確認できない"';

    expect(parseStance(broken)).toContain("主張: 判定は保留");
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

  test("読めない応答は1回だけやり直し、2回目が読めれば立場を返す", async () => {
    const calls = new Map<string, number>();
    const generate: typeof generateChatCompletion = async (messages: ChatMessage[]) => {
      const name = messages.at(-1)?.content.includes("名前: ユキ") ? "yuki" : "ken";
      const count = (calls.get(name) ?? 0) + 1;
      calls.set(name, count);
      // 1回目は JSON としてまったく読めない応答
      if (count === 1) {
        return "うまくJSONにできませんでした";
      }
      return '{"claim":"条件付きで賛成","reason":"数字の根拠は妥当","counter":"再現性は未確認"}';
    };

    const stances = await generateStances(
      { personas, articleTitle: "記事", articleSummary: "要約" },
      {} as Env,
      "ses_test",
      { generate }
    );

    expect(stances.get("ken")).toContain("主張: 条件付きで賛成");
    expect(stances.get("yuki")).toContain("反論: 再現性は未確認");
    // やり直しは1回までなので、ペルソナあたり最大2回
    expect(calls.get("ken")).toBe(2);
    expect(calls.get("yuki")).toBe(2);
  });

  test("2回とも読めなければ、そのペルソナだけ立場なしにする", async () => {
    let count = 0;
    const generate: typeof generateChatCompletion = async () => {
      count++;
      return "JSONは出せません";
    };

    const stances = await generateStances(
      { personas: personas.slice(0, 1), articleTitle: "記事", articleSummary: "要約" },
      {} as Env,
      "ses_test",
      { generate }
    );

    expect(stances.size).toBe(0);
    expect(count).toBe(2);
  });

  test("立場生成には十分な maxOutputTokens を渡す", async () => {
    let maxOutputTokens: number | undefined;
    const generate: typeof generateChatCompletion = async (_messages, _env, _sessionId, _model, options) => {
      maxOutputTokens = options?.maxOutputTokens;
      return '{"claim":"賛成","reason":"根拠","counter":"反例"}';
    };

    await generateStances(
      { personas: personas.slice(0, 1), articleTitle: "記事", articleSummary: "要約" },
      {} as Env,
      "ses_test",
      { generate }
    );

    expect(maxOutputTokens).toBeGreaterThanOrEqual(600);
  });
});
