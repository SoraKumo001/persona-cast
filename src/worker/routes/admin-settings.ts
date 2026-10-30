import { Hono } from "hono";
import { requireAccess } from "../middleware/access";
import { countTodaySessions, getDailyLimit, MAX_DAILY_LIMIT, setDailyLimit } from "../services/settings";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>();

app.use("*", requireAccess);

async function current(db: D1Database) {
  const [dailyLimit, todayCount] = await Promise.all([getDailyLimit(db), countTodaySessions(db)]);
  return { dailyLimit, todayCount, maxDailyLimit: MAX_DAILY_LIMIT };
}

app.get("/", async (c) => c.json(await current(c.env.DB)));

app.put("/", async (c) => {
  const body = await c.req.json<{ dailyLimit?: unknown }>().catch(() => ({}) as { dailyLimit?: unknown });
  const n = body.dailyLimit;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_DAILY_LIMIT) {
    return c.json({ error: `1日の対談数は 0〜${MAX_DAILY_LIMIT} の整数で指定してください` }, 400);
  }
  await setDailyLimit(c.env.DB, n);
  return c.json(await current(c.env.DB));
});

export default app;
