import { describe, expect, test } from "bun:test";
import {
  appendSourcesSection,
  displayTheme,
  heatedSourceUrl,
  isHeatedSourceUrl,
  isThemeBasedSourceUrl,
  isThemeSourceUrl,
  normalizeTheme,
  parseResearchSources,
  themeSourceUrl,
} from "./theme";

describe("normalizeTheme / themeSourceUrl", () => {
  test("空白を畳み、小文字化し、theme:// キーにする", () => {
    expect(normalizeTheme("  React   RSC  ")).toBe("react rsc");
    expect(themeSourceUrl("  React   RSC  ")).toBe(`theme://${encodeURIComponent("react rsc")}`);
  });

  test("激論は heated:// キーで論戦と別物にする", () => {
    expect(heatedSourceUrl("  React   RSC  ")).toBe(`heated://${encodeURIComponent("react rsc")}`);
    expect(heatedSourceUrl("React RSC")).not.toBe(themeSourceUrl("React RSC"));
  });

  test("表示用タイトルは小文字化しない", () => {
    expect(displayTheme("  ReactのRSC  ")).toBe("ReactのRSC");
  });

  test("theme:// / heated:// 判定", () => {
    expect(isThemeSourceUrl(themeSourceUrl("foo"))).toBe(true);
    expect(isThemeSourceUrl("https://example.com")).toBe(false);
    expect(isHeatedSourceUrl(heatedSourceUrl("foo"))).toBe(true);
    expect(isThemeBasedSourceUrl(themeSourceUrl("foo"))).toBe(true);
    expect(isThemeBasedSourceUrl(heatedSourceUrl("foo"))).toBe(true);
    expect(isThemeBasedSourceUrl("https://example.com")).toBe(false);
  });
});

describe("research sources section", () => {
  test("追記と取り出しが往復できる", () => {
    const base = "【要約】\n本文";
    const withSources = appendSourcesSection(base, [
      { title: "A", url: "https://a.example/1" },
      { title: "B", url: "https://b.example/2" },
    ]);
    expect(withSources).toContain("【参考ページ】");
    expect(parseResearchSources(withSources)).toEqual([
      { title: "A", url: "https://a.example/1" },
      { title: "B", url: "https://b.example/2" },
    ]);
  });
});
