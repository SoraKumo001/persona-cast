/**
 * GET /api/sessions/:id/stream の生成中ロック (generating_at) の解除まわりの回帰テスト。
 * - 対談本体 (orchestrateDialogue) はモジュール差し替えで、成功・失敗を直接作る
 * - D1 は必要な問い合わせにだけ答える代役を使う
 */
import { describe, expect, mock, test } from "bun:test";
import type { DialogueEvent } from "../services/dialogue";
import type { Env } from "../types";

type Script = (sessionId: string) => AsyncGenerator<DialogueEvent>;

/** 指定したイベントを流し、最後に失敗させる (省略時は正常終了) スクリプトを作る */
function fromEvents(events: DialogueEvent[], failure?: Error): AsyncGenerator<DialogueEvent> {
  return (async function* run() {
    await Promise.resolve();
    for (const event of events) {
      yield event;
    }
    if (failure) {
      throw failure;
    }
  })();
}

let script: Script = () => fromEvents([]);

mock.module("../services/dialogue", () => ({
  orchestrateDialogue: (sessionId: string) => script(sessionId),
}));

// 差し替えを反映してからルートを読み込む
const { default: sessionsStreamRouter } = await import("./sessions-stream");
const { Hono } = await import("hono");
const app = new Hono<{ Bindings: Env }>().route("/api/sessions", sessionsStreamRouter);

function fakeDb(initialGeneratingAt: string | null = null) {
  const state = { clears: 0, generatingAt: initialGeneratingAt };

  const statement = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      first(): unknown {
        if (sql.includes("count(*) as count FROM personas")) {
          return { count: 1 };
        }
        if (sql.includes("SELECT persona_ids as personaIds")) {
          return { personaIds: '["ken","yuki"]', messageCount: 0 };
        }
        return null;
      },
      all(): unknown {
        return { results: [] };
      },
      run(): unknown {
        if (sql.startsWith("INSERT OR IGNORE INTO personas")) {
          return { meta: { changes: 0 } };
        }
        // 生成中の印を原子的に付ける (GENERATION_STALE_MS より前の印は失効)
        if (sql.startsWith("UPDATE sessions SET generating_at = ?")) {
          const [nowIso, , thresholdIso] = binds as [string, string, string];
          if (state.generatingAt === null || state.generatingAt < thresholdIso) {
            state.generatingAt = nowIso;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith("UPDATE sessions SET generating_at = NULL")) {
          state.generatingAt = null;
          state.clears += 1;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { db: { prepare: statement } as unknown as D1Database, state };
}

function setup(initialGeneratingAt: string | null = null) {
  const { db, state } = fakeDb(initialGeneratingAt);
  const env = { DB: db } as unknown as Env;
  const stream = (id = "ses_stream_1") =>
    app.request(`http://localhost/api/sessions/${id}/stream`, { method: "GET" }, env);
  return { state, stream };
}

describe("GET /api/sessions/:id/stream (生成中ロック)", () => {
  test("LLMが中断しても generating_at を外し、同じ対談をやり直せる", async () => {
    script = () =>
      fromEvents([{ type: "session_start", data: { sessionId: "ses_stream_1" } }], new Error("LLM interrupted"));
    const { state, stream } = setup();

    const res = await stream();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: session_start");
    expect(body).toContain("event: error");
    expect(body).toContain("LLM interrupted");

    // 失敗しても印が残らない
    expect(state.generatingAt).toBeNull();
    expect(state.clears).toBe(1);
  });

  test("生成が成功しても印を外し、次のリクエストが 409 にならない", async () => {
    script = () => fromEvents([{ type: "session_end", data: { message: "対談が完了しました" } }]);
    const { state, stream } = setup();

    const first = await stream();
    expect(first.status).toBe(200);
    await first.text();
    expect(state.generatingAt).toBeNull();

    // 生成済みでなければ (発言0件)、印が残っていないので claim し直せる
    const second = await stream();
    expect(second.status).toBe(200);
    await second.text();
  });
});
