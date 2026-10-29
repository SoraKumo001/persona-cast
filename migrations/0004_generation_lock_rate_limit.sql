-- セッション: 対談の生成中を示す時刻 (同じ対談の二重生成を防ぐ)
ALTER TABLE sessions ADD COLUMN generating_at TEXT;

-- IPごとのレート制限 (固定ウィンドウのカウンタ)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
