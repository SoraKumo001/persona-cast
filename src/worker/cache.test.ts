import { describe, expect, test } from "bun:test";
import { cacheControl, cacheFor, isAdminPath } from "./cache";

describe("cacheControl", () => {
  test("エッジとブラウザの期間を分けて出す", () => {
    expect(cacheControl({ sMaxAge: 600, maxAge: 60 })).toBe("public, max-age=60, s-maxage=600");
  });
  test("immutable を付けられる", () => {
    expect(cacheControl({ sMaxAge: 1, maxAge: 1, immutable: true })).toBe("public, max-age=1, s-maxage=1, immutable");
  });
});

describe("isAdminPath", () => {
  test("管理画面と管理APIだけが対象", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/personas")).toBe(true);
    expect(isAdminPath("/api/admin/personas/x/avatar")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/api/personas")).toBe(false);
  });
});

test("キャッシュの外で cacheFor を呼んでも例外にならない", () => {
  expect(() => cacheFor(60)).not.toThrow();
});
