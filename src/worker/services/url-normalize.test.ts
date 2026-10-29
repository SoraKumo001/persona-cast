import { describe, expect, test } from "bun:test";
import { normalizeUrl, pickCanonical } from "./url-normalize";

describe("normalizeUrl", () => {
  const same = (a: string, b: string) => expect(normalizeUrl(a)).toBe(normalizeUrl(b));

  test("scheme / host / www / port / fragment のゆれを吸収する", () => {
    same("http://www.Example.com:80/a/b#top", "https://example.com/a/b");
    same("https://example.com:443/a", "https://example.com/a");
  });

  test("末尾スラッシュ・重複スラッシュ・index.html を統一する", () => {
    same("https://example.com/a/b/", "https://example.com/a//b");
    same("https://example.com/a/index.html", "https://example.com/a");
    same("https://example.com", "https://example.com/");
  });

  test("トラッキングパラメータを除去し、クエリ順を揃える", () => {
    same("https://example.com/p?id=1&utm_source=x&fbclid=y", "https://example.com/p?id=1");
    same("https://example.com/p?b=2&a=1", "https://example.com/p?a=1&b=2");
  });

  test("意味のあるクエリ・パスの大文字小文字は保持する", () => {
    expect(normalizeUrl("https://example.com/Watch?v=AbC")).toBe("https://example.com/Watch?v=AbC");
    expect(normalizeUrl("https://example.com/p?id=1")).not.toBe(normalizeUrl("https://example.com/p?id=2"));
  });

  test("非デフォルトポートは保持する", () => {
    expect(normalizeUrl("http://example.com:8080/x")).toBe("https://example.com:8080/x");
  });

  test("HTTP/HTTPS 以外と不正なURLは拒否する", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow();
    expect(() => normalizeUrl("not a url")).toThrow();
  });
});

describe("pickCanonical", () => {
  test("同一ホストの canonical を採用する", () => {
    expect(pickCanonical("https://example.com/a?x=1", "/a")).toBe("https://example.com/a");
  });

  test("別ドメインの canonical は無視する", () => {
    expect(pickCanonical("https://example.com/a", "https://evil.test/a")).toBeNull();
  });
});
