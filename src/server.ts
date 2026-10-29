import startHandler from "@tanstack/react-start/server-entry";
import { withEdgeCache } from "./worker/cache";
import workerApp from "./worker/index";
import { trackRequest } from "./worker/services/analytics-track";
import type { Env } from "./worker/types";

/** TanStack Start のサーバーエントリが公開する fetch ハンドラー */
interface FetchHandler {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> | Response;
}

/** SSR ではなく Hono (worker/index.ts) が返すパス */
const WORKER_FILES = new Set(["/sitemap.xml", "/rss.xml", "/robots.txt"]);

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // API エンドポイント（SSEストリーミング、ペルソナCRUD、セッション作成、記憶検索）と、検索エンジン向けのファイル
  if (url.pathname.startsWith("/api") || WORKER_FILES.has(url.pathname)) {
    return await workerApp.fetch(request, env, ctx);
  }

  // TanStack Start SSR ハンドラー
  try {
    const { fetch: ssrFetch } = startHandler as FetchHandler;
    if (typeof ssrFetch === "function") {
      return await ssrFetch.call(startHandler, request, env, ctx);
    }
  } catch (err) {
    console.error("TanStack Start SSR Error:", err);
  }

  // 静的アセットフォールバック
  if (env.ASSETS) {
    return await env.ASSETS.fetch(request);
  }

  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = Date.now();
    const response = await withEdgeCache(request, ctx, () => handle(request, env, ctx));
    trackRequest(env, ctx, request, response, startedAt);
    return response;
  },
};
