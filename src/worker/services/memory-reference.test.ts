import { describe, expect, test } from "bun:test";
import type { ReferenceCandidate } from "./memory-reference";
import { detectMemoryReference } from "./memory-reference";

const CURRENT_SESSION = "ses_current";

const NOW = "2026-05-01T12:00:00.000Z";
const PAST = "2026-04-01T00:00:00.000Z";
const FUTURE = "2026-06-01T00:00:00.000Z";

function memory(overrides: Partial<ReferenceCandidate> = {}): ReferenceCandidate {
  return {
    sessionId: "ses_past",
    articleTitle: "生成AI時代の著作権をどう考えるか",
    sourceUrl: "https://example.com/articles/copyright",
    createdAt: PAST,
    ...overrides,
  };
}

describe("detectMemoryReference", () => {
  test("現在のセッションの記憶には参照フラグを付けない (自己参照の回帰)", () => {
    const selfMemory = memory({
      sessionId: CURRENT_SESSION,
      articleTitle: "生成AI時代の著作権をどう考えるか",
    });
    // 現在の記事本文をそのまま引用した発言 (タイトル全体を含む) でも自己参照は付かない
    const content = "「生成AI時代の著作権をどう考えるか」という記事について、私はこう思う。";

    expect(detectMemoryReference(content, [selfMemory], CURRENT_SESSION, NOW)).toBeNull();
  });

  test("タイトルの先頭一致だけでは参照とみなさない", () => {
    const past = memory({ articleTitle: "生成AI時代の著作権制度の今後を考える長いタイトル" });
    // 先頭15文字「生成AI時代の著作権制度の」だけを含む現在記事の引用
    const content = "この記事は生成AI時代の著作権制度を扱っている。";

    expect(detectMemoryReference(content, [past], CURRENT_SESSION, NOW)).toBeNull();
  });

  test("チャンク生成時刻より前の発言には参照フラグを付けない (時系列ガード)", () => {
    const upcoming = memory({ createdAt: FUTURE });

    expect(detectMemoryReference("生成AI時代の著作権をどう考えるか", [upcoming], CURRENT_SESSION, NOW)).toBeNull();
  });

  test("タイトル完全一致なら参照とみなす", () => {
    const result = detectMemoryReference(
      "以前の「生成AI時代の著作権をどう考えるか」という対談でも触れたが、論点は同じだ。",
      [memory()],
      CURRENT_SESSION,
      NOW
    );

    expect(result).toEqual({
      sessionId: "ses_past",
      articleTitle: "生成AI時代の著作権をどう考えるか",
    });
  });

  test("正規化 URL 一致なら参照とみなす (トラッキングクエリ差は無視)", () => {
    const past = memory({ sourceUrl: "https://www.example.com/articles/copyright/" });
    const content = "詳細は https://example.com/articles/copyright?utm_source=x を参照してほしい。";

    expect(detectMemoryReference(content, [past], CURRENT_SESSION, NOW)).toEqual({
      sessionId: "ses_past",
      articleTitle: "生成AI時代の著作権をどう考えるか",
    });
  });

  test("createdAt が無い記憶は存在時刻を示せないので参照とみなさない", () => {
    const unknown = memory({ createdAt: "" });

    expect(detectMemoryReference("生成AI時代の著作権をどう考えるか", [unknown], CURRENT_SESSION, NOW)).toBeNull();
  });
});
