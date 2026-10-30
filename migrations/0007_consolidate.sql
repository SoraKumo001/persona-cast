-- Add missing indexes and backfill the genre that 0003 missed.
-- Idempotent statements only, so this can reapply to DBs already initialized by presets.ts / 0001-0006. No ALTER.

-- Look up session_id for lists, detail views, and memory search.
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_session_id ON memory_chunks(session_id);

-- Sorting for lists and filtering for hidden sessions.
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_hidden_at ON sessions(hidden_at);

-- Cleanup of expired rate limits.
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at);

-- Set genre of existing sessions with no genre to the "other" label (same as 0003).
UPDATE sessions SET genre = 'その他' WHERE genre IS NULL;
