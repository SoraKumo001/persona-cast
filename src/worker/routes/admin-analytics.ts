import { Hono } from "hono";
import { requireAccess } from "../middleware/access";
import {
  type AnalyticsReport,
  fetchReport,
  isAnalyticsConfigured,
  isRangeKey,
  type RangeKey,
} from "../services/analytics-query";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { adminEmail: string } }>();

app.use("*", requireAccess);

// 管理画面を開き直すたびに SQL API を叩かないよう、isolate 内で短く保持する
const CACHE_MS = 60_000;
const memo = new Map<RangeKey, { at: number; value: { report: AnalyticsReport; errors: string[] } }>();

app.get("/", async (c) => {
  const range = c.req.query("range") ?? "24h";
  if (!isRangeKey(range)) {
    return c.json({ error: "range は 24h / 7d / 30d のいずれかです" }, 400);
  }

  if (!isAnalyticsConfigured(c.env)) {
    return c.json({ configured: false, hasDataset: !!c.env.ANALYTICS });
  }

  let entry = memo.get(range);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    entry = { at: Date.now(), value: await fetchReport(c.env, range) };
    // すべて失敗したときは保持しない (一時的な障害を1分間見せ続けない)
    if (entry.value.errors.length < 14) {
      memo.set(range, entry);
    }
  }
  const { report, errors } = entry.value;

  // 閲覧の多い対談に、タイトルとジャンルを付ける
  const ids = report.topDialogues.map((d) => d.id);
  const titles = new Map<string, { title: string; genre: string | null }>();
  if (ids.length > 0 && c.env.DB) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, article_title as title, genre FROM sessions WHERE id IN (${ids.map(() => "?").join(",")})`
    )
      .bind(...ids)
      .all<{ id: string; title: string; genre: string | null }>();
    for (const r of results) {
      titles.set(r.id, { title: r.title, genre: r.genre });
    }
  }

  return c.json({
    configured: true,
    report: {
      ...report,
      topDialogues: report.topDialogues.map((d) => ({
        ...d,
        title: titles.get(d.id)?.title ?? null,
        genre: titles.get(d.id)?.genre ?? null,
      })),
    },
    // 取得に失敗したクエリがあれば知らせる (全14件中)。データセットが空のうちは「テーブルがない」旨のエラーになる
    errors,
  });
});

export default app;
