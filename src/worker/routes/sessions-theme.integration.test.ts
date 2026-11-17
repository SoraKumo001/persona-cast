/**
 * テーマ論戦の POST /api/sessions 統合テスト。
 * 調査本体は差し替え、保存と progress・重複判定だけを見る。
 */
import { describe, expect, mock, test } from "bun:test";
import * as themeResearch from "../services/theme-research";
import { heatedSourceUrl, themeSourceUrl } from "../services/theme";
import type { Env } from "../types";

mock.module("../services/theme-research", () => ({
  ...themeResearch,
  researchTheme: () =>
    Promise.resolve({
      title: "ReactのRSC",
      analysis: {
        adult: false,
        genre: "プログラミング・開発",
        keyPoints: ["必要性", "採用コスト", "代替"],
        keyQuotes: ["Server Components"],
        personaIds: ["ken", "yuki", "ren"],
        summary: "RSCの是非についての調査要約",
      },
      articleSummary:
        "【要約】\nRSCの是非についての調査要約\n\n【参考ページ】\n- [overview] React | https://react.dev/rsc",
      researched: true,
      sources: [{ stance: "overview" as const, title: "React", url: "https://react.dev/rsc" }],
      ogp: { title: "React", description: null, image: null, siteName: "react.dev", type: null, favicon: null },
    }),
}));

const { default: sessionsRouter } = await import("./sessions");
const { Hono } = await import("hono");
const app = new Hono<{ Bindings: Env }>().route("/api/sessions", sessionsRouter);

const THEME = "ReactのRSC";
const THEME_KEY = themeSourceUrl(THEME);
const HEATED_KEY = heatedSourceUrl(THEME);

const personaRows = [
  { id: "ken", name: "ケン", role: "エンジニア", personality: "技術に厳しい" },
  { id: "yuki", name: "ユキ", role: "PM", personality: "前向き" },
  { id: "ren", name: "レン", role: "リサーチャー", personality: "慎重" },
];

function fakeDb(
  existing: {
    articleSummary?: string;
    hiddenAt: string | null;
    id: string;
    messageCount?: number;
    normalizedUrl: string;
  }[] = []
) {
  const researchedSummary =
    "既存\n\n【参考ページ】\n- [overview] React | https://react.dev/rsc";
  const sessions = existing.map((s) => ({
    id: s.id,
    sourceUrl: s.normalizedUrl,
    normalizedUrl: s.normalizedUrl,
    articleTitle: THEME,
    articleSummary: s.articleSummary ?? researchedSummary,
    summary: "既存",
    genre: "プログラミング・開発",
    mode: "debate",
    ogJson: null as string | null,
    personaIds: '["ken","yuki","ren"]',
    createdAt: "2026-10-29T00:00:00.000Z",
    hiddenAt: s.hiddenAt,
    messageCount: s.messageCount ?? 0,
  }));
  const inserts: unknown[][] = [];
  const deleted: string[] = [];

  const statement = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      first(): unknown {
        if (sql.includes("count(*) as count FROM personas")) {
          return { count: personaRows.length };
        }
        if (sql.startsWith("SELECT value FROM app_settings")) {
          return null;
        }
        if (sql.includes("COUNT(*) as count FROM sessions WHERE created_at >=")) {
          return { count: 0 };
        }
        if (sql.includes("COUNT(*) as count FROM messages WHERE session_id = ?")) {
          const [sessionId] = binds as [string];
          const row = sessions.find((s) => s.id === sessionId);
          return { count: row?.messageCount ?? 0 };
        }
        if (sql.includes("FROM sessions WHERE normalized_url = ?")) {
          const [normalizedUrl] = binds as [string];
          const row = sessions.find((s) => s.normalizedUrl === normalizedUrl);
          return row
            ? {
                id: row.id,
                sourceUrl: row.sourceUrl,
                normalizedUrl: row.normalizedUrl,
                articleTitle: row.articleTitle,
                articleSummary: row.articleSummary,
                summary: row.summary,
                genre: row.genre,
                mode: row.mode,
                ogJson: row.ogJson,
                personaIds: row.personaIds,
                createdAt: row.createdAt,
                hiddenAt: row.hiddenAt,
              }
            : null;
        }
        return null;
      },
      all(): unknown {
        if (sql.includes("FROM memory_chunks")) {
          return { results: [] };
        }
        if (sql.startsWith("SELECT id, name, role, personality")) {
          return { results: personaRows };
        }
        return { results: [] };
      },
      run(): unknown {
        if (sql.startsWith("INSERT INTO sessions")) {
          inserts.push(binds);
          const [
            id,
            sourceUrl,
            normalizedUrl,
            articleTitle,
            articleSummary,
            summary,
            genre,
            mode,
            ogJson,
            personaIds,
            createdAt,
          ] = binds as string[];
          sessions.push({
            id,
            sourceUrl,
            normalizedUrl,
            articleTitle,
            articleSummary,
            summary,
            genre,
            mode,
            ogJson,
            personaIds,
            createdAt,
            hiddenAt: null,
            messageCount: 0,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM sessions WHERE id = ?")) {
          const [id] = binds as [string];
          deleted.push(id);
          const idx = sessions.findIndex((s) => s.id === id);
          if (idx >= 0) {
            sessions.splice(idx, 1);
          }
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM messages") || sql.startsWith("DELETE FROM memory_chunks")) {
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return {
    db: {
      prepare: statement,
      batch: (stmts: { run: () => unknown }[]) => Promise.all(stmts.map((s) => s.run())),
    } as unknown as D1Database,
    sessions,
    inserts,
    deleted,
  };
}

describe("POST /api/sessions (theme)", () => {
  test("theme で論戦セッションを作り、mode=debate で保存する", async () => {
    const { db, inserts, sessions } = fakeDb();
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: THEME }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      existing: boolean;
      sessionId: string;
      mode: string;
      articleTitle: string;
      researched: boolean;
    };
    expect(body).toMatchObject({
      existing: false,
      mode: "debate",
      articleTitle: THEME,
      researched: true,
    });
    expect(inserts).toHaveLength(1);
    expect(sessions[0].mode).toBe("debate");
    expect(sessions[0].normalizedUrl).toBe(THEME_KEY);
  });

  test("同じテーマの2回目は existing を返す", async () => {
    const { db } = fakeDb([{ id: "ses_theme_1", normalizedUrl: THEME_KEY, hiddenAt: null }]);
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: "  ReactのRSC  " }),
      },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ existing: true, sessionId: "ses_theme_1", mode: "debate" });
  });

  test("調査なしの未生成セッションは捨てて作り直す", async () => {
    const { db, deleted, sessions } = fakeDb([
      {
        id: "ses_thin_1",
        normalizedUrl: THEME_KEY,
        hiddenAt: null,
        articleSummary: "調査失敗のフォールバック",
        messageCount: 0,
      },
    ]);
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: THEME }),
      },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ existing: false, researched: true });
    expect(deleted).toContain("ses_thin_1");
    expect(sessions.some((s) => s.id === "ses_thin_1")).toBe(false);
  });

  test("ndjson では researching → analyzing の順で進む", async () => {
    const { db } = fakeDb();
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify({ theme: THEME }),
      },
      env
    );
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.slice(0, 2)).toEqual([
      { type: "progress", step: "researching" },
      { type: "progress", step: "analyzing" },
    ]);
    expect(lines[2]).toMatchObject({ type: "result", status: 200, body: { mode: "debate" } });
  });

  test("heated: true で激論セッションを作り、mode=heated・heated:// で保存する", async () => {
    const { db, sessions } = fakeDb();
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: THEME, heated: true }),
      },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      existing: false,
      mode: "heated",
      articleTitle: THEME,
      researched: true,
    });
    expect(sessions[0].mode).toBe("heated");
    expect(sessions[0].normalizedUrl).toBe(HEATED_KEY);
  });

  test("同じテーマでも論戦と激論は別セッションになる", async () => {
    const { db } = fakeDb([{ id: "ses_theme_1", normalizedUrl: THEME_KEY, hiddenAt: null }]);
    const env = { DB: db } as unknown as Env;
    const res = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: THEME, heated: true }),
      },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ existing: false, mode: "heated" });
  });

  test("url と theme の同時指定や両方なしは 400", async () => {
    const { db } = fakeDb();
    const env = { DB: db } as unknown as Env;
    const both = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://a.test", theme: THEME }),
      },
      env
    );
    expect(both.status).toBe(400);

    const neither = await app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      env
    );
    expect(neither.status).toBe(400);
  });
});
