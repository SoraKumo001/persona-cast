export type RangeKey = "24h" | "7d" | "30d";
export const RANGE_LABELS: Record<RangeKey, string> = { "24h": "24時間", "7d": "7日間", "30d": "30日間" };

export interface Count {
  count: number;
}
export interface Report {
  bucket: "HOUR" | "DAY";
  cache: { hit: number; miss: number; none: number; hitRate: number | null };
  countries: (Count & { country: string })[];
  devices: (Count & { device: string })[];
  events: (Count & { name: string })[];
  latency: { p50: number; p95: number } | null;
  limited: (Count & { route: string })[];
  llm: {
    cacheRate: number | null;
    cachedTokens: number;
    calls: number;
    dialogues: number;
    inputTokens: number;
    outputTokens: number;
    tokensPerDialogue: number | null;
  };
  range: RangeKey;
  referrers: (Count & { host: string })[];
  series: { t: string; pageviews: number; visitors: number }[];
  status: (Count & { cls: string })[];
  topDialogues: (Count & { id: string; title: string | null; genre: string | null })[];
  topPages: (Count & { route: string })[];
  totals: { pageviews: number; visitors: number; botPageviews: number };
}
export interface Cost {
  atDailyLimit: number | null;
  currency: string;
  perDialogue: number | null;
  total: number;
}
export type AnalyticsResponse =
  | { configured: false; hasDataset: boolean }
  | { configured: true; report: Report; errors: string[]; cost: Cost | null };

export const EVENT_LABELS: Record<string, string> = {
  dialogue_created: "新しく作られた対談",
  adult_blocked: "18禁として断った送信",
  daily_limit_reached: "1日の上限で断った送信",
};
export const DEVICE_LABELS: Record<string, string> = {
  pc: "PC",
  mobile: "スマートフォン",
  tablet: "タブレット",
  bot: "ボット",
};
export const ROUTE_LABELS: Record<string, string> = {
  "/": "トップ",
  "/memories": "記憶検索",
  "/s/:id": "対談ページ",
  other: "その他のパス",
};
