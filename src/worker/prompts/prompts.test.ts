import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAnalyzeMessages,
  buildConsolidateMessages,
  buildPersonaGenerateMessages,
  buildStanceMessages,
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

  test("担当論点は発言者欄の末尾に1行だけ入り、system は変えない (キャッシュ維持)", () => {
    const withAssignment = buildTurnMessages({ ...turn, assignedKeyPoints: ["論点A"] });
    const withoutAssignment = buildTurnMessages(turn);

    expect(withAssignment[0].content).toBe(withoutAssignment[0].content);
    expect(withAssignment[1].content).toContain("あなたの担当論点: 論点A。");
    // 発言者の役 → 担当論点 の順で、指示 (instruction) より前に入る
    const speakerIndex = withAssignment[1].content.indexOf("ペルソナ「ケン」");
    const assignmentIndex = withAssignment[1].content.indexOf("あなたの担当論点");
    expect(speakerIndex).toBeLessThan(assignmentIndex);
    // 担当論点の行は改行を含まない (1行)
    const line = withAssignment[1].content.split("\n").find((l) => l.includes("あなたの担当論点"));
    expect(line).toBeDefined();
    expect(line?.endsWith("。")).toBe(true);
  });

  test("担当論点が未指定なら従来どおり注入しない", () => {
    const user = buildTurnMessages(turn)[1].content;
    expect(user).not.toContain("あなたの担当論点");
  });

  test("立場生成プロンプトにも担当論点を1行入れ、system は変えない", () => {
    const base = {
      currentPersona: persona,
      allPersonas: [persona, { id: "b", name: "ユキ", role: "PM" }],
      articleTitle: "記事",
      articleSummary: "概要",
      keyPoints: ["論点A", "論点B"],
    };
    const withAssignment = buildStanceMessages({ ...base, assignedKeyPoints: ["論点A"] });
    const withoutAssignment = buildStanceMessages(base);

    expect(withAssignment[0].content).toBe(withoutAssignment[0].content);
    expect(withAssignment[1].content).toContain("あなたの担当論点: 論点A。");
    expect(withoutAssignment[1].content).not.toContain("あなたの担当論点");
    // JSON 出力の指示より前 (ペルソナ欄の末尾) に置く
    expect(withAssignment[1].content.indexOf("あなたの担当論点")).toBeLessThan(
      withAssignment[1].content.indexOf("JSONで1つだけ出力")
    );
  });

  test("記事のキー引用と論点を system に差し込み、履歴は直近6件に絞る", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ personaName: "ケン", text: `過去発言${i}` }));
    const [system, user] = buildTurnMessages({
      ...turn,
      history,
      articleKeyQuotes: "「コストが半分になった」",
      keyPoints: ["論点A", "論点B", "論点C"],
    });
    expect(system.content).toContain("「コストが半分になった」");
    expect(system.content).toContain("1. 論点A");
    expect(system.content).toContain("3. 論点C");
    // 直近6件 (過去発言4〜9) だけが載る
    expect(user.content).toContain("過去発言9");
    expect(user.content).toContain("過去発言4");
    expect(user.content).not.toContain("過去発言3");
  });

  test("キー引用・論点が未指定でも「なし」で組み立てられる (後方互換)", () => {
    const [system] = buildTurnMessages(turn);
    expect(system.content).toContain("記事からのキー引用");
    expect(system.content).toContain("なし");
  });

  test("System のルールに具体性の要求と既出キーワードの反復禁止が入っている", () => {
    const [system] = buildTurnMessages(turn);
    expect(system.content).toContain("固有名詞");
    expect(system.content).toContain("一般論");
    expect(system.content).toContain("指示語");
  });

  test("立場と担当論点は1巡目のみ注入し、2巡目以降は自己反復防止の注意書きに切り替える (system は不変)", () => {
    const firstRound = buildTurnMessages({
      ...turn,
      turnIndex: 1,
      stance: "主張: 賛成 / 根拠: 5%の遊休 / 反論: 9.2万円の壁",
      assignedKeyPoints: ["論点A"],
    });
    const secondRound = buildTurnMessages({
      ...turn,
      turnIndex: 2,
      stance: "主張: 賛成 / 根拠: 5%の遊休 / 反論: 9.2万円の壁",
      assignedKeyPoints: ["論点A"],
    });

    // system は巡目によらず完全一致 (キャッシュ維持)
    expect(firstRound[0].content).toBe(secondRound[0].content);

    // 1巡目 (turnIndex < allPersonas.length) は立場と担当論点が入る
    expect(firstRound[1].content).toContain("【あなたの立場(非公開・逐語反復禁止)】");
    expect(firstRound[1].content).toContain("あなたの担当論点: 論点A。");
    expect(firstRound[1].content).not.toContain("【2巡目以降の注意】");

    // 2巡目以降 (turnIndex >= allPersonas.length) は立場・担当論点を再注入せず、進行ガイドに切り替える
    expect(secondRound[1].content).not.toContain("【あなたの立場(非公開・逐語反復禁止)】");
    expect(secondRound[1].content).not.toContain("あなたの担当論点");
    expect(secondRound[1].content).toContain("【2巡目以降の注意】");
  });

  test("中盤 (9ターンなら4〜7ターン目) は既出の数字・引用を繰り返さず条件・反例・トレードオフで深掘りし、短い相槌だけを禁じる", () => {
    for (const turnIndex of [3, 4, 5, 6]) {
      const user = buildTurnMessages({ ...turn, turnIndex, totalTurns: 9 })[1].content;
      expect(user).toContain("対談の中盤");
      expect(user).toContain("条件・前提");
      expect(user).toContain("反例");
      expect(user).toContain("繰り返さず");
      expect(user).toContain("短い相槌だけの発言や、自分の前の発言の焼き直しは禁止");
      // 長さの目安は下限80字以上
      expect(user).toContain("80〜180文字");
      // 最終ターンの総括とはかぶらない
      expect(user).not.toContain("最終ターン");
    }
  });

  test("中盤の外 (3ターン目・8ターン目) は深掘り指示を付けない", () => {
    for (const turnIndex of [2, 7]) {
      const user = buildTurnMessages({ ...turn, turnIndex, totalTurns: 9 })[1].content;
      expect(user).not.toContain("対談の中盤");
      expect(user).not.toContain("80〜180文字");
    }
  });

  test("最終ターンは従来どおり総括で、中盤の深掘り指示は入らない", () => {
    const last = buildTurnMessages({ ...turn, turnIndex: 8, totalTurns: 9 })[1].content;
    expect(last).toContain("最終ターン");
    expect(last).not.toContain("対談の中盤");
    expect(last).not.toContain("80〜180文字");
  });

  test("System のルールに中盤の深掘り (短い相槌だけの禁止) が入っている", () => {
    const [system] = buildTurnMessages(turn);
    expect(system.content).toContain("中盤の深掘り");
    expect(system.content).toContain("反例");
    expect(system.content).toContain("禁止");
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
