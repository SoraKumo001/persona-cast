import { describe, expect, test } from "bun:test";
import { defaultTurns, fallbackPersonas, parseAnalysis } from "./analyze";
import { guessGenre } from "./genres";

const candidates = ["ken", "yuki", "ren"].map((id) => ({ id, name: id, role: "r", personality: "p" }));

describe("parseAnalysis", () => {
  test("前置きやコードブロック付きでもJSONを取り出す", () => {
    const text = '以下です\n```json\n{"summary":"要約です","genre":"AI・機械学習","personaIds":["ken","yuki"]}\n```';
    expect(parseAnalysis(text, candidates)).toEqual({ summary: "要約です", genre: "AI・機械学習", personaIds: ["ken", "yuki"] });
  });

  test("未知のジャンルと存在しないペルソナIDは捨てる", () => {
    const text = '{"summary":"s","genre":"グルメ","personaIds":["ghost","ren","ren"]}';
    expect(parseAnalysis(text, candidates)).toEqual({ summary: "s", genre: undefined, personaIds: ["ren"] });
  });

  test("ペルソナは最大3人まで", () => {
    const four = [...candidates, { id: "x", name: "x", role: "r", personality: "p" }];
    const text = '{"personaIds":["ken","yuki","ren","x"]}';
    expect(parseAnalysis(text, four).personaIds).toEqual(["ken", "yuki", "ren"]);
  });

  test("JSONでなければ空を返す", () => {
    expect(parseAnalysis("わかりません", candidates)).toEqual({});
    expect(parseAnalysis("{broken", candidates)).toEqual({});
  });
});

describe("fallbackPersonas", () => {
  test("同じseedなら同じ顔ぶれで、重複しない", () => {
    const a = fallbackPersonas(candidates, "https://a.example/x");
    expect(a).toEqual(fallbackPersonas(candidates, "https://a.example/x"));
    expect(new Set(a).size).toBe(2);
  });
  test("候補が1人ならその1人だけ", () => {
    expect(fallbackPersonas(candidates.slice(0, 1), "s")).toEqual(["ken"]);
  });
  test("候補がなければ空", () => {
    expect(fallbackPersonas([], "s")).toEqual([]);
  });
});

describe("guessGenre", () => {
  test("キーワードで分類し、該当なしは「その他」", () => {
    expect(guessGenre("ChatGPTと大規模言語モデルの進化")).toBe("AI・機械学習");
    expect(guessGenre("TypeScriptでAPIを作る開発者向けガイド")).toBe("プログラミング・開発");
    expect(guessGenre("Example Domain")).toBe("その他");
  });
});

describe("defaultTurns", () => {
  test("人数に応じて6〜9", () => {
    expect([1, 2, 3, 5].map(defaultTurns)).toEqual([6, 6, 9, 9]);
  });
});
