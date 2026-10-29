-- ペルソナ: 画像アバター(R2)・論理削除
ALTER TABLE personas ADD COLUMN avatar_type TEXT NOT NULL DEFAULT 'emoji';
ALTER TABLE personas ADD COLUMN avatar_key TEXT;
ALTER TABLE personas ADD COLUMN updated_at TEXT;
ALTER TABLE personas ADD COLUMN archived_at TEXT;

-- セッション: 正規化URL・OGP・短い要約
ALTER TABLE sessions ADD COLUMN normalized_url TEXT;
ALTER TABLE sessions ADD COLUMN og_json TEXT;
ALTER TABLE sessions ADD COLUMN summary TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_normalized_url ON sessions(normalized_url);

-- 記憶: 同一ページの自己参照を避けるための正規化URL
ALTER TABLE memory_chunks ADD COLUMN normalized_url TEXT;
