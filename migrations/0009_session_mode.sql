-- 対談の入力種別。article = 記事URL、debate = テーマ論戦
ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'article';
