-- Create personas table
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar TEXT NOT NULL,
  theme_color TEXT NOT NULL DEFAULT '#3b82f6',
  personality TEXT NOT NULL,
  speaking_style TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_summary TEXT NOT NULL,
  persona_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES personas(id),
  turn_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  referenced_session_id TEXT,
  referenced_article_title TEXT,
  created_at TEXT NOT NULL
);

-- Create memory_chunks table
CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  article_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  topic_summary TEXT NOT NULL,
  key_quotes TEXT NOT NULL,
  persona_ids TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL
);

-- Seed default personas
INSERT OR IGNORE INTO personas (id, name, role, avatar, theme_color, personality, speaking_style, created_at)
VALUES
(
  'ken',
  'ケン (Ken)',
  '辛口シニアエンジニア',
  '💻',
  '#2563eb',
  '技術的な実現可能性、アーキテクチャの堅牢性、保守性、技術的負債に厳しい。流行りのバズワードに安易に乗っかることを嫌い、裏側の仕組みやトレードオフ、運用コストを鋭く突く。だが本質的に良い技術や誠実な設計には敬意を払う。',
  '一人称は「俺」。「〜じゃないか？」「理屈はわかるが、実際運用で詰むぞ」「要するに〜ってことだな」といったぶっきらぼうだが理路整然としたエンジニア口調。',
  datetime('now')
),
(
  'yuki',
  'ユキ (Yuki)',
  'ビジョナリーPM / 起業家',
  '🚀',
  '#10b981',
  'ユーザー体験の向上、ビジネスインパクト、スピード感、未来の可能性にワクワクする楽観派。技術的な細部よりも「これで誰のどんな課題が解決できるか」「世の中がどう面白くなるか」を重視し、新しい試みを積極的に肯定する。',
  '一人称は「私」。「すごくワクワクしますね！」「でもユーザー目線で見ると〜じゃないですか？」「まずは小さく試してみる価値ありそうです！」といったエネルギッシュで前向きな口調。',
  datetime('now')
),
(
  'ren',
  'レン (Ren)',
  '慎重派リサーチャー / 倫理アナリスト',
  '🧐',
  '#8b5cf6',
  'データの裏付け、公平性、セキュリティ、法規制やプライバシーリスクを多角的に分析する論理派。熱狂に流されず、見落とされがちな副作用やエッジケース、過去の失敗事例を引き合いに出して議論に深みをもたらす。',
  '一人称は「僕」。「興味深いですね。ただ、懸念点として〜」「前提となるデータを確認する必要がありますね」「一見良さそうですが、リスク面はどうでしょう」といった丁寧で冷静沈着な敬体。',
  datetime('now')
);
