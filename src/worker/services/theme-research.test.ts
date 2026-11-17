import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import {
  bundleResearchContent,
  collectSearchUrlsByStance,
  defaultQueries,
  parseStanceQueries,
  pickBalancedUrls,
  researchTheme,
  type StanceUrlBuckets,
} from "./theme-research";

const personaCandidates = [
  { id: "ken", name: "ケン", role: "エンジニア", personality: "技術に厳しい" },
  { id: "yuki", name: "ユキ", role: "PM", personality: "前向き" },
  { id: "ren", name: "レン", role: "リサーチャー", personality: "慎重" },
];

describe("parseStanceQueries", () => {
  test("3キーが揃っていればそれを使う", () => {
    expect(parseStanceQueries({ overview: "RSC 概要", pro: "RSC メリット", con: "RSC 批判" }, "React RSC")).toEqual({
      overview: "RSC 概要",
      pro: "RSC メリット",
      con: "RSC 批判",
    });
  });

  test("欠けたキーは default で埋める", () => {
    const parsed = parseStanceQueries({ pro: "だけ肯定" }, "React RSC");
    expect(parsed.pro).toBe("だけ肯定");
    expect(parsed.overview).toBe(defaultQueries("React RSC").overview);
    expect(parsed.con).toBe(defaultQueries("React RSC").con);
  });

  test("壊れた入力は全部 default", () => {
    expect(parseStanceQueries(null, "テーマ")).toEqual(defaultQueries("テーマ"));
    expect(parseStanceQueries(["a", "b"], "テーマ")).toEqual(defaultQueries("テーマ"));
  });

  test("40文字超は切り詰める", () => {
    const long = "あ".repeat(50);
    expect(parseStanceQueries({ overview: long, pro: "p", con: "c" }, "t").overview.length).toBe(40);
  });
});

describe("collectSearchUrlsByStance", () => {
  test("API キー未設定なら全スタンス空", async () => {
    expect(await collectSearchUrlsByStance(defaultQueries("React RSC"), undefined)).toEqual({
      overview: [],
      pro: [],
      con: [],
    });
  });
});

describe("researchTheme", () => {
  test("EXA未設定なら検索せず researched=false でフォールバックする", async () => {
    const result = await researchTheme(
      "React RSC",
      {} as Env,
      "ses_1",
      personaCandidates,
      "theme://react%20rsc"
    );
    expect(result.researched).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.title).toBe("React RSC");
    expect(result.analysis.summary.length).toBeGreaterThan(0);
  });
});

describe("pickBalancedUrls", () => {
  const buckets = (over: Partial<StanceUrlBuckets> = {}): StanceUrlBuckets => ({
    overview: ["https://over.example/1", "https://over.example/2"],
    pro: ["https://pro.example/1", "https://pro.example/2", "https://pro.example/3"],
    con: ["https://con.example/1", "https://con.example/2"],
    ...over,
  });

  test("各スタンスから最低1件ずつ取り、残りを pro→con→overview で埋める", () => {
    const picked = pickBalancedUrls(buckets(), 4);
    expect(picked).toEqual([
      { stance: "overview", url: "https://over.example/1" },
      { stance: "pro", url: "https://pro.example/1" },
      { stance: "con", url: "https://con.example/1" },
      { stance: "pro", url: "https://pro.example/2" },
    ]);
  });

  test("重複 URL はスキップする", () => {
    const picked = pickBalancedUrls(
      {
        overview: ["https://same.example/x"],
        pro: ["https://same.example/x", "https://pro.example/1"],
        con: ["https://con.example/1"],
      },
      4
    );
    expect(picked.map((p) => p.url)).toEqual([
      "https://same.example/x",
      "https://pro.example/1",
      "https://con.example/1",
    ]);
  });

  test("あるスタンスが空でも他で埋める", () => {
    const picked = pickBalancedUrls(
      {
        overview: [],
        pro: ["https://pro.example/1", "https://pro.example/2"],
        con: ["https://con.example/1"],
      },
      3
    );
    expect(picked).toEqual([
      { stance: "pro", url: "https://pro.example/1" },
      { stance: "con", url: "https://con.example/1" },
      { stance: "pro", url: "https://pro.example/2" },
    ]);
  });

  test("exclude 済み URL はスキップして次を取る", () => {
    const picked = pickBalancedUrls(buckets(), 3, new Set(["https://over.example/1", "https://pro.example/1"]));
    expect(picked.map((p) => p.url)).toEqual([
      "https://over.example/2",
      "https://pro.example/2",
      "https://con.example/1",
    ]);
  });
});

describe("bundleResearchContent", () => {
  test("スタンス見出しと両側バランスの指示を付ける", () => {
    const text = bundleResearchContent("RSC", [
      {
        title: "良い話",
        url: "https://pro.example/1",
        content: "メリットがある。",
        stance: "pro",
        adultRated: false,
        normalizedUrl: "https://pro.example/1",
        ogp: { title: null, description: null, image: null, siteName: null, type: null, favicon: null },
      },
      {
        title: "悪い話",
        url: "https://con.example/1",
        content: "課題がある。",
        stance: "con",
        adultRated: false,
        normalizedUrl: "https://con.example/1",
        ogp: { title: null, description: null, image: null, siteName: null, type: null, favicon: null },
      },
    ]);
    expect(text).toContain("片方だけに偏らないこと");
    expect(text).toContain("### 資料1 [肯定]: 良い話");
    expect(text).toContain("### 資料2 [否定]: 悪い話");
  });
});
