import { describe, expect, test } from "bun:test";
import { buildQueries, buildReport, isRangeKey, num, RANGES } from "./analytics-query";

describe("isRangeKey", () => {
  test("許可リストのキーだけ通す (SQLに埋め込む値を外から受けない)", () => {
    expect(isRangeKey("24h")).toBe(true);
    expect(isRangeKey("7d")).toBe(true);
    expect(isRangeKey("30d")).toBe(true);
    expect(isRangeKey("1' OR '1'='1")).toBe(false);
    expect(isRangeKey("toString")).toBe(false);
    expect(isRangeKey("__proto__")).toBe(false);
    expect(isRangeKey(undefined)).toBe(false);
  });
});

describe("buildQueries", () => {
  test("期間をINTERVALにし、全クエリが同じデータセットを参照する", () => {
    const q = buildQueries("7d", "ds");
    for (const sql of Object.values(q)) {
      expect(sql).toContain("FROM ds");
      expect(sql).toContain("INTERVAL '7' DAY");
    }
    expect(buildQueries("24h", "ds").totals).toContain("INTERVAL '24' HOUR");
  });
  test("グラフの粒度は24時間なら時間、それ以外は日", () => {
    expect(buildQueries("24h", "ds").series).toContain("INTERVAL '1' HOUR");
    expect(buildQueries("30d", "ds").series).toContain("INTERVAL '1' DAY");
    expect(RANGES["24h"].bucket).toBe("HOUR");
  });
  test("人のページビューはボットとエラー応答を除く。サンプリングの重みを使う", () => {
    const q = buildQueries("24h", "ds");
    expect(q.totals).toContain("blob7 != 'bot'");
    expect(q.totals).toContain("double1 < 400");
    expect(q.totals).toContain("SUM(_sample_interval)");
    expect(q.latency).toContain("quantileWeighted");
    expect(q.latency).toContain("!= '/api/sessions/:id/stream'");
  });
});

describe("num", () => {
  test("文字列の数値も受け取り、不正は0", () => {
    expect(num("12")).toBe(12);
    expect(num(3.5)).toBe(3.5);
    expect(num("abc")).toBe(0);
    expect(num(undefined)).toBe(0);
  });
});

describe("buildReport", () => {
  test("空の結果でも壊れない", () => {
    const r = buildReport("24h", {});
    expect(r.totals).toEqual({ pageviews: 0, visitors: 0, botPageviews: 0 });
    expect(r.series).toEqual([]);
    expect(r.cache.hitRate).toBeNull();
    expect(r.llm.cacheRate).toBeNull();
    expect(r.latency).toBeNull();
  });
  test("結果を画面用の形に整える", () => {
    const r = buildReport("7d", {
      totals: [{ pageviews: "120", visitors: "45" }],
      bots: [{ pageviews: "30" }],
      series: [{ t: "2026-10-29 00:00:00", pageviews: "10", visitors: "5" }],
      status: [
        { cls: "2", count: "100" },
        { cls: "4", count: "5" },
      ],
      cache: [
        { cache: "HIT", count: "60" },
        { cache: "MISS", count: "20" },
        { cache: "NONE", count: "40" },
      ],
      latency: [{ p50: "12.4", p95: "300.6" }],
      llm: [{ input: "1000", cached: "750", calls: "10" }],
      events: [{ name: "dialogue_created", count: "3" }],
    });
    expect(r.range).toBe("7d");
    expect(r.bucket).toBe("DAY");
    expect(r.totals).toEqual({ pageviews: 120, visitors: 45, botPageviews: 30 });
    expect(r.status).toEqual([
      { cls: "2xx", count: 100 },
      { cls: "4xx", count: 5 },
    ]);
    // HIT率は、キャッシュの対象 (HIT+MISS) のうちの割合。キャッシュ対象外 (NONE) は含めない
    expect(r.cache.hitRate).toBe(0.75);
    expect(r.latency).toEqual({ p50: 12, p95: 301 });
    expect(r.llm).toEqual({ calls: 10, inputTokens: 1000, cachedTokens: 750, cacheRate: 0.75 });
    expect(r.events).toEqual([{ name: "dialogue_created", count: 3 }]);
  });
});
