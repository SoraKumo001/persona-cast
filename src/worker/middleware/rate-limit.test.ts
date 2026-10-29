import { describe, expect, test } from "bun:test";
import { clampFloat, clampInt, clientKey } from "./rate-limit";

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

describe("clientKey", () => {
  test("IPv4 はそのまま", () => {
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
  });
  test("IPv6 は先頭64ビットでまとめる (表記ゆれも同じキーになる)", () => {
    const a = clientKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1234:5678::/64");
    expect(clientKey("2001:0db8:1234:5678::1")).toBe(a);
    expect(clientKey("2001:DB8:1234:5678:1:2:3:4")).toBe(a);
  });
  test("圧縮表記 (::) を展開する", () => {
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
  });
});
