/** 管理者が変更できる設定 (D1 の app_settings テーブル) */

export const DEFAULT_DAILY_LIMIT = 1000;
export const MAX_DAILY_LIMIT = 100_000;
const DAILY_LIMIT_KEY = "daily_dialogue_limit";

/** 1日に新しく作れる対談の総数。未設定なら既定値。0 は新規作成の停止 */
export async function getDailyLimit(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(DAILY_LIMIT_KEY)
    .first<{ value: string }>();
  const n = row ? Number.parseInt(row.value, 10) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

export async function setDailyLimit(db: D1Database, limit: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .bind(DAILY_LIMIT_KEY, String(limit))
    .run();
}

/** 日本時間の今日0時を、UTC の ISO 文字列で返す (created_at との比較用) */
export function jstDayStartIso(now: Date = new Date()): string {
  const JST_OFFSET_MS = 9 * 3600 * 1000;
  const startMs = Math.floor((now.getTime() + JST_OFFSET_MS) / 86_400_000) * 86_400_000 - JST_OFFSET_MS;
  return new Date(startMs).toISOString();
}

/** 日本時間の今日、新しく作られた対談の数 */
export async function countTodaySessions(db: D1Database, now: Date = new Date()): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM sessions WHERE created_at >= ?")
    .bind(jstDayStartIso(now))
    .first<{ count: number }>();
  return row?.count ?? 0;
}
