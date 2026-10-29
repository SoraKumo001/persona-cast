import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

/** トップページのリンクプレビュー用に、絶対URLの基準になる origin を返す */
export const getSiteOrigin = createServerFn({ method: "GET" }).handler(async () => getRequestUrl().origin);
