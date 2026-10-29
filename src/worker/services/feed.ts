/** sitemap.xml / rss.xml / robots.txt の生成。対談の一覧は session-queries と同じ「公開中」の条件で読む */
import { HAS_MESSAGES } from "./session-queries";

export interface FeedSession {
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  id: string;
  summary: string;
}

const SITEMAP_LIMIT = 5000;
const FEED_LIMIT = 30;
const SITE_TITLE = "Persona-Cast";
const SITE_DESCRIPTION = "URLを入れるだけで、AIペルソナが記事について語り合います";

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/gu, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

export async function listFeedSessions(db: D1Database, limit: number): Promise<FeedSession[]> {
  const { results } = await db
    .prepare(
      `SELECT id, article_title as articleTitle, created_at as createdAt, genre,
              COALESCE(summary, substr(article_summary, 1, 200), '') as summary
       FROM sessions WHERE ${HAS_MESSAGES} ORDER BY created_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<FeedSession>();
  return results;
}

export const listSitemapSessions = (db: D1Database) => listFeedSessions(db, SITEMAP_LIMIT);
export const listRssSessions = (db: D1Database) => listFeedSessions(db, FEED_LIMIT);

const sessionUrl = (origin: string, id: string) => `${origin}/s/${encodeURIComponent(id)}`;

/** sitemap に載せるペルソナ (アーカイブ済みは除く) */
export async function listSitemapPersonaIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC")
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export function buildSitemap(origin: string, sessions: FeedSession[], personaIds: string[] = []): string {
  const latest = sessions[0]?.createdAt;
  const urls = [
    `<url><loc>${escapeXml(`${origin}/`)}</loc>${latest ? `<lastmod>${escapeXml(latest)}</lastmod>` : ""}</url>`,
    ...personaIds.map((id) => `<url><loc>${escapeXml(`${origin}/persona/${encodeURIComponent(id)}`)}</loc></url>`),
    ...sessions.map(
      (s) => `<url><loc>${escapeXml(sessionUrl(origin, s.id))}</loc><lastmod>${escapeXml(s.createdAt)}</lastmod></url>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
}

export function buildRss(origin: string, sessions: FeedSession[]): string {
  const items = sessions.map((s) => {
    const link = escapeXml(sessionUrl(origin, s.id));
    const date = new Date(s.createdAt);
    return [
      "<item>",
      `<title>${escapeXml(s.articleTitle)}</title>`,
      `<link>${link}</link>`,
      `<guid isPermaLink="true">${link}</guid>`,
      Number.isNaN(date.getTime()) ? "" : `<pubDate>${date.toUTCString()}</pubDate>`,
      s.genre ? `<category>${escapeXml(s.genre)}</category>` : "",
      `<description>${escapeXml(s.summary)}</description>`,
      "</item>",
    ].join("");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${SITE_TITLE}</title><link>${escapeXml(`${origin}/`)}</link><description>${escapeXml(SITE_DESCRIPTION)}</description><language>ja</language><atom:link href="${escapeXml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml"/>${items.join("")}</channel></rss>\n`;
}

export function buildRobots(origin: string): string {
  return ["User-agent: *", "Disallow: /admin", "Disallow: /api/", "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
}
