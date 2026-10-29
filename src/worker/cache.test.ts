import { describe, expect, test } from "bun:test";
import { browserCacheControl, cacheFor, edgeCacheControl, isAdminPath } from "./cache";

describe("browserCacheControl / edgeCacheControl", () => {
  test("ブラウザは maxAge が 0 なら no-cache (毎回エッジに確認する)。エッジの期間は別に持つ", () => {
    expect(browserCacheControl({ sMaxAge: 600, maxAge: 0 })).toBe("no-cache");
    expect(edgeCacheControl({ sMaxAge: 600, maxAge: 0 })).toBe("public, s-maxage=600");
  });
  test("maxAge があれば、ブラウザにも保存させる。immutable も付けられる", () => {
    expect(browserCacheControl({ sMaxAge: 3600, maxAge: 3600 })).toBe("public, max-age=3600");
    expect(browserCacheControl({ sMaxAge: 1, maxAge: 1, immutable: true })).toBe("public, max-age=1, immutable");
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
