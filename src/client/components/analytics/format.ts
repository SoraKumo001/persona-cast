/** 金額は小さいので、有効数字を保って表示する (例: 0.0123 USD) */
export function money(value: number | null, currency: string): string {
  if (value === null) {
    return "—";
  }
  let digits = 4;
  if (value >= 100) {
    digits = 0;
  } else if (value >= 1) {
    digits = 2;
  }
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: digits })} ${currency}`;
}

export const nf = new Intl.NumberFormat("ja-JP");
export const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Analytics Engine の時刻 (UTC, "YYYY-MM-DD HH:MM:SS") を日本時間のラベルにする */
export function bucketLabel(t: string, bucket: "HOUR" | "DAY"): string {
  const d = new Date(`${t.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) {
    return t;
  }
  return bucket === "HOUR"
    ? d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric" }).replace(/\s/gu, "")
    : d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}
