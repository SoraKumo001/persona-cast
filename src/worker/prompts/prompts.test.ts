import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAnalyzeMessages,
  buildConsolidateMessages,
  buildPersonaGenerateMessages,
  buildTurnMessages,
} from "./index";
import { renderPrompt } from "./render";

describe("renderPrompt", () => {
  test("変数を差し込み、取り込みで付く末尾の改行1つとCRLFを正規化する", () => {
    expect(renderPrompt("こんにちは{{name}}さん\r\n二行目\r\n", { name: "A" })).toBe("こんにちはAさん\n二行目");
  });

  test("数値も差し込める", () => {
    expect(renderPrompt("#{{n}}", { n: 3 })).toBe("#3");
  });

  test("テンプレートにあるのに渡されていない変数は例外", () => {
    expect(() => renderPrompt("{{a}} {{b}}", { a: "x" })).toThrow('"b"');
  });

  test("渡されたのにテンプレートにない変数は例外 (綴り違いの検出)", () => {
    expect(() => renderPrompt("{{a}}", { a: "x", extra: "y" })).toThrow('"extra"');
  });

  test("差し込んだ値の中の {{...}} や $ は再展開・解釈されない", () => {
    expect(renderPrompt("[{{a}}]", { a: "{{b}} $& $1" })).toBe("[{{b}} $& $1]");
  });
});

describe("全テンプレートの組み立て", () => {
  const persona = { id: "a", name: "ケン", role: "エンジニア", personality: "P", speakingStyle: "S" };
  const memory = { sessionId: "s", articleTitle: "過去", topicSummary: "要点", keyQuotes: "引用", score: 1 };
  const turn = {
    currentPersona: persona,
    allPersonas: [persona, { id: "b", name: "ユキ", role: "PM" }],
    articleTitle: "記事",
    articleSummary: "概要",
    pastMemories: [memory],
    history: [{ personaName: "ケン", text: "発言" }],
    turnIndex: 1,
    totalTurns: 6,
    isFirstSpeaker: false,
  };

  const all = [
    ...buildTurnMessages(turn),
    ...buildTurnMessages({ ...turn, turnIndex: 5 }),
    ...buildTurnMessages({ ...turn, isFirstSpeaker: true, history: [] }),
    ...buildConsolidateMessages("記事", [{ personaName: "ケン", text: "発言" }]),
    ...buildAnalyzeMessages({
      title: "t",
      content: "c",
      genres: ["A", "B"],
      minPersonas: 2,
      maxPersonas: 3,
      candidates: [persona],
    }),
    ...buildPersonaGenerateMessages({
      instruction: "i",
      base: null,
      others: [],
      example: {},
      limits: { name: 40, role: 40 },
    }),
    ...buildPersonaGenerateMessages({
      instruction: "i",
      base: { name: "x" },
      others: [{ name: "ケン", role: "E", themeColor: "#2563eb" }],
      example: {},
      limits: { name: 40, role: 40 },
    }),
  ];

  test("未展開の {{変数}} が残らず、空のメッセージもない", () => {
    for (const m of all) {
      expect(m.content).not.toMatch(/\{\{\w+\}\}/u);
      expect(m.content.trim().length).toBeGreaterThan(0);
    }
  });

  test("system は発言者によらず共通で、発言者の役は user の末尾に置く (プロンプトキャッシュのため)", () => {
    const other = { ...turn, currentPersona: { ...persona, id: "b", name: "ユキ" }, turnIndex: 2 };
    const a = buildTurnMessages(turn);
    const b = buildTurnMessages(other);
    expect(a[0].content).toBe(b[0].content);
    expect(a[0].content).not.toContain("ケン（エンジニア）として");
    expect(a[1].content).toContain("ペルソナ「ケン」");
    expect(b[1].content).toContain("ペルソナ「ユキ」");
    // 履歴の後ろに発言者の役が来る
    expect(a[1].content.indexOf("発言")).toBeLessThan(a[1].content.indexOf("ペルソナ「ケン」"));
  });

  test("最終ターンだけ総括の指示になる", () => {
    const last = buildTurnMessages({ ...turn, turnIndex: 5 })[1].content;
    const mid = buildTurnMessages(turn)[1].content;
    expect(last).toContain("最終ターン");
    expect(mid).not.toContain("最終ターン");
  });
});

describe("テンプレートファイル", () => {
  test("すべての *.md が index.ts から読み込まれている (使われていない文面を残さない)", () => {
    const dir = import.meta.dirname;
    const index = readFileSync(join(dir, "index.ts"), "utf-8");
    const orphans = readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .filter((f) => !index.includes(`"./${f}?raw"`));
    expect(orphans).toEqual([]);
  });
});
