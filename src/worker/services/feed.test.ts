import { describe, expect, test } from "bun:test";
import { buildRobots, buildRss, buildSitemap, escapeXml, type FeedSession } from "./feed";

const session: FeedSession = {
  id: "ses_1_a",
  articleTitle: 'A & B <"C">',
  createdAt: "2026-10-29T01:02:03.000Z",
  genre: "テクノロジー",
  summary: "要約 & <script>",
};

describe("escapeXml", () => {
  test("XMLの特殊文字をエスケープする", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildSitemap", () => {
  test("トップと対談のURLを載せる", () => {
    const xml = buildSitemap("https://example.com", [session]);
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/s/ses_1_a</loc>");
    expect(xml).toContain("<lastmod>2026-10-29T01:02:03.000Z</lastmod>");
  });

  test("対談がなくてもトップは載る", () => {
    expect(buildSitemap("https://example.com", [])).toContain("<loc>https://example.com/</loc>");
  });
});

describe("buildRss", () => {
  test("題名と要約はエスケープされ、日付はRFC 822形式になる", () => {
    const xml = buildRss("https://example.com", [session]);
    expect(xml).toContain("<title>A &amp; B &lt;&quot;C&quot;&gt;</title>");
    expect(xml).toContain("<description>要約 &amp; &lt;script&gt;</description>");
    expect(xml).toContain("<pubDate>Thu, 29 Oct 2026 01:02:03 GMT</pubDate>");
    expect(xml).toContain("<category>テクノロジー</category>");
  });
});

describe("buildRobots", () => {
  test("管理画面とAPIを除き、サイトマップを知らせる", () => {
    const txt = buildRobots("https://example.com");
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /api/");
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
  });
});
