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

/** 参考ページ一覧をハイブリッド要約に追記する */
export function appendSourcesSection(articleSummary: string, sources: ResearchSource[]): string {
  if (sources.length === 0) {
    return articleSummary;
  }
  const block = `${SOURCES_MARKER}\n${sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}`;
  return articleSummary.trim() ? `${articleSummary.trim()}\n\n${block}` : block;
}

/** 保存済み要約から参考ページ URL を取り出す */
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
    const matched = /^-\s*(.+?):\s*(https?:\/\/\S+)/u.exec(line.trim());
    if (matched) {
      sources.push({ title: matched[1].trim(), url: matched[2].trim() });
    }
  }
  return sources;
}
