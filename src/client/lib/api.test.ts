import { afterEach, describe, expect, mock, test } from "bun:test";
import { ApiError, type CreateSessionStep, createSessionWithProgress } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(chunks: string[], contentType = "application/x-ndjson", status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(body, { status, headers: { "content-type": contentType } }))
  ) as unknown as typeof fetch;
}

describe("createSessionWithProgress", () => {
  test("行が分割されて届いても段階を順に通知し、結果を返す", async () => {
    const line1 = '{"type":"progress","step":"fetching"}\n';
    const line2 = '{"type":"progress","step":"analyzing"}\n';
    const line3 = '{"type":"result","status":200,"body":{"sessionId":"s1"}}\n';
    respondWith([line1.slice(0, 10), line1.slice(10) + line2, line3]);

    const steps: CreateSessionStep[] = [];
    const result = await createSessionWithProgress<{ sessionId: string }>("https://a.test", (s) => steps.push(s));

    expect(steps).toEqual(["fetching", "analyzing"]);
    expect(result).toEqual({ sessionId: "s1" });
  });

  test("最終行のエラーは ApiError になる", async () => {
    respondWith(['{"type":"result","status":400,"body":{"error":"記事の取得に失敗しました"}}\n']);

    const promise = createSessionWithProgress("https://a.test", () => undefined);
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toThrow("記事の取得に失敗しました");
  });

  test("結果の前に切れたら接続エラーにする", async () => {
    respondWith(['{"type":"progress","step":"fetching"}\n']);

    await expect(createSessionWithProgress("https://a.test", () => undefined)).rejects.toThrow("接続が切れました");
  });

  test("通常の JSON 応答 (既存の対談・入力エラー) も扱う", async () => {
    respondWith(['{"sessionId":"s2","existing":true}'], "application/json");
    expect(await createSessionWithProgress("https://a.test", () => undefined)).toEqual({
      sessionId: "s2",
      existing: true,
    });

    respondWith(['{"error":"URLは必須です"}'], "application/json", 400);
    await expect(createSessionWithProgress("https://a.test", () => undefined)).rejects.toThrow("URLは必須です");
  });
});
