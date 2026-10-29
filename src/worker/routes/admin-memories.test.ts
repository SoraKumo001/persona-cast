import { describe, expect, test } from "bun:test";
import type { Env } from "../types";
import app from "./admin-memories";

interface Chunk {
  article_title: string;
  created_at: string;
  embedding_json: string | null;
  id: string;
  key_quotes: string;
  persona_ids: string;
  session_id: string;
  source_url: string;
  topic_summary: string;
}

const chunk = (n: number, embedding: number[] | null): Chunk => ({
  id: `mem_${String(n).padStart(4, "0")}`,
  session_id: `ses_${n}`,
  article_title: `記事${n}`,
  source_url: `https://example.com/${n}`,
  topic_summary: "要約",
  key_quotes: "引用",
  persona_ids: '["ken"]',
  embedding_json: embedding ? JSON.stringify(embedding) : null,
  created_at: "2026-10-29T00:00:00.000Z",
});

/** 必要な問い合わせだけに答える D1 の代役。それ以外 (テーブルの準備など) は空の結果を返す */
function fakeDb(chunks: Chunk[]) {
  const updates: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        all() {
          if (sql.includes("FROM memory_chunks WHERE id >")) {
            const [after, limit] = binds as [string, number];
            return { results: chunks.filter((c) => c.id > after).slice(0, limit) };
          }
          return { results: [{ name: "x" }] };
        },
        first() {
          return sql.includes("COUNT(*) as total") ? { total: chunks.length } : { count: 1 };
        },
        run() {
          if (sql.startsWith("UPDATE memory_chunks")) {
            updates.push(binds);
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, updates };
}

function setup(chunks: Chunk[], opts: { vectorize?: boolean; failUpsert?: boolean } = {}) {
  const upserts: { id: string; values: number[]; metadata?: Record<string, string> }[][] = [];
  const { db, updates } = fakeDb(chunks);
  const env = {
    DB: db,
    ACCESS_DISABLED: "true",
    VECTORIZE:
      opts.vectorize === false
        ? undefined
        : {
            upsert: (records: (typeof upserts)[number]) => {
              if (opts.failUpsert) {
                return Promise.reject(new Error("boom"));
              }
              upserts.push(records);
              return Promise.resolve({});
            },
            query: () => Promise.resolve({}),
          },
  } as unknown as Env;
  const call = (path: string, body?: unknown) =>
    app.request(
      `http://localhost${path}`,
      { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) },
      env
    );
  return { call, upserts, updates };
}

describe("admin memories resync", () => {
  test("件数と Vectorize の有無を返す", async () => {
    const res = await setup([chunk(1, [1, 0])]).call("/");
    expect(await res.json()).toEqual({ total: 1, vectorize: true });
  });

  test("Vectorize が無ければ 503", async () => {
    const res = await setup([chunk(1, [1, 0])], { vectorize: false }).call("/resync", {});
    expect(res.status).toBe(503);
  });

  test("保存済みの埋め込みとメタデータで登録し、続きが無ければ next は null", async () => {
    const { call, upserts } = setup([chunk(1, [1, 0]), chunk(2, [0, 1])]);
    const res = await call("/resync", {});
    expect(await res.json()).toEqual({ processed: 2, regenerated: 0, next: null });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].map((r) => r.id)).toEqual(["mem_0001", "mem_0002"]);
    expect(upserts[0][0].values).toEqual([1, 0]);
    expect(upserts[0][0].metadata).toMatchObject({
      sessionId: "ses_1",
      articleTitle: "記事1",
      personaIds: '["ken"]',
      createdAt: "2026-10-29T00:00:00.000Z",
    });
  });

  test("50件ごとに区切り、next から続けられる", async () => {
    const chunks = Array.from({ length: 51 }, (_, i) => chunk(i + 1, [1, 0]));
    const { call } = setup(chunks);
    const first = (await (await call("/resync", {})).json()) as { processed: number; next: string | null };
    expect(first.processed).toBe(50);
    expect(first.next).toBe("mem_0050");
    const second = (await (await call("/resync", { after: first.next })).json()) as {
      processed: number;
      next: string | null;
    };
    expect(second).toEqual({ processed: 1, regenerated: 0, next: null });
  });

  test("埋め込みが無い記憶は作り直して D1 にも戻す", async () => {
    const { call, upserts, updates } = setup([chunk(1, null)]);
    const res = await call("/resync", {});
    expect(await res.json()).toEqual({ processed: 1, regenerated: 1, next: null });
    expect(upserts[0][0].values).toHaveLength(1024);
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe("mem_0001");
  });

  test("Vectorize への登録に失敗したら 502", async () => {
    const res = await setup([chunk(1, [1, 0])], { failUpsert: true }).call("/resync", {});
    expect(res.status).toBe(502);
  });
});
