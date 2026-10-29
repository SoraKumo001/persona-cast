import { Hono } from "hono";
import { Env } from "../types";
import { ensureDatabaseTables } from "../presets";
import { requireAccess } from "../middleware/access";
import { MAX_DAILY_LIMIT, countTodaySessions, getDailyLimit, setDailyLimit } from "../services/settings";

const app = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>();

app.use("*", requireAccess);
app.use("*", async (c, next) => {
  await ensureDatabaseTables(c.env.DB);
  await next();
});

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
