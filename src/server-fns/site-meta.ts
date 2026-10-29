import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

/** トップページのリンクプレビュー用に、絶対URLの基準になる origin を返す */
export const getSiteOrigin = createServerFn({ method: "GET" }).handler(async () => getRequestUrl().origin);

/**
 * Cloudflare Web Analytics のビーコン用トークン。設定 (WEB_ANALYTICS_TOKEN) が空なら null で、ビーコンは出さない。
 * トークンは公開されるHTMLに入る値 (秘密ではない)。
 */
export const getWebAnalyticsToken = createServerFn({ method: "GET" }).handler(async (): Promise<string | null> => {
  const { env } = await import("cloudflare:workers");
  const token = (env as { WEB_ANALYTICS_TOKEN?: string }).WEB_ANALYTICS_TOKEN?.trim();
  return token && /^[0-9a-f]{16,64}$/iu.test(token) ? token : null;
});
