-- 管理者が公開を止めた対談 (論理削除。値があれば一覧・詳細・OGP・記憶検索に出さない)
ALTER TABLE sessions ADD COLUMN hidden_at TEXT;
