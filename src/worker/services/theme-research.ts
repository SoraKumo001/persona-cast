/**
 * テーマ論戦の事前調査: 検索クエリ生成 → DuckDuckGo → 上位ページのスクレイプ → ブリーフ化。
 * 検索は overview / pro / con の3本に分け、取得枠もスタンス別に確保する。
 */
import { buildThemeQueriesMessages } from "../prompts";
import type { Env } from "../types";
import {
  type Analysis,
  analyzeArticle,
  buildArticleSummary,
  extractiveKeyPoints,
  extractiveKeyQuotes,
  extractiveSummary,
  fallbackPersonas,
  type PersonaCandidate,
} from "./analyze";
import { DuckDuckGoError, searchDuckDuckGo } from "./duckduckgo";
import { guessGenre } from "./genres";
import { extractJsonObject } from "./json-object";
import { generateChatCompletion } from "./llm";
import { type OgpInfo, type ScrapedArticle, scrapeUrl } from "./scraper";
import { appendSourcesSection, displayTheme, type ResearchSource, type ResearchStance } from "./theme";

export type { ResearchSource, ResearchStance } from "./theme";

const RESULTS_PER_QUERY = 5;
const MAX_SCRAPE = 4;
const MAX_CONTENT_PER_PAGE = 2500;
const STANCES: readonly ResearchStance[] = ["overview", "pro", "con"];
const STANCE_LABEL: Record<ResearchStance, string> = {
  overview: "概要",
  pro: "肯定",
  con: "否定",
};
const EMPTY_OGP: OgpInfo = { title: null, description: null, image: null, siteName: null, type: null, favicon: null };

/** スタンス別の検索クエリ */
export type StanceQueries = Record<ResearchStance, string>;

/** スタンス別の検索結果 URL */
export type StanceUrlBuckets = Record<ResearchStance, string[]>;

/** スクレイプ対象。スタンスは検索クエリの意図 */
export interface PickedUrl {
  stance: ResearchStance;
  url: string;
}

export interface ThemeResearchResult {
  analysis: Analysis;
  articleSummary: string;
  ogp: OgpInfo;
  /** 調査でページを1件以上取れたか。false なら LLM 知識フォールバック */
  researched: boolean;
  sources: ResearchSource[];
  title: string;
}

export function defaultQueries(theme: string): StanceQueries {
  return {
    overview: `${theme} 概要`.slice(0, 40),
    pro: `${theme} メリット 事例`.slice(0, 40),
    con: `${theme} 批判 課題`.slice(0, 40),
  };
}

function clampQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, 40) : "";
}

/** LLM 応答や部分結果から overview/pro/con を揃え、欠けは default で埋める */
export function parseStanceQueries(raw: unknown, theme: string): StanceQueries {
  const fallback = defaultQueries(theme);
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result = { ...fallback };
  for (const stance of STANCES) {
    const q = clampQuery(obj[stance]);
    if (q) {
      result[stance] = q;
    }
  }
  return result;
}

/** LLM またはフォールバックでスタンス別検索クエリを決める */
export async function buildSearchQueries(theme: string, env: Env, sessionId: string): Promise<StanceQueries> {
  const apiKey = env.OPENCODE_API_KEY;
  if (!apiKey || apiKey === "your-opencode-api-key-here") {
    return defaultQueries(theme);
  }
  try {
    const raw = await generateChatCompletion(buildThemeQueriesMessages(theme), env, sessionId, undefined, {
      maxOutputTokens: 500,
    });
    const parsed = extractJsonObject(raw)?.raw ?? {};
    return parseStanceQueries(parsed, theme);
  } catch (err) {
    console.warn("theme-research: query generation failed:", err);
  }
  return defaultQueries(theme);
}

/** スタンスごとに検索し、結果をバケツに入れる */
export async function collectSearchUrlsByStance(queries: StanceQueries): Promise<StanceUrlBuckets> {
  const entries = await Promise.all(
    STANCES.map(async (stance) => {
      try {
        const urls = await searchDuckDuckGo(queries[stance], RESULTS_PER_QUERY);
        return [stance, urls] as const;
      } catch (err) {
        console.warn(
          `theme-research: search failed stance=${stance}:`,
          err instanceof DuckDuckGoError ? err.message : err
        );
        return [stance, [] as string[]] as const;
      }
    })
  );
  return { overview: entries[0][1], pro: entries[1][1], con: entries[2][1] };
}

/**
 * 各スタンスから最低1件ずつ取り、残りを pro → con → overview で埋める。
 * 重複 URL はスキップ。あるスタンスが空でも他で埋める。
 */
export function pickBalancedUrls(buckets: StanceUrlBuckets, max = MAX_SCRAPE): PickedUrl[] {
  const picked: PickedUrl[] = [];
  const seen = new Set<string>();
  const cursors: Record<ResearchStance, number> = { overview: 0, pro: 0, con: 0 };

  const takeNext = (stance: ResearchStance): boolean => {
    const list = buckets[stance];
    while (cursors[stance] < list.length) {
      const url = list[cursors[stance]];
      cursors[stance] += 1;
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      picked.push({ stance, url });
      return true;
    }
    return false;
  };

  // 1. 各スタンスから先頭1件
  for (const stance of STANCES) {
    if (picked.length >= max) {
      break;
    }
    takeNext(stance);
  }

  // 2. 残り枠を pro → con → overview の順で埋める
  const fillOrder: ResearchStance[] = ["pro", "con", "overview"];
  let progressed = true;
  while (picked.length < max && progressed) {
    progressed = false;
    for (const stance of fillOrder) {
      if (picked.length >= max) {
        break;
      }
      if (takeNext(stance)) {
        progressed = true;
      }
    }
  }

  return picked;
}

/** 上位 URL を並列で取得。失敗はスキップ。順序は入力順を保つ */
export async function scrapeResearchPages(
  targets: PickedUrl[]
): Promise<(ScrapedArticle & { stance: ResearchStance })[]> {
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const page = await scrapeUrl(t.url);
        if (page.adultRated || !page.content.trim()) {
          return null;
        }
        return { ...page, stance: t.stance };
      } catch (err) {
        console.warn(`theme-research: scrape failed url=${t.url}:`, err);
        return null;
      }
    })
  );
  return results.filter((a): a is ScrapedArticle & { stance: ResearchStance } => a !== null);
}

/** 取得ページを1本の調査テキストに束ねる。スタンス見出しと両側バランスの指示を付ける */
export function bundleResearchContent(theme: string, pages: (ScrapedArticle & { stance?: ResearchStance })[]): string {
  if (pages.length === 0) {
    return `テーマ「${theme}」についての調査資料は得られませんでした。一般知識のみで論戦の論点を整理してください。出典が薄い場合は断定を避けてください。`;
  }
  const guidance =
    "【調査の読み方】肯定・否定・概要の資料がある。summary と keyPoints は両側の根拠を含め、片方だけに偏らないこと。";
  const body = pages
    .map((p, i) => {
      const label = p.stance ? STANCE_LABEL[p.stance] : "資料";
      const text = p.content.replace(/\s+/gu, " ").trim().slice(0, MAX_CONTENT_PER_PAGE);
      return `### 資料${i + 1} [${label}]: ${p.title}\nURL: ${p.url}\n${text}`;
    })
    .join("\n\n");
  return `${guidance}\n\n${body}`;
}

function knowledgeFallback(
  theme: string,
  candidates: PersonaCandidate[],
  seed: string
): { analysis: Analysis; content: string } {
  const content = `テーマ「${theme}」の是非・現状・採用判断について論戦する。ネット調査の結果は得られなかったため、断定は避け、トレードオフと条件を明示する。`;
  const genre = guessGenre(theme);
  return {
    content,
    analysis: {
      summary: extractiveSummary(content, EMPTY_OGP).slice(0, 300) || `${theme}の是非と現状について論戦する。`,
      keyPoints: extractiveKeyPoints(`${theme}。必要性。採用の課題。代替手段。`).length
        ? extractiveKeyPoints(
            `${theme}の必要性は何か。${theme}を採用するときの課題は何か。${theme}を使わない選択肢の条件は何か。`
          )
        : [`${theme}の必要性`, `${theme}採用時の課題`, `${theme}を使わない条件`],
      keyQuotes: extractiveKeyQuotes(content),
      genre,
      personaIds: fallbackPersonas(candidates, seed, 3, genre),
      adult: false,
    },
  };
}

/**
 * テーマを調査してセッション保存用のブリーフを返す。
 * 検索・取得が全滅してもフォールバックで続行する (researched=false)。
 */
export async function researchTheme(
  theme: string,
  env: Env,
  sessionId: string,
  candidates: PersonaCandidate[],
  seed: string
): Promise<ThemeResearchResult> {
  const title = displayTheme(theme);
  const queries = await buildSearchQueries(title, env, sessionId);
  const buckets = await collectSearchUrlsByStance(queries);
  const picked = pickBalancedUrls(buckets, MAX_SCRAPE);
  const pages = await scrapeResearchPages(picked);
  const sources: ResearchSource[] = pages.map((p) => ({ title: p.title, url: p.url, stance: p.stance }));
  const researched = pages.length > 0;
  const ogp = pages[0]?.ogp ?? EMPTY_OGP;

  let analysis: Analysis;
  let content: string;
  if (researched) {
    content = bundleResearchContent(title, pages);
    analysis = await analyzeArticle(env, sessionId, { title, content, ogp, normalizedUrl: seed }, candidates);
  } else {
    const { content: fallbackContent, analysis: fallbackAnalysis } = knowledgeFallback(title, candidates, seed);
    content = fallbackContent;
    // 可能なら LLM でブリーフを作る (ページ無しでも analyze は動く)
    analysis = await analyzeArticle(
      env,
      sessionId,
      { title, content, ogp: EMPTY_OGP, normalizedUrl: seed },
      candidates
    );
    // analyze が空コンテンツでフォールバックした場合の保険
    if (!analysis.summary) {
      analysis = fallbackAnalysis;
    }
  }

  const articleSummary = appendSourcesSection(buildArticleSummary(analysis, content), sources);
  return { title, analysis, articleSummary, researched, sources, ogp };
}
