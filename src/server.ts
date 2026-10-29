import { Env } from "./worker/types";
import workerApp from "./worker/index";
import { withEdgeCache } from "./worker/cache";
import { trackRequest } from "./worker/services/analytics-track";
import startHandler from "@tanstack/react-start/server-entry";

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // API エンドポイント（SSEストリーミング、ペルソナCRUD、セッション作成、記憶検索）
  if (url.pathname.startsWith("/api")) {
    return await workerApp.fetch(request, env, ctx);
  }

  // TanStack Start SSR ハンドラー
  try {
    if (startHandler && typeof (startHandler as any).fetch === "function") {
      return await (startHandler as any).fetch(request, env, ctx);
    }
  } catch (err: any) {
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
