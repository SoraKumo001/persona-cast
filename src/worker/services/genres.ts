/** 絞り込みを安定させるため、ジャンルは固定リストから選ぶ (LLMの自由記述にしない) */
export const GENRES = [
  "プログラミング・開発",
  "AI・機械学習",
  "テクノロジー・ガジェット",
  "ビジネス・経済",
  "政治・社会",
  "サイエンス",
  "エンタメ・カルチャー",
  "ライフスタイル",
  "その他",
] as const;

export type Genre = (typeof GENRES)[number];

export const DEFAULT_GENRE: Genre = "その他";

export function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value);
}

const KEYWORDS: [Genre, RegExp][] = [
  [
    "AI・機械学習",
    /\b(ai|llm|gpt|claude|gemini|chatgpt|openai|anthropic|machine learning)\b|人工知能|機械学習|生成ai|大規模言語モデル|ディープラーニング/iu,
  ],
  [
    "プログラミング・開発",
    /\b(api|sdk|github|typescript|javascript|python|rust|react|docker|kubernetes|cloudflare|aws|database|framework|open ?source|programming|developer|devops|git)\b|プログラミング|エンジニア|開発者|ソースコード|フレームワーク|データベース/iu,
  ],
  [
    "テクノロジー・ガジェット",
    /\b(iphone|android|apple|google|microsoft|windows|gadget|smartphone|robot|semiconductor|5g|vr|ar)\b|スマホ|ガジェット|半導体|ロボット|デバイス/iu,
  ],
  [
    "ビジネス・経済",
    /\b(startup|business|market|stock|economy|revenue|marketing|investment|ipo)\b|ビジネス|経済|株価|市場|企業|スタートアップ|投資|決算|マーケティング|円安|金利/iu,
  ],
  [
    "政治・社会",
    /\b(election|government|policy|law|court|politics)\b|政治|選挙|政府|法律|法案|裁判|社会問題|外交|防衛/iu,
  ],
  [
    "サイエンス",
    /\b(science|research|physics|biology|space|nasa|climate|medicine)\b|科学|研究|宇宙|物理|生物|気候|医学|論文/iu,
  ],
  [
    "エンタメ・カルチャー",
    /\b(movie|film|music|anime|game|gaming|netflix|youtube|celebrity)\b|映画|音楽|アニメ(?!ーション)|ゲーム|漫画|芸能|ドラマ|小説|アート/iu,
  ],
  [
    "ライフスタイル",
    /\b(recipe|travel|health|fitness|fashion|lifestyle)\b|料理|旅行|健康|暮らし|ファッション|育児|グルメ|趣味/iu,
  ],
];

/** LLMが使えない/失敗したときのキーワードによる簡易分類 */
export function guessGenre(text: string): Genre {
  let best: { genre: Genre; hits: number } | null = null;
  for (const [genre, re] of KEYWORDS) {
    const hits = (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { genre, hits };
    }
  }
  return best?.genre ?? DEFAULT_GENRE;
}
