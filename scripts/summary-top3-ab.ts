/**
 * 要約Top3 (SUMMARY_TOP3) の A/B ハーネス。
 *
 * 本番 POST はせず、`analyzeArticle` を実 LLM で直接呼んで 2 アームを比較する。
 * - treat:   SUMMARY_TOP3 未設定 (既定 ON)。制約付きプロンプト + 引用グラウンディング + 論点重複除去
 * - control: SUMMARY_TOP3=off。導入前のプロンプト + 検証なし
 *
 * 実行: bun --preload ./test/raw-plugin.ts scripts/summary-top3-ab.ts [--runs=3] [--out=DIR]
 *
 * 指標:
 * - quoteMatchRate: keyQuotes が本文に実在する割合 (NFKC/空白/引用符を吸収した部分一致)
 * - duplicatePairRate: keyPoints の文字4-gram Jaccard > 0.5 のペア数 / 全ペア数
 * - structure: 要約の主張・根拠 (数字/固有名詞)・条件/反論の有無
 * - hallucinatedNumbers: 要約・論点に出てくるが本文 (タイトル含む) に無い数字
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeArticle,
  extractiveSummary,
  keyPointSimilarity,
  type PersonaCandidate,
} from "../src/worker/services/analyze";
import { generateChatCompletion } from "../src/worker/services/llm";
import type { OgpInfo } from "../src/worker/services/scraper";
import type { Env } from "../src/worker/types";

interface Article {
  content: string;
  contentUrl: string;
  id: string;
  title: string;
}

/** .dev.vars を読む (KEY="value" 形式) */
async function loadDevVars(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const text = await Bun.file(".dev.vars").text();
  for (const line of text.split(/\r?\n/u)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/u);
    if (!m) {
      continue;
    }
    vars[m[1]] = m[2].trim().replace(/^"(.*)"$/u, "$1");
  }
  return vars;
}

const CANDIDATES: PersonaCandidate[] = [
  { id: "ken", name: "ケン", role: "現場のエンジニア", personality: "実装と運用の現実を見る" },
  { id: "yuki", name: "ユキ", role: "プロダクトマネージャー", personality: "ユーザー価値を優先する" },
  { id: "ren", name: "レン", role: "懐疑派のリサーチャー", personality: "根拠と再現性を重んじる" },
  { id: "ana", name: "アナ", role: "データアナリスト", personality: "数字の裏付けを確認する" },
];

/**
 * danluu.com の記事 (イントロ + 後半の反論)。既存の対談 A/B ハーネスと同じ本文を使い、
 * 「後半に反論がある長文」の条件を満たす。
 */
const DANLUU: Article = {
  id: "danluu-ambitious",
  title: "“We should be more ambitious with the software we build”",
  contentUrl: "https://danluu.com/ambitious/",
  content:
    "Since early this year, Michael Malis (of pgrust) has been showing me interesting things he's done and saying \"[W]e should be more ambitious with the software we build\". There is, understandably, a lot of skepticism about projects like pgrust because there are so many low-quality AI-generated projects out there. If I didn't know Malis and didn't look into it, I would just assume that pgrust was another vibe slopped project that's never going to work. But I know Malis well enough to trust his work without looking into it, and if you look into it a bit, you'll see that in testing pgrust, he's testing thoroughly enough that he's even uncovering real bugs in Postgres, such as this numerical bug that can cause valid SP-GiST operations to fail. This isn't to say that pgrust is bug free, but it does indicate that there's a substantial amount of testing happening and, even if pgrust itself is never successful, just making the attempt will have improved Postgres in a durable way. For someone like me who doesn't know anything about regexes, string matching algorithms, compilers, interpreters, etc., this set of projects would've taken a year or more to get to \"works for me\" quality. Instead, this was a low single-digit number of hours of my time. My read of Malis's meaning when he says \"we should be more ambitious with the software we build\", is that it doesn't even occur to people to do these things that are now easy. As far as I can tell, these problems are problems because people are implicitly carrying around a pre-agentic cost model. Appendix: we should be less ambitious with the software we build. Here's a comment from Yossi Kreinin: \"for most people they should be less ambitious with the software they build with AI or they'll experience abject failure. I think a lot of the problems don't lend themselves that well to agentic loops since you don't have clear pass/fail criteria.\"",
};

const EVIDENCE_RE = /[0-9０-９]|[A-Za-z][A-Za-z0-9.+#_-]{2,}/u;
const CONDITION_RE =
  /条件|場合|ただし|一方|反論|懸念|課題|必要|なら|れば|限り|しかし|だが|ものの|except|unless|however|\bbut\b/iu;
const EXAMPLE_RE = /例|たとえば|実際|など|such as|for example|e\.g\./iu;

/** 引用の照合に使う正規化 (analyze.ts のグラウンディングと同じ考え方) */
function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^[\s「『“”"'’]+|[\s」』“”"'’]+$/gu, "")
    .replace(/\s+/gu, "")
    .replace(/[。．.、,，!?！？…]+$/u, "")
    .toLowerCase();
}

function quoteMatch(quote: string, content: string): boolean {
  const needle = normalizeForMatch(quote);
  return needle.length > 0 && normalizeForMatch(content).includes(needle);
}

function numbersIn(text: string): string[] {
  return [...text.normalize("NFKC").matchAll(/[0-9]+(?:\.[0-9]+)?/gu)].map((m) => m[0]);
}

function hallucinatedNumbers(output: string, source: string): string[] {
  const known = new Set(numbersIn(source));
  const seen = new Set<string>();
  const found: string[] = [];
  for (const n of numbersIn(output)) {
    if (!(known.has(n) || seen.has(n))) {
      seen.add(n);
      found.push(n);
    }
  }
  return found;
}

function assess(result: { summary: string; keyPoints: string[]; keyQuotes: string[] }, article: Article) {
  const quoteMatches = result.keyQuotes.map((q) => quoteMatch(q, article.content));
  const quoteCount = result.keyQuotes.length;
  const quoteMatchRate = quoteCount === 0 ? null : quoteMatches.filter(Boolean).length / quoteCount;

  let duplicatePairs = 0;
  let pairCount = 0;
  let maxSimilarity = 0;
  for (let i = 0; i < result.keyPoints.length; i++) {
    for (let j = i + 1; j < result.keyPoints.length; j++) {
      pairCount++;
      const similarity = keyPointSimilarity(result.keyPoints[i], result.keyPoints[j]);
      maxSimilarity = Math.max(maxSimilarity, similarity);
      if (similarity > 0.5) {
        duplicatePairs++;
      }
    }
  }

  const { summary } = result;
  const source = `${article.title}\n${article.content}`;
  const output = `${summary}\n${result.keyPoints.join("\n")}`;

  return {
    quoteCount,
    quoteMatches,
    quoteMatchRate,
    duplicatePairs,
    pairCount,
    maxSimilarity,
    summaryStructure: {
      claim: summary.trim().length > 0,
      evidence: EVIDENCE_RE.test(summary),
      condition: CONDITION_RE.test(summary),
    },
    keyPointStructure: {
      count: result.keyPoints.length,
      evidence: result.keyPoints.some((p) => EVIDENCE_RE.test(p)),
      counterOrCondition: result.keyPoints.some((p) => CONDITION_RE.test(p)),
      example: result.keyPoints.some((p) => EXAMPLE_RE.test(p)),
    },
    hallucinatedNumbers: hallucinatedNumbers(output, source),
  };
}

function parseArgs() {
  const runsArg = process.argv.find((a) => a.startsWith("--runs="));
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const maxTokensArg = process.argv.find((a) => a.startsWith("--max-tokens="));
  return {
    runs: Number(runsArg?.slice("--runs=".length) ?? 3),
    // 0 (既定) は本番と同じ ANALYZE_MAX_OUTPUT_TOKENS=2000。診断用に上限だけ差し替えられる
    maxTokens: Number(maxTokensArg?.slice("--max-tokens=".length) ?? 0),
    outDir: outArg?.slice("--out=".length) ?? join(process.env.TEMP ?? ".", "opencode", "summary-top3-ab"),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A/B ハーネスは直列実行と集計を1か所にまとめる
async function main() {
  const { runs, maxTokens, outDir } = parseArgs();
  const vars = await loadDevVars();
  const apiKey = vars.OPENCODE_API_KEY;
  if (!apiKey || apiKey === "your-opencode-api-key-here") {
    throw new Error(".dev.vars に OPENCODE_API_KEY がありません (実 LLM での A/B ができません)");
  }

  const pgmemContent = await Bun.file("scripts/fixtures/pgmem-readme-excerpt.md").text();
  const articles: Article[] = [
    DANLUU,
    {
      id: "pgmem-readme",
      title: "pgmem: PostgreSQL in memory for Go tests",
      contentUrl: "https://github.com/shibukawa/pgmem",
      content: pgmemContent,
    },
  ];
  const arms = ["control", "treat"] as const;

  // 診断時だけ出力トークン上限を差し替える (プロンプト・検証ロジックは本番のまま)
  const complete =
    maxTokens > 0
      ? (messages: Parameters<typeof generateChatCompletion>[0], env: Env, sessionId: string, model?: string) =>
          generateChatCompletion(messages, env, sessionId, model, { maxOutputTokens: maxTokens })
      : undefined;

  console.log(
    `summary-top3 A/B: articles=${articles.length} arms=${arms.length} runs=${runs} ` +
      `model=${vars.OPENCODE_DEFAULT_MODEL || "(default)"} ` +
      `maxOutputTokens=${maxTokens > 0 ? maxTokens : "2000 (production)"} ` +
      `totalCalls=${articles.length * arms.length * runs}`
  );

  interface Record {
    arm: (typeof arms)[number];
    articleId: string;
    elapsedMs: number;
    error?: string;
    /** LLM が使えず extractiveSummary に落ちた実行 (品質指標から除外する) */
    fallback?: boolean;
    metrics?: ReturnType<typeof assess>;
    result?: { summary: string; keyPoints: string[]; keyQuotes: string[]; genre: string };
    run: number;
  }
  const records: Record[] = [];

  for (const article of articles) {
    for (const arm of arms) {
      const env = {
        ...vars,
        SUMMARY_TOP3: arm === "control" ? "off" : undefined,
      } as unknown as Env;
      for (let run = 1; run <= runs; run++) {
        const sessionId = `top3-ab-${article.id}-${arm}-${run}`.replace(/[^a-zA-Z0-9_-]/gu, "_");
        const started = Date.now();
        try {
          const result = await analyzeArticle(
            env,
            sessionId,
            {
              title: article.title,
              content: article.content,
              ogp: { description: "" } as OgpInfo,
              normalizedUrl: article.contentUrl,
            },
            CANDIDATES,
            complete
          );
          const metrics = assess(result, article);
          const fallback = result.summary === extractiveSummary(article.content, { description: "" } as OgpInfo);
          records.push({
            articleId: article.id,
            arm,
            run,
            elapsedMs: Date.now() - started,
            fallback,
            result: {
              summary: result.summary,
              keyPoints: result.keyPoints,
              keyQuotes: result.keyQuotes,
              genre: result.genre,
            },
            metrics,
          });
          const q = metrics.quoteMatchRate === null ? "-" : `${Math.round(metrics.quoteMatchRate * 100)}%`;
          console.log(
            `  ${article.id.padEnd(18)} ${arm.padEnd(7)} run${run} ${fallback ? "FALLBACK " : ""}` +
              `quotes=${metrics.quoteMatches.filter(Boolean).length}/${metrics.quoteCount} (${q}) ` +
              `dupPairs=${metrics.duplicatePairs}/${metrics.pairCount} ` +
              `struct=${[
                metrics.summaryStructure.evidence ? "E" : "-",
                metrics.summaryStructure.condition ? "C" : "-",
              ].join("")} ` +
              `hallucNums=${metrics.hallucinatedNumbers.join(",") || "0"} ` +
              `${Math.round((Date.now() - started) / 1000)}s`
          );
        } catch (err) {
          records.push({
            articleId: article.id,
            arm,
            run,
            elapsedMs: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          });
          console.warn(`  ${article.id} ${arm} run${run} FAILED: ${String(err)}`);
        }
        await Bun.sleep(400);
      }
    }
  }

  const summarize = (arm: (typeof arms)[number]) => {
    const rows = records.filter((r) => r.arm === arm && r.result && r.metrics);
    // フォールバックは本文の抜き出しなので、LLM 出力の品質指標からは除外する
    const validRows = rows.filter((r) => !r.fallback);
    const quotes = validRows.flatMap((r) => r.metrics?.quoteMatches ?? []);
    const pairCount = validRows.reduce((sum, r) => sum + (r.metrics?.pairCount ?? 0), 0);
    const duplicatePairs = validRows.reduce((sum, r) => sum + (r.metrics?.duplicatePairs ?? 0), 0);
    const similarities = validRows.map((r) => r.metrics?.maxSimilarity ?? 0);
    return {
      runs: rows.length,
      fallbacks: rows.filter((r) => r.fallback).length,
      validRuns: validRows.length,
      quotes: quotes.length,
      quoteMatches: quotes.filter(Boolean).length,
      quoteMatchRate: quotes.length === 0 ? null : quotes.filter(Boolean).length / quotes.length,
      pairCount,
      duplicatePairs,
      duplicatePairRate: pairCount === 0 ? null : duplicatePairs / pairCount,
      avgMaxSimilarity:
        similarities.length === 0 ? null : similarities.reduce((a, b) => a + b, 0) / similarities.length,
      summaryEvidence: validRows.filter((r) => r.metrics?.summaryStructure.evidence).length,
      summaryCondition: validRows.filter((r) => r.metrics?.summaryStructure.condition).length,
      keyPointEvidence: validRows.filter((r) => r.metrics?.keyPointStructure.evidence).length,
      keyPointCounter: validRows.filter((r) => r.metrics?.keyPointStructure.counterOrCondition).length,
      hallucinatedNumbers: [...new Set(validRows.flatMap((r) => r.metrics?.hallucinatedNumbers ?? []))],
      errors: records.filter((r) => r.arm === arm && r.error).length,
    };
  };

  const aggregate = { control: summarize("control"), treat: summarize("treat") };
  const verdict = {
    quoteMatch100: aggregate.treat.validRuns > 0 && aggregate.treat.quoteMatchRate === 1,
    duplicateReduced:
      aggregate.control.validRuns > 0 &&
      aggregate.treat.validRuns > 0 &&
      aggregate.control.duplicatePairRate !== null &&
      aggregate.treat.duplicatePairRate !== null &&
      aggregate.treat.duplicatePairRate < aggregate.control.duplicatePairRate,
    noHallucinatedNumbers: aggregate.treat.hallucinatedNumbers.length === 0,
    fallbackFree: aggregate.treat.fallbacks === 0,
    errors: aggregate.control.errors + aggregate.treat.errors,
  };

  await mkdir(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    runs,
    maxOutputTokens: maxTokens > 0 ? maxTokens : 2000,
    model: vars.OPENCODE_DEFAULT_MODEL || "(default)",
    articles: articles.map((a) => ({ id: a.id, title: a.title, contentChars: a.content.length })),
    aggregate,
    verdict,
    records,
  };
  const jsonPath = join(outDir, "results.json");
  await Bun.write(jsonPath, JSON.stringify(payload, null, 2));

  const md = [
    "# 要約Top3 A/B 結果",
    "",
    `- 実行: ${payload.generatedAt} / model=${payload.model} / runs=${runs} / maxOutputTokens=${payload.maxOutputTokens}`,
    `- 記事: ${articles.map((a) => `${a.id} (${a.content.length}字)`).join(", ")}`,
    "",
    "| 指標 | control (off) | treat (on) |",
    "|---|---|---|",
    `| 有効実行 (LLM出力) | ${aggregate.control.validRuns}/${aggregate.control.runs} | ${aggregate.treat.validRuns}/${aggregate.treat.runs} |`,
    `| フォールバック | ${aggregate.control.fallbacks} | ${aggregate.treat.fallbacks} |`,
    `| 引用一致率 (有効のみ) | ${fmtRate(aggregate.control.quoteMatchRate)} (${aggregate.control.quoteMatches}/${aggregate.control.quotes}) | ${fmtRate(aggregate.treat.quoteMatchRate)} (${aggregate.treat.quoteMatches}/${aggregate.treat.quotes}) |`,
    `| 論点重複ペア率 (有効のみ) | ${fmtRate(aggregate.control.duplicatePairRate)} (${aggregate.control.duplicatePairs}/${aggregate.control.pairCount}) | ${fmtRate(aggregate.treat.duplicatePairRate)} (${aggregate.treat.duplicatePairs}/${aggregate.treat.pairCount}) |`,
    `| 最大類似度の平均 | ${fmtNum(aggregate.control.avgMaxSimilarity)} | ${fmtNum(aggregate.treat.avgMaxSimilarity)} |`,
    `| 要約: 根拠あり | ${aggregate.control.summaryEvidence}/${aggregate.control.validRuns} | ${aggregate.treat.summaryEvidence}/${aggregate.treat.validRuns} |`,
    `| 要約: 条件/反論あり | ${aggregate.control.summaryCondition}/${aggregate.control.validRuns} | ${aggregate.treat.summaryCondition}/${aggregate.treat.validRuns} |`,
    `| 論点: 根拠あり | ${aggregate.control.keyPointEvidence}/${aggregate.control.validRuns} | ${aggregate.treat.keyPointEvidence}/${aggregate.treat.validRuns} |`,
    `| 論点: 反論/条件あり | ${aggregate.control.keyPointCounter}/${aggregate.control.validRuns} | ${aggregate.treat.keyPointCounter}/${aggregate.treat.validRuns} |`,
    `| 本文に無い数字 | ${aggregate.control.hallucinatedNumbers.join(", ") || "なし"} | ${aggregate.treat.hallucinatedNumbers.join(", ") || "なし"} |`,
    `| 失敗 (例外) | ${aggregate.control.errors} | ${aggregate.treat.errors} |`,
    "",
    `判定: 引用一致100%=${verdict.quoteMatch100}, 論点重複減=${verdict.duplicateReduced}, 幻覚数字なし=${verdict.noHallucinatedNumbers}, フォールバックなし=${verdict.fallbackFree}`,
    "",
    "## 各実行の出力",
    "",
    ...records.flatMap((r) => {
      if (!r.result) {
        return [`### ${r.articleId} / ${r.arm} / run${r.run} — ERROR: ${r.error ?? "unknown"}`, ""];
      }
      return [
        `### ${r.articleId} / ${r.arm} / run${r.run}${r.fallback ? " (FALLBACK)" : ""}`,
        "",
        `- 引用一致: ${r.metrics?.quoteMatches.map((m) => (m ? "o" : "x")).join("") ?? "-"} (${r.metrics?.quoteCount ?? 0}件)`,
        `- 論点重複ペア: ${r.metrics?.duplicatePairs}/${r.metrics?.pairCount} (max=${fmtNum(r.metrics?.maxSimilarity ?? 0)})`,
        `- 要約の構造: 主張=${r.metrics?.summaryStructure.claim}, 根拠=${r.metrics?.summaryStructure.evidence}, 条件/反論=${r.metrics?.summaryStructure.condition}`,
        `- 論点の構造: 根拠=${r.metrics?.keyPointStructure.evidence}, 反論/条件=${r.metrics?.keyPointStructure.counterOrCondition}, 例=${r.metrics?.keyPointStructure.example}`,
        `- 本文に無い数字: ${r.metrics?.hallucinatedNumbers.join(", ") || "なし"}`,
        "",
        `要約: ${r.result.summary}`,
        "",
        "論点:",
        ...(r.result.keyPoints.length > 0 ? r.result.keyPoints.map((p) => `- ${p}`) : ["- (なし)"]),
        "",
        "引用:",
        ...(r.result.keyQuotes.length > 0 ? r.result.keyQuotes.map((q) => `- ${q}`) : ["- (なし)"]),
        "",
      ];
    }),
  ].join("\n");
  const mdPath = join(outDir, "report.md");
  await Bun.write(mdPath, md);

  console.log(`\nwrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(`aggregate control: ${JSON.stringify(aggregate.control)}`);
  console.log(`aggregate treat:   ${JSON.stringify(aggregate.treat)}`);
  console.log(`verdict: ${JSON.stringify(verdict)}`);
}

function fmtRate(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null): string {
  return value === null ? "-" : value.toFixed(3);
}

await main();
