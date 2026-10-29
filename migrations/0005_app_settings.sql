-- 管理者が変更できる設定 (1日の対談数の上限など)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
