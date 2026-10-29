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
  .validator((genre: string | undefined) => genre)
  .handler(async ({ data: genre }) => {
    const { listSessions } = await import("../worker/services/session-queries");
    try {
      return await listSessions(await getDb(), { genre });
    } catch (err) {
      console.error("Failed to list sessions:", err);
      return { sessions: [], genres: [] };
    }
  });

export const getSessionDetailFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { getSessionDetail } = await import("../worker/services/session-queries");
    return getSessionDetail(await getDb(), id);
  });
