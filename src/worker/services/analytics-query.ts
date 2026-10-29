/**
 * アクセス状況の集計 (Analytics Engine の SQL API)。
 * SQL はすべて固定のテンプレートで、利用者の入力は期間 (許可リストのキー) だけ。
 * 値を SQL に埋め込まないので、SQL インジェクションの余地がない。
 * 列の意味は analytics-track.ts の先頭コメントを参照。
 */
import { Env } from "../types";
import { DATASET } from "./analytics-track";

export type RangeKey = "24h" | "7d" | "30d";

interface RangeSpec {
  /** INTERVAL '{amount}' {unit} で何時間/何日前までを集計するか */
  amount: number;
  unit: "HOUR" | "DAY";
  /** グラフの1本が表す時間 */
  bucket: "HOUR" | "DAY";
}

export const RANGES: Record<RangeKey, RangeSpec> = {
  "24h": { amount: 24, unit: "HOUR", bucket: "HOUR" },
  "7d": { amount: 7, unit: "DAY", bucket: "DAY" },
  "30d": { amount: 30, unit: "DAY", bucket: "DAY" },
};

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RANGES, value);
}

export type QueryName =
  | "totals"
  | "bots"
  | "series"
  | "topDialogues"
  | "topPages"
  | "referrers"
  | "countries"
  | "devices"
  | "status"
  | "cache"
  | "latency"
  | "events"
  | "llm"
  | "limited";

/** 人が見るページビューの条件 (ボットと、エラー応答を除く) */
const HUMAN_PV = "blob1 = 'pv' AND blob7 != 'bot' AND double1 < 400";

export function buildQueries(range: RangeKey, dataset: string = DATASET): Record<QueryName, string> {
  const r = RANGES[range];
  const since = `timestamp > NOW() - INTERVAL '${r.amount}' ${r.unit}`;
  const from = `FROM ${dataset}`;
  const sampled = "SUM(_sample_interval)";

  return {
    totals: `SELECT ${sampled} AS pageviews, COUNT(DISTINCT blob8) AS visitors ${from} WHERE ${HUMAN_PV} AND ${since}`,
    bots: `SELECT ${sampled} AS pageviews ${from} WHERE blob1 = 'pv' AND blob7 = 'bot' AND ${since}`,
    series: `SELECT toStartOfInterval(timestamp, INTERVAL '1' ${r.bucket}) AS t, ${sampled} AS pageviews, COUNT(DISTINCT blob8) AS visitors ${from} WHERE ${HUMAN_PV} AND ${since} GROUP BY t ORDER BY t`,
    topDialogues: `SELECT blob3 AS id, ${sampled} AS count ${from} WHERE ${HUMAN_PV} AND blob2 = '/s/:id' AND ${since} GROUP BY id ORDER BY count DESC LIMIT 10`,
    topPages: `SELECT blob2 AS route, ${sampled} AS count ${from} WHERE ${HUMAN_PV} AND ${since} GROUP BY route ORDER BY count DESC LIMIT 10`,
    referrers: `SELECT blob6 AS host, ${sampled} AS count ${from} WHERE ${HUMAN_PV} AND blob6 != '' AND ${since} GROUP BY host ORDER BY count DESC LIMIT 10`,
    countries: `SELECT blob5 AS country, ${sampled} AS count ${from} WHERE ${HUMAN_PV} AND blob5 != '' AND ${since} GROUP BY country ORDER BY count DESC LIMIT 10`,
    devices: `SELECT blob7 AS device, ${sampled} AS count ${from} WHERE blob1 = 'pv' AND double1 < 400 AND ${since} GROUP BY device ORDER BY count DESC`,
    status: `SELECT intDiv(double1, 100) AS cls, ${sampled} AS count ${from} WHERE blob1 IN ('pv', 'api') AND ${since} GROUP BY cls ORDER BY cls`,
    cache: `SELECT blob4 AS cache, ${sampled} AS count ${from} WHERE blob1 IN ('pv', 'api') AND ${since} GROUP BY cache`,
    // 生成のストリーム (長時間つながる) は応答時間の対象外にする
    latency: `SELECT quantileWeighted(0.5)(double2, _sample_interval) AS p50, quantileWeighted(0.95)(double2, _sample_interval) AS p95 ${from} WHERE blob1 IN ('pv', 'api') AND blob2 != '/api/sessions/:id/stream' AND ${since}`,
    events: `SELECT blob3 AS name, ${sampled} AS count ${from} WHERE blob1 = 'event' AND blob3 != 'llm_usage' AND ${since} GROUP BY name ORDER BY count DESC`,
    llm: `SELECT SUM(double3 * _sample_interval) AS input, SUM(double4 * _sample_interval) AS cached, ${sampled} AS calls ${from} WHERE blob1 = 'event' AND blob3 = 'llm_usage' AND ${since}`,
    limited: `SELECT blob2 AS route, ${sampled} AS count ${from} WHERE blob1 IN ('pv', 'api') AND double1 = 429 AND ${since} GROUP BY route ORDER BY count DESC`,
  };
}

export type Row = Record<string, unknown>;

/** Analytics Engine は数値を文字列で返すことがある */
export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export interface AnalyticsReport {
  range: RangeKey;
  bucket: "HOUR" | "DAY";
  totals: { pageviews: number; visitors: number; botPageviews: number };
  series: { t: string; pageviews: number; visitors: number }[];
  topDialogues: { id: string; count: number }[];
  topPages: { route: string; count: number }[];
  referrers: { host: string; count: number }[];
  countries: { country: string; count: number }[];
  devices: { device: string; count: number }[];
  status: { cls: string; count: number }[];
  cache: { hit: number; miss: number; none: number; hitRate: number | null };
  latency: { p50: number; p95: number } | null;
  events: { name: string; count: number }[];
  llm: { calls: number; inputTokens: number; cachedTokens: number; cacheRate: number | null };
  limited: { route: string; count: number }[];
}

/** SQL の結果 (行の配列) を、画面に渡す形にそろえる。取れなかった項目は空として扱う */
export function buildReport(range: RangeKey, rows: Partial<Record<QueryName, Row[]>>): AnalyticsReport {
  const first = (name: QueryName): Row => rows[name]?.[0] ?? {};
  const list = (name: QueryName): Row[] => rows[name] ?? [];

  const cacheCounts = { HIT: 0, MISS: 0, NONE: 0 } as Record<string, number>;
  for (const r of list("cache")) cacheCounts[String(r.cache)] = num(r.count);
  const cacheable = cacheCounts.HIT + cacheCounts.MISS;

  const llm = first("llm");
  const input = num(llm.input);
  const cached = num(llm.cached);
  const latency = first("latency");

  return {
    range,
    bucket: RANGES[range].bucket,
    totals: {
      pageviews: num(first("totals").pageviews),
      visitors: num(first("totals").visitors),
      botPageviews: num(first("bots").pageviews),
    },
    series: list("series").map((r) => ({ t: String(r.t), pageviews: num(r.pageviews), visitors: num(r.visitors) })),
    topDialogues: list("topDialogues").map((r) => ({ id: String(r.id), count: num(r.count) })),
    topPages: list("topPages").map((r) => ({ route: String(r.route), count: num(r.count) })),
    referrers: list("referrers").map((r) => ({ host: String(r.host), count: num(r.count) })),
    countries: list("countries").map((r) => ({ country: String(r.country), count: num(r.count) })),
    devices: list("devices").map((r) => ({ device: String(r.device), count: num(r.count) })),
    status: list("status").map((r) => ({ cls: `${num(r.cls)}xx`, count: num(r.count) })),
    cache: {
      hit: cacheCounts.HIT,
      miss: cacheCounts.MISS,
      none: cacheCounts.NONE,
      hitRate: cacheable > 0 ? cacheCounts.HIT / cacheable : null,
    },
    latency: rows.latency && rows.latency.length > 0 ? { p50: Math.round(num(latency.p50)), p95: Math.round(num(latency.p95)) } : null,
    events: list("events").map((r) => ({ name: String(r.name), count: num(r.count) })),
    llm: { calls: num(llm.calls), inputTokens: input, cachedTokens: cached, cacheRate: input > 0 ? cached / input : null },
    limited: list("limited").map((r) => ({ route: String(r.route), count: num(r.count) })),
  };
}

export function isAnalyticsConfigured(env: Env): boolean {
  return !!env.CF_ACCOUNT_ID && !!env.CF_API_TOKEN;
}

/** Analytics Engine の SQL API を呼ぶ */
export async function runSql(env: Env, sql: string): Promise<Row[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "text/plain" },
    body: sql,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Analytics SQL API ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { data?: Row[] };
  return json.data ?? [];
}

/** 全クエリを並列に実行して集計する。一部が失敗しても、取れたものは返す */
export async function fetchReport(env: Env, range: RangeKey): Promise<{ report: AnalyticsReport; errors: string[] }> {
  const queries = buildQueries(range);
  const names = Object.keys(queries) as QueryName[];
  const settled = await Promise.allSettled(names.map((n) => runSql(env, queries[n])));

  const rows: Partial<Record<QueryName, Row[]>> = {};
  const errors: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") rows[names[i]] = s.value;
    else errors.push(`${names[i]}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
  });
  return { report: buildReport(range, rows), errors };
}
