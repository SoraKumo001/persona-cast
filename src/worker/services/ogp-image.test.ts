import { describe, expect, test } from "bun:test";
import { buildOgpHtml, buildSiteOgpHtml, escapeHtml, excerpt, pickQuotes } from "./ogp-image";

const persona = { id: "ken", name: "ケン", avatar: "💻", themeColor: "#2563eb" };

describe("escapeHtml", () => {
  test("HTMLの特殊文字をエスケープする", () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  });
});

describe("excerpt", () => {
  test("短ければそのまま返す", () => {
    expect(excerpt("要するにそうだな。")).toBe("要するにそうだな。");
  });
  test("長ければ文の区切りで切り、省略記号を付ける", () => {
    const text = `最初の文はここまでです。${"あ".repeat(100)}`;
    expect(excerpt(text, 30)).toBe("最初の文はここまでです。…");
  });
  test("区切りがなければ上限で切る", () => {
    expect(excerpt("あ".repeat(100), 10)).toHaveLength(10);
  });
});

describe("pickQuotes", () => {
  test("ペルソナごとに最初の発言を、先頭から limit 人分選ぶ", () => {
    const msgs = [
      { personaId: "a", content: "1" },
      { personaId: "a", content: "2" },
      { personaId: "b", content: " " },
      { personaId: "b", content: "3" },
      { personaId: "c", content: "4" },
    ];
    expect(pickQuotes(msgs, 2).map((m) => m.content)).toEqual(["1", "3"]);
  });
});

describe("buildOgpHtml", () => {
  const base = {
    title: "<script>alert(1)</script>タイトル",
    summary: "要約",
    sourceUrl: "https://www.example.com/a",
    participantCount: 2,
    messageCount: 6,
    quotes: [{ persona: { ...persona, name: "<b>ケン</b>" }, text: "<img src=x>発言" }],
  };

  test("記事・発言・名前由来のテキストをエスケープする", () => {
    const html = buildOgpHtml(base);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<b>ケン</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("サイト名がなければホスト名を表示し、人数と発言数を載せる", () => {
    const html = buildOgpHtml(base);
    expect(html).toContain("example.com");
    expect(html).toContain("2人が6発言で対談");
  });

  test("ジャンルをバッジで表示し、エスケープする", () => {
    expect(buildOgpHtml({ ...base, genre: "AI・機械学習" })).toContain("AI・機械学習");
    expect(buildOgpHtml({ ...base, genre: "<i>x</i>" })).not.toContain("<i>x</i>");
  });

  test("不正なテーマ色はデフォルト色に置き換える", () => {
    const html = buildOgpHtml({ ...base, quotes: [{ persona: { ...persona, themeColor: "red;}</div>" }, text: "x" }] });
    expect(html).not.toContain("red;}");
    expect(html).toContain("#6366f1");
  });
});

describe("buildSiteOgpHtml", () => {
  test("出演者の名前 (括弧の英名は除く) を並べ、名前・色はエスケープ/検証する", () => {
    const html = buildSiteOgpHtml({
      personas: [
        { ...persona, name: "ケン (Ken)" },
        { id: "x", name: "<script>alert(1)</script>", avatar: "🐶", themeColor: "red;background:url(x)" },
      ],
    });
    expect(html).toContain(">ケン</div>");
    expect(html).not.toContain("(Ken)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("background:url(x)");
    expect(html).toContain("Persona-Cast");
  });
});
