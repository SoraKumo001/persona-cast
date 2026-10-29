import { normalizeUrl } from "./services/url-normalize";
import type { Persona } from "./types";

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "ken",
    name: "ケン (Ken)",
    role: "辛口シニアエンジニア",
    avatar: "💻",
    themeColor: "#2563eb",
    personality:
      "技術的な実現可能性、アーキテクチャの堅牢性、保守性、技術的負債に厳しい。流行りのバズワードに安易に乗っかることを嫌い、裏側の仕組みやトレードオフ、運用コストを鋭く突く。だが本質的に良い技術や誠実な設計には敬意を払う。",
    speakingStyle:
      "一人称は「俺」。「〜じゃないか？」「理屈はわかるが、実際運用で詰むぞ」「要するに〜ってことだな」といったぶっきらぼうだが理路整然としたエンジニア口調。",
  },
  {
    id: "yuki",
    name: "ユキ (Yuki)",
    role: "ビジョナリーPM / 起業家",
    avatar: "🚀",
    themeColor: "#10b981",
    personality:
      "ユーザー体験の向上、ビジネスインパクト、スピード感、未来の可能性にワクワクする楽観派。技術的な細部よりも「これで誰のどんな課題が解決できるか」「世の中がどう面白くなるか」を重視し、新しい試みを積極的に肯定する。",
    speakingStyle:
      "一人称は「私」。「すごくワクワクしますね！」「でもユーザー目線で見ると〜じゃないですか？」「まずは小さく試してみる価値ありそうです！」といったエネルギッシュで前向きな口調。",
  },
  {
    id: "ren",
    name: "レン (Ren)",
    role: "慎重派リサーチャー / 倫理アナリスト",
    avatar: "🧐",
    themeColor: "#8b5cf6",
    personality:
      "データの裏付け、公平性、セキュリティ、法規制やプライバシーリスクを多角的に分析する論理派。熱狂に流されず、見落とされがちな副作用やエッジケース、過去の失敗事例を引き合いに出して議論に深みをもたらす。",
    speakingStyle:
      "一人称は「僕」。「興味深いですね。ただ、懸念点として〜」「前提となるデータを確認する必要がありますね」「一見良さそうですが、リスク面はどうでしょう」といった丁寧で冷静沈着な敬体。",
  },
];

let tablesInitialized = false;

/**
 * データベースのテーブルが存在しない場合、各テーブルを自動作成して初期データを投入する
 */
export async function ensureDatabaseTables(db: D1Database): Promise<void> {
  if (tablesInitialized) {
    return;
  }

  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, avatar TEXT NOT NULL, theme_color TEXT NOT NULL DEFAULT '#3b82f6', personality TEXT NOT NULL, speaking_style TEXT NOT NULL, created_at TEXT NOT NULL)"
      )
      .run();

    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source_url TEXT NOT NULL, article_title TEXT NOT NULL, article_summary TEXT NOT NULL, persona_ids TEXT NOT NULL, created_at TEXT NOT NULL)"
      )
      .run();

    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, persona_id TEXT NOT NULL REFERENCES personas(id), turn_index INTEGER NOT NULL, content TEXT NOT NULL, referenced_session_id TEXT, referenced_article_title TEXT, created_at TEXT NOT NULL)"
      )
      .run();

    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS memory_chunks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, article_title TEXT NOT NULL, source_url TEXT NOT NULL, topic_summary TEXT NOT NULL, key_quotes TEXT NOT NULL, persona_ids TEXT NOT NULL, embedding_json TEXT, created_at TEXT NOT NULL)"
      )
      .run();

    // migrations/0002 相当の列を追加 (未適用のDB向け。既にあればスキップ)
    await addColumnIfMissing(db, "personas", "avatar_type", "TEXT NOT NULL DEFAULT 'emoji'");
    await addColumnIfMissing(db, "personas", "avatar_key", "TEXT");
    await addColumnIfMissing(db, "personas", "updated_at", "TEXT");
    await addColumnIfMissing(db, "personas", "archived_at", "TEXT");
    await addColumnIfMissing(db, "sessions", "normalized_url", "TEXT");
    await addColumnIfMissing(db, "sessions", "og_json", "TEXT");
    await addColumnIfMissing(db, "sessions", "summary", "TEXT");
    await addColumnIfMissing(db, "memory_chunks", "normalized_url", "TEXT");
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_normalized_url ON sessions(normalized_url)").run();

    // migrations/0003 相当
    await addColumnIfMissing(db, "sessions", "genre", "TEXT");
    await db.prepare("UPDATE sessions SET genre = 'その他' WHERE genre IS NULL").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_genre ON sessions(genre)").run();

    // migrations/0004 相当
    await addColumnIfMissing(db, "sessions", "generating_at", "TEXT");
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
      )
      .run();

    await db.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();

    // 正規化URL未設定の既存セッションをバックフィル
    const { results: unnormalized } = await db
      .prepare("SELECT id, source_url FROM sessions WHERE normalized_url IS NULL")
      .all<{ id: string; source_url: string }>();
    for (const row of unnormalized) {
      try {
        await db
          .prepare("UPDATE sessions SET normalized_url = ? WHERE id = ?")
          .bind(normalizeUrl(row.source_url), row.id)
          .run();
      } catch {
        // 不正なURLは未設定のまま残す
      }
    }

    // 初期ペルソナが空ならシード
    const countRow = await db.prepare("SELECT count(*) as count FROM personas").first<{ count: number }>();
    if (!countRow || countRow.count === 0) {
      const now = new Date().toISOString();
      for (const p of DEFAULT_PERSONAS) {
        await db
          .prepare(
            "INSERT OR IGNORE INTO personas (id, name, role, avatar, theme_color, personality, speaking_style, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(p.id, p.name, p.role, p.avatar, p.themeColor, p.personality, p.speakingStyle, now)
          .run();
      }
    }

    tablesInitialized = true;
  } catch (err) {
    console.warn("ensureDatabaseTables warning:", err);
  }
}

async function addColumnIfMissing(db: D1Database, table: string, column: string, ddl: string) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (results.some((r) => r.name === column)) {
    return;
  }
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
}
