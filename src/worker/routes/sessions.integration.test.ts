/**
 * POST /api/sessions まわりの統合テスト。
 * - LLM・スクレイピングは呼ばない (scraper だけモジュール差し替え、分析は OPENCODE_API_KEY 未設定のフォールバック)
 * - D1 は本物を使わず、必要な問い合わせにだけ答える代役を使う
 * - SSE (全ターンの生成) は回さない。生成の可否は生成前チェック (409) だけを見る
 */
import { describe, expect, mock, test } from "bun:test";
import { normalizeUrl } from "../services/url-normalize";
import type { Env } from "../types";

const ARTICLE_URL = "https://example.com/article";
const NORMALIZED_URL = normalizeUrl(ARTICLE_URL);

let scrapeCalls = 0;

// HTMLRewriter は bun に無いため、記事の取得だけを差し替える (以降の分析・保存は実装のまま)
mock.module("../services/scraper", () => ({
  ScrapeError: class ScrapeError extends Error {},
  scrapeUrl: () => {
    scrapeCalls += 1;
    return Promise.resolve({
      adultRated: false,
      content: "テスト用の記事本文です。技術的な話題を扱っています。",
      normalizedUrl: NORMALIZED_URL,
      ogp: {
        title: "テスト記事",
        description: "テスト用の説明",
        image: null,
        siteName: null,
        type: null,
        favicon: null,
      },
      title: "テスト記事",
      url: ARTICLE_URL,
    });
  },
}));

// 差し替えを反映してからルートを読み込む
const { default: sessionsRouter } = await import("./sessions");
const { claimSessionGeneration } = await import("../services/session-queries");
const { Hono } = await import("hono");
// index.ts と同じ形でマウントする (静的アセットなどは読み込まない)
const app = new Hono<{ Bindings: Env }>().route("/api/sessions", sessionsRouter);

interface FakeSession {
  articleSummary: string;
  articleTitle: string;
  createdAt: string;
  generatingAt: string | null;
  genre: string | null;
  hiddenAt: string | null;
  id: string;
  messageCount: number;
  normalizedUrl: string;
  ogJson: string | null;
  personaIds: string;
  sourceUrl: string;
  summary: string | null;
}

const session = (over: Partial<FakeSession> = {}): FakeSession => ({
  id: "ses_existing_1",
  sourceUrl: ARTICLE_URL,
  normalizedUrl: NORMALIZED_URL,
  articleTitle: "既存の記事",
  articleSummary: "既存の本文",
  summary: "既存の要約",
  genre: "プログラミング・開発",
  ogJson: JSON.stringify({ title: "既存の記事" }),
  personaIds: '["ken","yuki","ren"]',
  createdAt: "2026-10-29T00:00:00.000Z",
  hiddenAt: null,
  generatingAt: null,
  messageCount: 0,
  ...over,
});

const personaRows = [
  { id: "ken", name: "ケン", role: "エンジニア", personality: "技術に厳しい" },
  { id: "yuki", name: "ユキ", role: "PM", personality: "前向き" },
  { id: "ren", name: "レン", role: "リサーチャー", personality: "慎重" },
];

/** 必要な問い合わせだけに答える D1 の代役。answers に無いものは空の結果を返す */
function fakeDb(
  initial: FakeSession[] = [],
  opts: { dailyLimit?: number; rateCount?: number; todayCount?: number } = {}
) {
  const sessions = initial.map((s) => ({ ...s }));
  const inserts: unknown[][] = [];
  const rateCounts = new Map<string, number>();

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
          return opts.dailyLimit === undefined ? null : { value: String(opts.dailyLimit) };
        }
        if (sql.includes("COUNT(*) as count FROM sessions WHERE created_at >=")) {
          return { count: opts.todayCount ?? 0 };
        }
        if (sql.includes("FROM sessions WHERE normalized_url = ?")) {
          const [normalizedUrl] = binds as [string];
          const hit = sessions
            .filter((s) => s.normalizedUrl === normalizedUrl)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const [row] = hit;
          return row
            ? {
                id: row.id,
                sourceUrl: row.sourceUrl,
                normalizedUrl: row.normalizedUrl,
                articleTitle: row.articleTitle,
                articleSummary: row.articleSummary,
                summary: row.summary,
                genre: row.genre,
                ogJson: row.ogJson,
                personaIds: row.personaIds,
                createdAt: row.createdAt,
                hiddenAt: row.hiddenAt,
              }
            : null;
        }
        if (sql.startsWith("INSERT INTO rate_limits")) {
          const [key] = binds as [string];
          const count = (rateCounts.get(key) ?? opts.rateCount ?? 0) + 1;
          rateCounts.set(key, count);
          return { count };
        }
        if (sql.includes("SELECT persona_ids as personaIds")) {
          const [id] = binds as [string];
          const row = sessions.find((s) => s.id === id && s.hiddenAt === null);
          return row ? { personaIds: row.personaIds, messageCount: row.messageCount } : null;
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
            ogJson,
            personaIds,
            createdAt,
            hiddenAt: null,
            generatingAt: null,
            messageCount: 0,
          });
          return { meta: { changes: 1 } };
        }
        // 生成中の印を原子的に付ける (10分より前の印は失効)
        if (sql.startsWith("UPDATE sessions SET generating_at = ?")) {
          const [nowIso, id, thresholdIso] = binds as [string, string, string];
          const row = sessions.find((s) => s.id === id);
          if (row && (row.generatingAt === null || row.generatingAt < thresholdIso)) {
            row.generatingAt = nowIso;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith("UPDATE sessions SET generating_at = NULL")) {
          const row = sessions.find((s) => s.id === (binds as [string])[0]);
          if (row) {
            row.generatingAt = null;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return {
    db: { prepare: statement } as unknown as D1Database,
    sessions,
    inserts,
  };
}

function setup(initial: FakeSession[] = [], opts: Parameters<typeof fakeDb>[1] = {}, envOverrides: Partial<Env> = {}) {
  const { db, sessions, inserts } = fakeDb(initial, opts);
  // OPENCODE_API_KEY を渡さないので analyzeArticle は LLM を呼ばずフォールバックする
  const env = { DB: db, ...envOverrides } as unknown as Env;
  const post = (body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      "http://localhost/api/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body ?? { url: ARTICLE_URL }),
      },
      env
    );
  const stream = (id: string) => app.request(`http://localhost/api/sessions/${id}/stream`, { method: "GET" }, env);
  return { post, stream, db, sessions, inserts };
}

describe("POST /api/sessions", () => {
  test("同じURLの2回目は取得も生成もせず、同じセッションIDを existing で返す", async () => {
    scrapeCalls = 0;
    const { post, sessions, inserts } = setup();

    const first = await post();
    expect(first.status).toBe(200);
    const created = (await first.json()) as {
      existing: boolean;
      sessionId: string;
      genre: string;
      articleTitle: string;
      totalTurns: number;
      pastMemories: unknown[];
    };
    expect(created).toMatchObject({
      existing: false,
      articleTitle: "テスト記事",
      totalTurns: 9,
      pastMemories: [],
    });
    expect(typeof created.genre).toBe("string");
    expect(created.sessionId).toStartWith("ses_");
    expect(scrapeCalls).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    // 正規化URLで保存されている
    expect(sessions[0].normalizedUrl).toBe(NORMALIZED_URL);

    // 2回目 (表記ゆれ: トラッキング用クエリ付きでも同じURL) は既存を返す
    const second = await post({ url: `${ARTICLE_URL}?utm_source=test` });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      existing: true,
      sessionId: created.sessionId,
      genre: created.genre,
      articleTitle: "テスト記事",
    });
    // 取得も保存も増えない
    expect(scrapeCalls).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });

  test("非表示 (hidden_at 設定済み) の対談は 409 で返し、作り直させない", async () => {
    scrapeCalls = 0;
    const { post, inserts } = setup([session({ hiddenAt: "2026-10-29T12:00:00.000Z" })]);

    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "この記事の対談は公開されていません" });
    expect(inserts).toHaveLength(0);
    expect(scrapeCalls).toBe(0);
  });

  test("生成済み (発言あり) の対談の stream は 409", async () => {
    const { stream } = setup([session({ messageCount: 3 })]);

    const res = await stream("ses_existing_1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "この対談は生成済みです" });
  });

  test("生成中の対談は 409。10分を過ぎた印は失効扱いで引き継げる (時刻はモック)", async () => {
    const lockedAt = new Date().toISOString();
    const { stream } = setup([session({ generatingAt: lockedAt })]);

    const res = await stream("ses_existing_1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "この対談は生成中です" });

    // 10分以内は claim できない
    const mockLock = "2026-10-30T00:00:00.000Z";
    const fresh = setup([session({ generatingAt: mockLock })]);
    expect(await claimSessionGeneration(fresh.db, "ses_existing_1", new Date("2026-10-30T00:09:59.000Z"))).toBe(false);
    expect(fresh.sessions[0].generatingAt).toBe(mockLock);

    // 10分を過ぎていれば claim できる (ちょうど10分は失効しない)
    const stale = setup([session({ generatingAt: mockLock })]);
    expect(await claimSessionGeneration(stale.db, "ses_existing_1", new Date("2026-10-30T00:10:00.000Z"))).toBe(false);
    expect(await claimSessionGeneration(stale.db, "ses_existing_1", new Date("2026-10-30T00:10:01.000Z"))).toBe(true);
    expect(stale.sessions[0].generatingAt).toBe("2026-10-30T00:10:01.000Z");
  });

  test("IPごとのレート制限を超えたら 429 (取得も保存もしない)", async () => {
    scrapeCalls = 0;
    const { post, inserts } = setup([], { rateCount: 10 });

    const res = await post({ url: ARTICLE_URL }, { "CF-Connecting-IP": "203.0.113.5" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: "リクエストが多すぎます。しばらくしてからもう一度お試しください。",
    });
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(scrapeCalls).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});
