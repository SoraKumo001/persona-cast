import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import type { Analysis } from "./analyze";
import { type RegenerateDeps, regenerateSession } from "./regenerate";
import type { ScrapedArticle } from "./scraper";

interface Row {
  article_summary: string;
  article_title: string;
  generating_at: string | null;
  og_json: string | null;
  source_url: string;
}

const stored: Row = {
  source_url: "https://example.com/a",
  article_title: "古いタイトル",
  article_summary: "保存してある本文",
  og_json: JSON.stringify({ description: "古いOGP" }),
  generating_at: null,
};

const analysis: Analysis = {
  adult: false,
  genre: "プログラミング・開発",
  personaIds: ["eng", "dog", "ana"],
  summary: "新しい要約",
};

const scrapedArticle = (over: Partial<ScrapedArticle> = {}): ScrapedArticle => ({
  adultRated: false,
  content: "取り直した本文",
  normalizedUrl: "https://example.com/a",
  ogp: { title: "新OGP", description: null, image: null, siteName: null, type: null, favicon: null },
  title: "新しいタイトル",
  url: "https://example.com/a",
  ...over,
});

function setup(session: Row | null, opts: { memories?: string[]; vectorize?: boolean } = {}) {
  const batched: { sql: string; binds: unknown[] }[] = [];
  const deleted: { vectors: string[][]; r2: string[] } = { vectors: [], r2: [] };
  const statement = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      sql,
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      get binds() {
        return binds;
      },
      first() {
        return sql.startsWith("SELECT source_url") ? session : null;
      },
      all() {
        if (sql.startsWith("SELECT id FROM memory_chunks")) {
          return { results: (opts.memories ?? []).map((id) => ({ id })) };
        }
        // 参加できるペルソナの候補
        return {
          results: [
            { id: "eng", name: "モグ", role: "エンジニア", personality: "技術" },
            { id: "dog", name: "ポチ", role: "犬", personality: "食いしん坊" },
            { id: "ana", name: "コン", role: "リサーチャー", personality: "データ" },
          ],
        };
      },
    };
    return stmt;
  };
  const env = {
    DB: {
      prepare: statement,
      batch(stmts: ReturnType<typeof statement>[]) {
        for (const s of stmts) {
          batched.push({ sql: s.sql, binds: s.binds });
        }
        return Promise.resolve([]);
      },
    },
    AVATARS: {
      list: () => Promise.resolve({ objects: [{ key: "ogp/ses_1/v3-9.png" }, { key: "ogp/ses_1/v3-6.png" }] }),
      delete: (key: string) => {
        deleted.r2.push(key);
        return Promise.resolve();
      },
    },
    VECTORIZE:
      opts.vectorize === false
        ? undefined
        : {
            deleteByIds: (ids: string[]) => {
              deleted.vectors.push(ids);
              return Promise.resolve({});
            },
          },
  } as unknown as Env;
  return { env, batched, deleted };
}

const deps = (over: Partial<RegenerateDeps> = {}): RegenerateDeps => ({
  scrape: () => Promise.resolve(scrapedArticle()),
  analyze: () => Promise.resolve(analysis),
  ...over,
});

describe("regenerateSession", () => {
  test("対談がなければ 404", async () => {
    const { env } = setup(null);
    expect(await regenerateSession(env, "ses_1", deps())).toEqual({
      ok: false,
      status: 404,
      error: "対談が見つかりません",
    });
  });

  test("生成中 (10分以内) なら 409 で、何も消さない", async () => {
    const { env, batched } = setup({ ...stored, generating_at: new Date().toISOString() });
    const result = await regenerateSession(env, "ses_1", deps());
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(batched).toHaveLength(0);
  });

  test("10分より前の生成中の印は失効扱いで、再生成できる", async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const { env } = setup({ ...stored, generating_at: old });
    expect(await regenerateSession(env, "ses_1", deps())).toMatchObject({ ok: true });
  });

  test("記事を取り直して分析し、対談を更新して発言と記憶を消す", async () => {
    const { env, batched, deleted } = setup(stored, { memories: ["mem_1"] });
    const result = await regenerateSession(env, "ses_1", deps());
    expect(result).toEqual({
      ok: true,
      genre: "プログラミング・開発",
      personaIds: ["eng", "dog", "ana"],
      scraped: true,
    });

    expect(batched.map((b) => b.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "UPDATE sessions SET",
      "DELETE FROM messages",
      "DELETE FROM memory_chunks",
    ]);
    const update = batched[0].binds;
    expect(update[0]).toBe("新しいタイトル");
    expect(update[1]).toBe("取り直した本文");
    expect(update[3]).toBe("新しい要約");
    expect(update[4]).toBe("プログラミング・開発");
    expect(update[5]).toBe('["eng","dog","ana"]');
    expect(update[6]).toBe("ses_1");

    expect(deleted.vectors).toEqual([["mem_1"]]);
    expect(deleted.r2.sort()).toEqual(["ogp/ses_1/v3-6.png", "ogp/ses_1/v3-9.png"]);
  });

  test("記事を取り直せなければ、保存してある本文で分析する", async () => {
    let analyzed: { title: string; content: string } | undefined;
    const { env } = setup(stored);
    const result = await regenerateSession(
      env,
      "ses_1",
      deps({
        scrape: () => Promise.reject(new Error("404")),
        analyze: (_env, _id, article) => {
          analyzed = article;
          return Promise.resolve(analysis);
        },
      })
    );
    expect(result).toMatchObject({ ok: true, scraped: false });
    expect(analyzed).toMatchObject({ title: "古いタイトル", content: "保存してある本文" });
  });

  test("成人向けと判定されたら 400 で、何も消さない", async () => {
    const adult = setup(stored);
    const byAnalysis = await regenerateSession(
      adult.env,
      "ses_1",
      deps({ analyze: () => Promise.resolve({ ...analysis, adult: true }) })
    );
    expect(byAnalysis).toMatchObject({ ok: false, status: 400 });
    expect(adult.batched).toHaveLength(0);

    const rated = setup(stored);
    const byRating = await regenerateSession(
      rated.env,
      "ses_1",
      deps({ scrape: () => Promise.resolve(scrapedArticle({ adultRated: true })) })
    );
    expect(byRating).toMatchObject({ ok: false, status: 400 });
    expect(rated.batched).toHaveLength(0);
  });

  test("Vectorize が無くても再生成できる", async () => {
    const { env } = setup(stored, { memories: ["mem_1"], vectorize: false });
    expect(await regenerateSession(env, "ses_1", deps())).toMatchObject({ ok: true });
  });
});
