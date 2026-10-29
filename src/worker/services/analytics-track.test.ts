import { describe, expect, test } from "bun:test";
import { classifyDevice, classifyRoute, jstDay, referrerHost, visitorHash } from "./analytics-track";

describe("classifyDevice", () => {
  test("ボット・空のUAはbot", () => {
    expect(classifyDevice("")).toBe("bot");
    expect(classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot");
    expect(classifyDevice("Twitterbot/1.0")).toBe("bot");
    expect(classifyDevice("curl/8.0")).toBe("bot");
  });
  test("モバイル・タブレット・PC", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148")).toBe(
      "mobile"
    );
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobile Safari")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit Safari")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari/537")).toBe("pc");
  });
});

describe("classifyRoute", () => {
  test("ページ: 対談ページはIDを詳細に分け、ルート名には含めない", () => {
    expect(classifyRoute("/")).toEqual({ type: "pv", route: "/", detail: "" });
    expect(classifyRoute("/memories")).toEqual({ type: "pv", route: "/memories", detail: "" });
    expect(classifyRoute("/s/ses_123_abc")).toEqual({ type: "pv", route: "/s/:id", detail: "ses_123_abc" });
  });
  test("未知のパスは other にまとめる (種類が増えない)", () => {
    expect(classifyRoute("/wp-login.php")).toEqual({ type: "pv", route: "other", detail: "" });
    expect(classifyRoute("/random/12345")).toEqual({ type: "pv", route: "other", detail: "" });
  });
  test("API", () => {
    expect(classifyRoute("/api/sessions")?.route).toBe("/api/sessions");
    expect(classifyRoute("/api/sessions/ses_1")?.route).toBe("/api/sessions/:id");
    expect(classifyRoute("/api/sessions/ses_1/stream")?.route).toBe("/api/sessions/:id/stream");
    expect(classifyRoute("/api/whatever")?.route).toBe("/api/other");
  });
  test("管理・静的ファイル・サーバー関数・ヘルスチェックは対象外", () => {
    for (const p of [
      "/admin",
      "/admin/analytics",
      "/api/admin/settings",
      "/assets/app.js",
      "/favicon.ico",
      "/_serverFn/abc",
      "/api/health",
      "/api/sessions/ses_1/ogp.png",
      "/logo.svg",
    ]) {
      expect(classifyRoute(p)).toBeNull();
    }
    expect(classifyRoute("/administrator")).not.toBeNull();
  });
});

describe("referrerHost", () => {
  test("ホスト名だけを小文字で返し、wwwは外す", () => {
    expect(referrerHost("https://www.Example.com/path?q=1", "croud.jp")).toBe("example.com");
    expect(referrerHost("https://t.co/abc", "croud.jp")).toBe("t.co");
  });
  test("自サイト・無し・不正は空", () => {
    expect(referrerHost("https://croud.jp/s/1", "croud.jp")).toBe("");
    expect(referrerHost("https://www.croud.jp/", "croud.jp")).toBe("");
    expect(referrerHost(null, "croud.jp")).toBe("");
    expect(referrerHost("not a url", "croud.jp")).toBe("");
  });
});

describe("visitorHash / jstDay", () => {
  test("同じ入力は同じ値、日付やソルトが違えば別の値で、生のIPを含まない", async () => {
    const a = await visitorHash("203.0.113.9", "UA", "2026-10-29", "salt");
    expect(a).toBe(await visitorHash("203.0.113.9", "UA", "2026-10-29", "salt"));
    expect(a).not.toBe(await visitorHash("203.0.113.9", "UA", "2026-10-30", "salt"));
    expect(a).not.toBe(await visitorHash("203.0.113.9", "UA", "2026-10-29", "other"));
    expect(a).toMatch(/^[0-9a-f]{16}$/u);
    expect(a).not.toContain("203");
  });
  test("日本時間の日付", () => {
    expect(jstDay(new Date("2026-10-29T14:59:00Z"))).toBe("2026-10-29");
    expect(jstDay(new Date("2026-10-29T15:00:00Z"))).toBe("2026-10-30");
  });
});

describe("trackRequest / trackEvent", () => {
  const setup = () => {
    const points: any[] = [];
    const pending: Promise<unknown>[] = [];
    const env: any = { ANALYTICS: { writeDataPoint: (p: unknown) => points.push(p) }, ANALYTICS_SALT: "s" };
    const ctx: any = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
    return { points, pending, env, ctx };
  };
  const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Request(`https://croud.jp${path}`, { method, headers });
  const html = (status = 200, headers: Record<string, string> = {}) =>
    new Response("<html></html>", { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

  test("対談ページの表示を、ルート・詳細・キャッシュ・国・参照元・端末つきで記録する", async () => {
    const { points, pending, env, ctx } = setup();
    const { trackRequest } = await import("./analytics-track");
    trackRequest(
      env,
      ctx,
      req("/s/ses_1", {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
        "cf-connecting-ip": "203.0.113.9",
        "cf-ipcountry": "JP",
        referer: "https://t.co/xyz",
      }),
      html(200, { "x-cache": "HIT" }),
      Date.now() - 5
    );
    await Promise.all(pending);
    expect(points).toHaveLength(1);
    const [p] = points;
    expect(p.blobs.slice(0, 7)).toEqual(["pv", "/s/:id", "ses_1", "HIT", "JP", "t.co", "mobile"]);
    expect(p.blobs[7]).toMatch(/^[0-9a-f]{16}$/u);
    expect(JSON.stringify(p)).not.toContain("203.0.113.9");
    expect(p.doubles[0]).toBe(200);
    expect(p.doubles[1]).toBeGreaterThanOrEqual(0);
  });

  test("対象外 (管理画面・HTML以外のGET・静的ファイル) は記録しない。APIのPOSTは記録する", async () => {
    const { points, pending, env, ctx } = setup();
    const { trackRequest } = await import("./analytics-track");
    trackRequest(env, ctx, req("/admin"), html(), Date.now());
    trackRequest(
      env,
      ctx,
      req("/"),
      new Response("{}", { headers: { "content-type": "application/json" } }),
      Date.now()
    );
    trackRequest(
      env,
      ctx,
      req("/favicon.svg"),
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
      Date.now()
    );
    trackRequest(env, ctx, req("/api/sessions", {}, "POST"), new Response("{}", { status: 429 }), Date.now());
    await Promise.all(pending);
    expect(points).toHaveLength(1);
    expect(points[0].blobs.slice(0, 2)).toEqual(["api", "/api/sessions"]);
    expect(points[0].doubles[0]).toBe(429);
  });

  test("ANALYTICS が無ければ何もしない。書き込みが失敗しても例外にしない", async () => {
    const { trackRequest, trackEvent } = await import("./analytics-track");
    const { ctx } = setup();
    expect(() => trackRequest({} as any, ctx, req("/"), html(), Date.now())).not.toThrow();
    expect(() => trackEvent({} as any, "x")).not.toThrow();
    const broken: any = {
      ANALYTICS: {
        writeDataPoint: () => {
          throw new Error("boom");
        },
      },
    };
    expect(() => trackEvent(broken, "x")).not.toThrow();
  });

  test("業務イベントは種別eventで、名前と数値を記録する", async () => {
    const { points, env } = setup();
    const { trackEvent } = await import("./analytics-track");
    trackEvent(env, "llm_usage", { value: 1000, extra: 750 });
    expect(points[0].blobs.slice(0, 3)).toEqual(["event", "event", "llm_usage"]);
    expect(points[0].doubles).toEqual([0, 0, 1000, 750]);
  });
});
