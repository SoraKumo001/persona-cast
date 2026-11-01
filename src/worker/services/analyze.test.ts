import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import {
  analyzeArticle,
  buildArticleSummary,
  defaultTurns,
  extractiveKeyQuotes,
  fallbackPersonas,
  keyPointSimilarity,
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

  test("トークン上限で途中から切れたJSONでも、読める項目は取り出す", () => {
    const cutArray = '{"summary":"途中まで","genre":"AI・機械学習","personaIds":["ken","yuk';
    expect(parseAnalysis(cutArray, candidates)).toMatchObject({
      summary: "途中まで",
      genre: "AI・機械学習",
      personaIds: ["ken"],
    });

    const cutKey = '{"summary":"要約","genre":"サイエンス","personaIds":["ken"],"keyPoints":';
    expect(parseAnalysis(cutKey, candidates)).toMatchObject({
      summary: "要約",
      genre: "サイエンス",
      personaIds: ["ken"],
    });
  });
});

describe("parseAnalysis の引用グラウンディング", () => {
  const content =
    "この記事では「コストが半分になる」と紹介された。別の調査では「導入企業は3社に増えた」と報告している。";

  test("本文に無い引用 (幻覚) は落とし、本文からの抜き出しで補充する", () => {
    const text = JSON.stringify({ keyQuotes: ["コストが半分になる", "実際には書かれていない引用文"] });
    expect(parseAnalysis(text, candidates, content).keyQuotes).toEqual(["コストが半分になる", "導入企業は3社に増えた"]);
  });

  test("空白・全半角の違いは無視して本文と照合する", () => {
    const article = "GPT-4 は従来より高速に動作する。";
    expect(
      parseAnalysis(JSON.stringify({ keyQuotes: ["GPT－4は従来より高速に動作する"] }), candidates, article).keyQuotes
    ).toEqual(["GPT－4は従来より高速に動作する"]);
  });

  test("本文に実在する引用が足りていれば、余計な補充はしない", () => {
    const text = JSON.stringify({ keyQuotes: ["コストが半分になる"] });
    expect(parseAnalysis(text, candidates, content).keyQuotes).toEqual(["コストが半分になる"]);
  });

  test("全部幻覚で本文からも抜き出せなければ、keyQuotes は未設定 (呼び出し側のフォールバックに任せる)", () => {
    const text = JSON.stringify({ keyQuotes: ["存在しない引用"] });
    expect(parseAnalysis(text, candidates, "本文には引用も数字も無い。").keyQuotes).toBeUndefined();
  });

  test("本文を渡さない場合は従来どおり検証しない", () => {
    expect(parseAnalysis('{"keyQuotes":["本文に無い引用"]}', candidates).keyQuotes).toEqual(["本文に無い引用"]);
  });

  describe("緩和後も正当な引用を落とさない (回帰)", () => {
    const longArticle =
      "OpenAI は 2024年5月に GPT-4o を公開した。従来モデルと比べて" +
      "「応答の速度が約2倍に向上し、画像の理解も可能になった」と報告されている。" +
      "導入企業の担当者は「コストが半分になり、問い合わせ対応の工数も3割減った」と話す。";

    /** 表記・約物・省略の揺れだけがある正当な引用 (本文には必ず対応する記述がある) */
    const legitimate = [
      // 約物の有無 (読点・句点・引用符)
      "「応答の速度が約2倍に向上し、画像の理解も可能になった。」",
      // 文中の読点の追加と空白の挿入
      "応答の速度が、約2倍に向上し 画像の理解も可能になった",
      // 全角数字・全角空白・大小文字の揺れ
      "応答の　速度が　約２倍に　向上し、画像の理解も　可能になった",
      // 省略記号での語の脱落
      "コストが半分になり…問い合わせ対応の工数も3割減った",
      // 大小文字・ハイフン・空白の揺れ
      "openaiは 2024年5月に GPT-4o を公開した",
      // 引用符をまたいだ文の連結
      "従来モデルと比べて応答の速度が約2倍に向上し",
      // 助詞の足し込み (被覆率での判定に落ちる微小な揺れ)
      "コストが半分になり、問い合わせ対応の工数も3割ほど減った",
    ];

    /** keyQuotes は保存前に前後の引用符除去と空白の畳み込みを受けるので、同じ正規化で比べる */
    const asStored = (quote: string) =>
      quote
        .replace(/^[「『"]|[」』"]$/gu, "")
        .replace(/\s+/gu, " ")
        .trim();

    test("正当な引用の落下率は 0%", () => {
      const dropped = legitimate.filter((quote) => {
        const parsed = parseAnalysis(JSON.stringify({ keyQuotes: [quote] }), candidates, longArticle);
        return parsed.keyQuotes?.[0] !== asStored(quote);
      });
      expect(dropped).toEqual([]);
    });

    test("数値の改変・文の継ぎ合わせは従来どおり幻覚として落とす", () => {
      const hallucinations = [
        // 数値の改変
        "応答の速度が約5倍に向上し、画像の理解も可能になった",
        // 本文に無い結論文の足し込み
        "問い合わせ対応の工数も3割減り、売上も2倍になった",
        // 離れた文の継ぎ合わせ
        "OpenAIは従来モデルと比べて問い合わせ対応の工数も3割減った",
        // 本文と無関係な文
        "この記事はAI業界の未来を予測する内容である",
      ];
      for (const quote of hallucinations) {
        const parsed = parseAnalysis(JSON.stringify({ keyQuotes: [quote] }), candidates, longArticle);
        expect(parsed.keyQuotes ?? []).not.toContain(asStored(quote));
      }
    });
  });
});

describe("parseAnalysis の論点重複除去", () => {
  test("類似した論点を落とし、後ろの候補を繰り上げる", () => {
    const text = JSON.stringify({
      keyPoints: [
        "コストが半分になる",
        "コストが半分になった",
        "導入企業が3社に増えた",
        "セキュリティ面の懸念が残る",
        "運用の手間が課題になる",
      ],
    });
    expect(parseAnalysis(text, candidates).keyPoints).toEqual([
      "コストが半分になる",
      "導入企業が3社に増えた",
      "セキュリティ面の懸念が残る",
    ]);
  });

  test("文字4-gramのJaccard類似度で重複を判定する", () => {
    expect(keyPointSimilarity("コストが半分になる", "コストが半分になった")).toBeGreaterThan(0.5);
    expect(keyPointSimilarity("コストが半分になる", "セキュリティ面の懸念が残る")).toBe(0);
  });

  test("言い回しが違えば重複として落とさない", () => {
    const text = JSON.stringify({ keyPoints: ["コストが半分になる", "料金は従来の半額になった"] });
    expect(parseAnalysis(text, candidates).keyPoints).toEqual(["コストが半分になる", "料金は従来の半額になった"]);
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

  test("途中で切れた応答は、項目が揃っていても1回やり直す", async () => {
    const truncated = '{"summary":"LLMの要約","genre":"プログラミング・開発","personaIds":["ken","ren"';
    const replies = [truncated, good];
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => Promise.resolve(replies[calls++]));
    expect(calls).toBe(2);
    expect(result.summary).toBe("LLMの要約");
    expect(result.personaIds.slice(0, 2)).toEqual(["ken", "ren"]);
  });

  test("2回目が空応答でも、1回目に読めた部分結果を捨てない", async () => {
    const partial = '{"summary":"LLMの要約","genre":"サイエンス","personaIds":["ken","yuki"]';
    const replies = [partial, ""];
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => Promise.resolve(replies[calls++]));
    expect(calls).toBe(2);
    expect(result.summary).toBe("LLMの要約");
    expect(result.genre).toBe("サイエンス");
    expect(result.personaIds.slice(0, 2)).toEqual(["ken", "yuki"]);
  });

  test("1回目の部分結果より2回目が揃っていれば、2回目を採用する", async () => {
    const replies = ['{"summary":"途中の要約"}', good];
    let calls = 0;
    const result = await analyzeArticle(env, "s", article, candidates, () => Promise.resolve(replies[calls++]));
    expect(calls).toBe(2);
    expect(result.summary).toBe("LLMの要約");
    expect(result.genre).toBe("プログラミング・開発");
  });

  test("分析呼び出しでは長めのトークン上限を渡す", async () => {
    const options: unknown[] = [];
    await analyzeArticle(env, "s", article, candidates, (_messages, _env, _sessionId, _model, opts) => {
      options.push(opts);
      return Promise.resolve(good);
    });
    expect(options[0]).toEqual({ maxOutputTokens: 4000 });
  });

  test("LLM の幻覚引用は本文と突き合わせて落とし、本文からの引用で補充する", async () => {
    const withQuotes = {
      ...article,
      content: "この記事では「コストが半分になる」と紹介された。別の調査では「導入企業は3社に増えた」と報告している。",
    };
    const reply = JSON.stringify({
      summary: "LLMの要約",
      genre: "プログラミング・開発",
      personaIds: ["ken", "ren"],
      keyQuotes: ["コストが半分になる", "実在しない引用文です", "もう一つ存在しない引用"],
    });
    const result = await analyzeArticle(env, "s", withQuotes, candidates, () => Promise.resolve(reply));
    expect(result.keyQuotes).toEqual(["コストが半分になる", "導入企業は3社に増えた"]);
    expect(result.keyQuotes).toEqual(extractiveKeyQuotes(withQuotes.content));
  });

  test("SUMMARY_TOP3=off では制約文・引用検証・論点重複除去を使わない (旧挙動)", async () => {
    const offEnv = { ...env, SUMMARY_TOP3: "off" } as unknown as Env;
    const withQuotes = {
      ...article,
      content: "この記事では「コストが半分になる」と紹介された。",
    };
    let system = "";
    const reply = JSON.stringify({
      summary: "LLMの要約",
      genre: "プログラミング・開発",
      personaIds: ["ken", "ren"],
      keyPoints: ["コストが半分になる", "コストが半分になった"],
      keyQuotes: ["本文に無い引用"],
    });
    const result = await analyzeArticle(offEnv, "s", withQuotes, candidates, (messages) => {
      system = messages[0].content;
      return Promise.resolve(reply);
    });
    expect(system).not.toContain("3つの論点は「主張と根拠」");
    expect(system).toContain("keyPoints は、対談で掘り下げる価値のある論点を3つ");
    expect(result.keyQuotes).toEqual(["本文に無い引用"]);
    expect(result.keyPoints).toEqual(["コストが半分になる", "コストが半分になった"]);
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
