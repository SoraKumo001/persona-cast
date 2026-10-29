import { createServerFn } from "@tanstack/react-start";

/** SSR の loader から呼ぶ。HTTP API を介さず D1 から直接読む */
async function getDb(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const db = (env as { DB: D1Database }).DB;
  const { ensureDatabaseTables } = await import("../worker/presets");
  await ensureDatabaseTables(db);
  return db;
}

export const getSessionList = createServerFn({ method: "GET" })
  .validator((input: { genre?: string; page?: number }) => input)
  .handler(async ({ data: { genre, page } }) => {
    const { listSessions } = await import("../worker/services/session-queries");
    const { cacheFor } = await import("../worker/cache");
    try {
      const result = await listSessions(await getDb(), { genre, page });
      cacheFor(60, { maxAge: 30 });
      return result;
    } catch (err) {
      console.error("Failed to list sessions:", err);
      return { sessions: [], genres: [], page: 1, pageSize: 24, total: 0, totalPages: 1 };
    }
  });

export const getSessionDetailFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { getSessionDetail } = await import("../worker/services/session-queries");
    const { cacheFor } = await import("../worker/cache");
    const detail = await getSessionDetail(await getDb(), id);
    // 発言が保存された対談は変わらないのでSSRの応答ごとキャッシュする。生成前・生成中・未存在は載せない
    if (detail && detail.messages.length > 0) {
      cacheFor(600, { maxAge: 60 });
    }
    return detail;
  });
