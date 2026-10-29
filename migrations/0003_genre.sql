-- セッション: ジャンル (一覧のフィルター用)。既存の対談は「その他」にする
ALTER TABLE sessions ADD COLUMN genre TEXT;
UPDATE sessions SET genre = 'その他' WHERE genre IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_genre ON sessions(genre);
