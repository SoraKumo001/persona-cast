import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import {
  extensionAmount,
  isExtendCheckTurn,
  maxTurnsAfterExtend,
  parseExtendDecision,
  shouldExtendDialogue,
} from "./dialogue-extend";

describe("extensionAmount / maxTurnsAfterExtend", () => {
  test("1巡分を足し、開始長さが上限になる", () => {
    expect(extensionAmount(3)).toBe(3);
    expect(extensionAmount(0)).toBe(1);
    expect(maxTurnsAfterExtend(9, 3)).toBe(12);
    expect(maxTurnsAfterExtend(6, 2)).toBe(8);
  });
});

describe("isExtendCheckTurn", () => {
  test("山場ターンの直前だけ true。延長済み・短すぎは false", () => {
    expect(isExtendCheckTurn(7, 9, false)).toBe(true);
    expect(isExtendCheckTurn(6, 9, false)).toBe(false);
    expect(isExtendCheckTurn(7, 9, true)).toBe(false);
    expect(isExtendCheckTurn(1, 3, false)).toBe(false);
  });
});

describe("parseExtendDecision", () => {
  test("extend true/false を読む", () => {
    expect(parseExtendDecision('{"extend": true, "reason": "論点が未消化"}')).toEqual({
      extend: true,
      reason: "論点が未消化",
    });
    expect(parseExtendDecision('{"extend": false}')).toEqual({ extend: false });
  });

  test("コードフェンスや壊れ応答は延長しない", () => {
    expect(parseExtendDecision('```json\n{"extend": true}\n```').extend).toBe(true);
    expect(parseExtendDecision("not json")).toEqual({ extend: false });
    expect(parseExtendDecision('{"extend": "true"}').extend).toBe(true);
  });
});

describe("shouldExtendDialogue", () => {
  test("LLM が true を返したら延長する", async () => {
    const decision = await shouldExtendDialogue(
      {
        articleTitle: "RSC",
        history: [{ personaName: "ケン", text: "まだ序盤だ" }],
        keyPoints: ["必要性"],
        mode: "heated",
      },
      {} as Env,
      "ses_1",
      { generate: () => Promise.resolve('{"extend": true, "reason": "対立が浅い"}') }
    );
    expect(decision).toEqual({ extend: true, reason: "対立が浅い" });
  });

  test("生成失敗時は延長しない", async () => {
    const decision = await shouldExtendDialogue(
      { articleTitle: "RSC", history: [] },
      {} as Env,
      "ses_1",
      {
        generate: () => {
          throw new Error("boom");
        },
      }
    );
    expect(decision).toEqual({ extend: false });
  });
});

describe("延長後の山場位置", () => {
  test("9→12 なら山場は turn 10、締めは turn 11", async () => {
    // プロンプト側の isClimax 相当: totalTurns-2 / totalTurns-1
    const base = 9;
    const speakers = 3;
    const after = maxTurnsAfterExtend(base, speakers);
    expect(after - 2).toBe(10);
    expect(after - 1).toBe(11);
    // 延長チェックは元の山場 (7) で一度だけ
    expect(isExtendCheckTurn(7, base, false)).toBe(true);
    expect(isExtendCheckTurn(10, after, true)).toBe(false);
  });
});
