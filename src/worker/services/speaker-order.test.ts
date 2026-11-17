import { describe, expect, test } from "bun:test";
import { speakerIndexForTurn, withOpenerFirst } from "./speaker-order";

const order = (total: number, speakers: number) =>
  Array.from({ length: total }, (_, turn) => speakerIndexForTurn(turn, total, speakers));
const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("withOpenerFirst", () => {
  test("第一声の担当が出演していれば先頭に移し、ほかの順は保つ", () => {
    expect(withOpenerFirst(ids("ken", "ren", "yuki")).map((p) => p.id)).toEqual(["yuki", "ken", "ren"]);
    expect(withOpenerFirst(ids("ren", "yuki", "ken")).map((p) => p.id)).toEqual(["yuki", "ren", "ken"]);
  });

  test("既に先頭、または出演していなければ順を変えない", () => {
    expect(withOpenerFirst(ids("yuki", "ren")).map((p) => p.id)).toEqual(["yuki", "ren"]);
    expect(withOpenerFirst(ids("ken", "ren")).map((p) => p.id)).toEqual(["ken", "ren"]);
    expect(withOpenerFirst([])).toEqual([]);
  });

  test("元の配列を書き換えない", () => {
    const input = ids("ken", "yuki");
    withOpenerFirst(input);
    expect(input.map((p) => p.id)).toEqual(["ken", "yuki"]);
  });
});

describe("speakerIndexForTurn", () => {
  test("3人9ターンは順番に回し、最終ターンだけ第一声の人に戻す", () => {
    expect(order(9, 3)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 0]);
  });

  test("直前が第一声の人なら連続発言にしない (2人6ターン)", () => {
    expect(order(6, 2)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  test("元から第一声の人が締める並びは変わらない (4人9ターン)", () => {
    expect(order(9, 4)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
  });

  test("複数人なら同じ人が続く場面を作らない", () => {
    for (const [total, speakers] of [
      [6, 2],
      [6, 3],
      [9, 3],
      [9, 4],
      [9, 5],
    ]) {
      const seq = order(total, speakers);
      expect(seq.every((s, i) => i === 0 || s !== seq[i - 1])).toBe(true);
    }
  });

  test("1ターンだけ・1人だけでも範囲内", () => {
    expect(order(1, 3)).toEqual([0]);
    expect(order(6, 1)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
