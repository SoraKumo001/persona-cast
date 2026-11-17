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
  test("スタンス付きで追記と取り出しが往復できる", () => {
    const base = "【要約】\n本文";
    const withSources = appendSourcesSection(base, [
      { stance: "pro", title: "A", url: "https://a.example/1" },
      { stance: "con", title: "B | weird", url: "https://b.example/2" },
    ]);
    expect(withSources).toContain("【参考ページ】");
    expect(parseResearchSources(withSources)).toEqual([
      { stance: "pro", title: "A", url: "https://a.example/1" },
      { stance: "con", title: "B weird", url: "https://b.example/2" },
    ]);
  });

  test("旧形式の参考ページも読める", () => {
    const legacy = "【要約】\n本文\n\n【参考ページ】\n- Old Title: https://old.example/1";
    expect(parseResearchSources(legacy)).toEqual([{ title: "Old Title", url: "https://old.example/1" }]);
  });
});
