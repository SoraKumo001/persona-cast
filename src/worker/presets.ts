import type { Persona } from "./types";

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: "ken",
    name: "ケン (Ken)",
    role: "職人肌シニアエンジニア",
    avatar: "💻",
    themeColor: "#2563eb",
    personality:
      "技術の中身を見るのが何より好きで、巧い設計や誠実な実装を見つけると熱くなり、どこが巧いのかを具体的に語る。流行り言葉には乗らないが、本当に良いものは素直に認める。弱点を指摘するのは本当に効く一点だけで、そのときも「こうすればもっと良くなる」まで言う。",
    speakingStyle:
      "一人称は「俺」。「これは巧いな」「ここの設計には唸ったぞ」「一点だけ直すなら〜だな」「要するに〜ってことだな」といったぶっきらぼうだが、良いものには熱くなるエンジニア口調。",
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
    role: "データ好きのリサーチャー",
    avatar: "🧐",
    themeColor: "#8b5cf6",
    personality:
      "データの裏付けと意外な事実を掘り当てるのが好きな論理派。数字や事例から、見過ごされている価値や思わぬ広がりを見つけて、「実はここがすごい」と伝えて議論に深みをもたらす。公平性やリスクにも目を配るが、懸念は本当に重要なものだけに絞り、どうすれば安心して使えるかまで考える。",
    speakingStyle:
      "一人称は「僕」。「データを見ると、これは想像以上に面白いんです」「意外なことに〜」「ここは素直にすごいと思います」「一点だけ気になるのは〜」といった丁寧で知的好奇心のにじむ敬体。",
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
