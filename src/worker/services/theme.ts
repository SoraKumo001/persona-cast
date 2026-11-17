/**
 * テーマ論戦用の入力正規化と、重複判定キー (theme://…) の生成。
 */

/** テーマの最大文字数 (入力・表示・正規化キー) */
export const THEME_MAX_CHARS = 100;

export const SOURCES_MARKER = "【参考ページ】";

/** 調査クエリ / 資料のスタンス。検索クエリの意図に対応する */
export type ResearchStance = "overview" | "pro" | "con";

export interface ResearchSource {
  /** 検索クエリ側の意図。ページ内容の自動分類ではない */
  stance?: ResearchStance;
  title: string;
  url: string;
}

/** trim・空白畳み込み・小文字化。重複判定と theme:// キーに使う */
export function normalizeTheme(theme: string): string {
  return theme.trim().replace(/\s+/gu, " ").toLowerCase().slice(0, THEME_MAX_CHARS);
}

/** 表示用タイトル。空白だけ整え、小文字化はしない */
export function displayTheme(theme: string): string {
  return theme.trim().replace(/\s+/gu, " ").slice(0, THEME_MAX_CHARS);
}

/** テーマ論戦セッションの source_url / normalized_url */
export function themeSourceUrl(theme: string): string {
  return `theme://${encodeURIComponent(normalizeTheme(theme))}`;
}

/** 激論モードセッションの source_url / normalized_url (論戦とは別キー) */
export function heatedSourceUrl(theme: string): string {
  return `heated://${encodeURIComponent(normalizeTheme(theme))}`;
}

export function isThemeSourceUrl(url: string): boolean {
  return url.startsWith("theme://");
}

export function isHeatedSourceUrl(url: string): boolean {
  return url.startsWith("heated://");
}

/** テーマ調査ベースのセッションか (論戦・激論) */
export function isThemeBasedSourceUrl(url: string): boolean {
  return isThemeSourceUrl(url) || isHeatedSourceUrl(url);
}

const STANCE_TAGS: readonly ResearchStance[] = ["overview", "pro", "con"];

export const RESEARCH_STANCE_LABEL: Record<ResearchStance, string> = {
  overview: "概要",
  pro: "肯定",
  con: "否定",
};

function isResearchStance(value: string): value is ResearchStance {
  return (STANCE_TAGS as readonly string[]).includes(value);
}

/** タイトル中の区切り文字を潰し、パーサが壊れないようにする */
function sanitizeSourceTitle(title: string): string {
  return title.replace(/[|[\]]/gu, " ").replace(/\s+/gu, " ").trim() || "無題";
}

/** 参考ページ一覧をハイブリッド要約に追記する */
export function appendSourcesSection(articleSummary: string, sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return articleSummary;
  }
  const lines = sources.map((s) => {
    const title = sanitizeSourceTitle(s.title);
    const stance = s.stance && isResearchStance(s.stance) ? s.stance : "overview";
    return `- [${stance}] ${title} | ${s.url}`;
  });
  const block = `${SOURCES_MARKER}\n${lines.join("\n")}`;
  return articleSummary.trim() ? `${articleSummary.trim()}\n\n${block}` : block;
}

/** 保存済み要約から参考ページを取り出す (新旧フォーマット両対応) */
export function parseResearchSources(articleSummary: string): ResearchSource[] {
  const index = articleSummary.indexOf(SOURCES_MARKER);
  if (index < 0) {
    return [];
  }
  const rest = articleSummary.slice(index + SOURCES_MARKER.length);
  const end = rest.search(/(?=【[^】]+】)/u);
  const section = (end >= 0 ? rest.slice(0, end) : rest).trim();
  const sources: ResearchSource[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    const withStance = /^-\s*\[(overview|pro|con)\]\s*(.+?)\s*\|\s*(https?:\/\/\S+)/u.exec(trimmed);
    if (withStance) {
      sources.push({ stance: withStance[1] as ResearchStance, title: withStance[2].trim(), url: withStance[3].trim() });
      continue;
    }
    // 旧形式: `- title: https://...`
    const legacy = /^-\s*(.+?):\s*(https?:\/\/\S+)/u.exec(trimmed);
    if (legacy) {
      sources.push({ title: legacy[1].trim(), url: legacy[2].trim() });
    }
  }
  return sources;
}

/** ネット調査の実ページが1件も無い (フォールバック保存) か */
export function isUnresearchedThemeSummary(articleSummary: string): boolean {
  return parseResearchSources(articleSummary).length === 0;
}
