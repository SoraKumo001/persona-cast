import { describe, expect, test } from "bun:test";
import { clampFloat, clampInt } from "./rate-limit";

describe("clampInt", () => {
  test("範囲内に収める", () => {
    expect(clampInt("1000", 1, 20, 5)).toBe(20);
    expect(clampInt("0", 1, 20, 5)).toBe(1);
    expect(clampInt("7", 1, 20, 5)).toBe(7);
  });
  test("不正・未指定は既定値", () => {
    expect(clampInt("abc", 1, 20, 5)).toBe(5);
    expect(clampInt(undefined, 1, 20, 5)).toBe(5);
  });
});

describe("clampFloat", () => {
  test("範囲内に収め、NaNは既定値", () => {
    expect(clampFloat("5", 0, 1, 0.35)).toBe(1);
    expect(clampFloat("-1", 0, 1, 0.35)).toBe(0);
    expect(clampFloat("NaN", 0, 1, 0.35)).toBe(0.35);
  });
});
