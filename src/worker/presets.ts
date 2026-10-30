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

// モジュール状態はisolate単位でしか共有されないため、これは同一isolate内での重複シードを避ける最適化にすぎない。
let seedInitialized = false;

/**
 * 初期ペルソナが空ならシードする。
 *
 * テーブル作成・マイグレーションは migrations/ に移管済み。ここでは DDL を行わない。
 * リクエスト処理からの呼び出しは撤去済み (Step C)。初期データは `d1:migrate` 適用後に明示的にシードする前提。
 * 失敗時は warn に留め、呼び出し元の処理を止めない (fail-open)。
 */
export async function ensureDatabaseTables(db: D1Database): Promise<void> {
  if (seedInitialized) {
    return;
  }

  try {
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

    seedInitialized = true;
  } catch (err) {
    console.warn("ensureDatabaseTables warning:", err);
  }
}
