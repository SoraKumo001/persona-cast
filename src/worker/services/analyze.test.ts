import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import {
  analyzeArticle,
  buildArticleSummary,
  defaultTurns,
  fallbackPersonas,
  parseAnalysis,
  parseArticleSummary,
} from "./analyze";
import { guessGenre } from "./genres";
import type { OgpInfo } from "./scraper";

const candidates = ["ken", "yuki", "ren"].map((id) => ({ id, name: id, role: "r", personality: "p" }));

describe("parseAnalysis", () => {
  test("前置きやコードブロック付きでもJSONを取り出す", () => {
    const text = '以下です\n```json\n{"summary":"要約です","genre":"AI・機械学習","personaIds":["ken","yuki"]}\n```';
    expect(parseAnalysis(text, candidates)).toEqual({
      summary: "要約です",
      genre: "AI・機械学習",
      personaIds: ["ken", "yuki"],
    });
  });

  test("未知のジャンルと存在しないペルソナIDは捨てる", () => {
    const text = '{"summary":"s","genre":"グルメ","personaIds":["ghost","ren","ren"]}';
    expect(parseAnalysis(text, candidates)).toEqual({ summary: "s", genre: undefined, personaIds: ["ren"] });
  });

  test("ペルソナは最大4人まで", () => {
    const extra = ["x", "y"].map((id) => ({ id, name: id, role: "r", personality: "p" }));
    const text = '{"personaIds":["ken","yuki","ren","x","y"]}';
    expect(parseAnalysis(text, [...candidates, ...extra]).personaIds).toEqual(["ken", "yuki", "ren", "x"]);
  });

  test("JSONでなければ空を返す", () => {
    expect(parseAnalysis("わかりません", candidates)).toEqual({});
    expect(parseAnalysis("{broken", candidates)).toEqual({});
  });
});

describe("fallbackPersonas", () => {
  test("同じseedなら同じ顔ぶれで、重複しない", () => {
    const a = fallbackPersonas(candidates, "https://a.example/x");
    expect(a).toEqual(fallbackPersonas(candidates, "https://a.example/x"));
    expect(new Set(a).size).toBe(3);
  });
  test("候補が1人ならその1人だけ", () => {
    expect(fallbackPersonas(candidates.slice(0, 1), "s")).toEqual(["ken"]);
  });
  test("候補がなければ空", () => {
    expect(fallbackPersonas([], "s")).toEqual([]);
  });
});

describe("fallbackPersonas (ジャンル指定)", () => {
  const mixed = [
    { id: "eng", name: "モグ", role: "物知りモグラエンジニア", personality: "技術に詳しい" },
    { id: "dog", name: "ポチ", role: "食いしん坊の犬コメンテーター", personality: "匂いで嗅ぎ分ける" },
    { id: "rabbit", name: "ミミ", role: "せっかちなウサギ", personality: "速さが大事" },
    { id: "capy", name: "カピー", role: "のんびりカピバラ", personality: "哲学的" },
    { id: "ana", name: "コン", role: "慎重派リサーチャー", personality: "データを重視" },
  ];

  test("技術系のジャンルでは、技術に詳しそうな役割を入れる", () => {
    for (const seed of ["a", "b", "c", "d", "e", "https://zenn.dev/x"]) {
      const ids = fallbackPersonas(mixed, seed, 3, "プログラミング・開発");
      expect(new Set(ids).size).toBe(3);
      expect(ids.filter((id) => id === "eng" || id === "ana").length).toBeGreaterThanOrEqual(2);
    }
  });

  test("議論に幅が出るよう、1人は別の持ち味のペルソナにする", () => {
    const ids = fallbackPersonas(mixed, "seed", 3, "AI・機械学習");
    expect(ids.some((id) => !(id === "eng" || id === "ana"))).toBe(true);
  });

  test("該当するペルソナが無い、または技術系でないジャンルでは従来どおり", () => {
    expect(fallbackPersonas(mixed, "seed", 3, "ライフスタイル")).toEqual(fallbackPersonas(mixed, "seed", 3));
    expect(fallbackPersonas(candidates, "seed", 3, "プログラミング・開発")).toEqual(
      fallbackPersonas(candidates, "seed", 3)
    );
  });
});

describe("parseArticleSummary", () => {
  const saved = buildArticleSummary(
    { summary: "要約です", keyQuotes: ["コストが半分"], keyPoints: ["論点A", "論点B"] },
    "本文冒頭の内容"
  );

  test("保存したハイブリッド要約からキー引用と論点を取り出し、要約からは重複を除く", () => {
    const parsed = parseArticleSummary(saved);
    expect(parsed.keyQuotes).toEqual(["コストが半分"]);
    expect(parsed.keyPoints).toEqual(["論点A", "論点B"]);
    expect(parsed.summary).toContain("要約です");
    expect(parsed.summary).toContain("本文冒頭の内容");
    expect(parsed.summary).not.toContain("コストが半分");
    expect(parsed.summary).not.toContain("論点A");
  });

  test("見出しの無い古いデータでは空配列を返し、要約はそのまま", () => {
    const parsed = parseArticleSummary("本文だけの要約");
    expect(parsed).toEqual({ keyQuotes: [], keyPoints: [], summary: "本文だけの要約" });
  });
});

describe("analyzeArticle", () => {
  const env = { OPENCODE_API_KEY: "k" } as unknown as Env;
  const article = {
    title: "ライブラリの紹介",
    content: "本文",
    ogp: { description: "OGPの説明" } as OgpInfo,
    normalizedUrl: "https://example.com/a",
  };
  const good = '{"summary":"LLMの要約","genre":"プログラミング・開発","personaIds":["ken","ren"]}';

  test("1回で完全な応答なら、それを使う", async () => {
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => {
      calls++;
      return Promise.resolve(good);
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ summary: "LLMの要約", genre: "プログラミング・開発" });
    expect(result.personaIds.slice(0, 2)).toEqual(["ken", "ren"]);
  });

  test("JSONで返らなければ1回だけやり直し、2回目の応答を使う", async () => {
    const replies = ["考え中です", good];
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => Promise.resolve(replies[calls++]));
    expect(calls).toBe(2);
    expect(result.summary).toBe("LLMの要約");
  });

  test("呼び出しが例外でも1回やり直す", async () => {
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve(good);
    });
    expect(calls).toBe(2);
    expect(result.genre).toBe("プログラミング・開発");
  });

  test("2回とも失敗したら、簡易な判定で補う (やり直しは1回まで)", async () => {
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => {
      calls++;
      return Promise.resolve("だめでした");
    });
    expect(calls).toBe(2);
    expect(result.summary).toBe("OGPの説明");
    expect(result.personaIds.length).toBe(3);
  });

  test("項目が欠けた応答は、取れた項目を使い欠けた項目だけ補う", async () => {
    const result = await analyzeArticle(env, "s", article, candidates, () => Promise.resolve('{"genre":"サイエンス"}'));
    expect(result.genre).toBe("サイエンス");
    expect(result.summary).toBe("OGPの説明");
  });
});

describe("guessGenre", () => {
  test("キーワードで分類し、該当なしは「その他」", () => {
    expect(guessGenre("ChatGPTと大規模言語モデルの進化")).toBe("AI・機械学習");
    expect(guessGenre("TypeScriptでAPIを作る開発者向けガイド")).toBe("プログラミング・開発");
    expect(guessGenre("Example Domain")).toBe("その他");
  });

  test("「アニメーション」はアニメ(エンタメ)として数えない", () => {
    const text = "CSSアニメーションと@keyframesでアニメーション画像を作る。Cloudflare Workers の API。アニメーション";
    expect(guessGenre(text)).toBe("プログラミング・開発");
    expect(guessGenre("人気アニメの新作映画")).toBe("エンタメ・カルチャー");
  });
});

describe("defaultTurns", () => {
  test("人数に応じて6〜9", () => {
    expect([1, 2, 3, 5].map(defaultTurns)).toEqual([6, 6, 9, 9]);
  });
});
