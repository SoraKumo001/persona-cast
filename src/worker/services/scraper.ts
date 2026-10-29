/**
 * URLから記事のタイトルと本文テキストを抽出するスクレーパーサービス
 */
export interface ScrapedArticle {
  url: string;
  title: string;
  content: string;
  summary: string;
}

export async function scrapeUrl(urlStr: string): Promise<ScrapedArticle> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("無効なURL形式です。有効なHTTP/HTTPS URLを入力してください。");
  }

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersonaCastBot/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`URLの取得に失敗しました (HTTP ${response.status}: ${response.statusText})`);
  }

  const html = await response.text();

  // HTMLの簡易クレンジングとタイトル・本文抽出
  // script, style, svg, noscript などのタグを除去
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

  // タイトル抽出
  const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim() : "";
  // og:title フォールバック
  if (!title) {
    const ogTitleMatch = cleanHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch) title = ogTitleMatch[1].trim();
  }
  if (!title) {
    title = url.hostname;
  }
  // HTMLエンティティデコード簡易版
  title = decodeHtmlEntities(title);

  // 本文抽出: article, main タグがあればそこを優先、なければbody全体
  let bodyContent = cleanHtml;
  const articleMatch = cleanHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = cleanHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (articleMatch) {
    bodyContent = articleMatch[1];
  } else if (mainMatch) {
    bodyContent = mainMatch[1];
  }

  // タグを除去し、テキスト化
  let text = bodyContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = decodeHtmlEntities(text);

  // 長すぎる場合は最初の6000文字程度にトリム（LLM入力のコンテキスト節約）
  const maxLen = 6000;
  if (text.length > maxLen) {
    text = text.substring(0, maxLen) + "...(省略)";
  }

  // 簡易要約（先頭300文字）
  const summary = text.slice(0, 300) + (text.length > 300 ? "..." : "");

  return {
    url: url.toString(),
    title,
    content: text,
    summary,
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}
