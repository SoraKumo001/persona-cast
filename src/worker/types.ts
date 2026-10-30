/** Workers AI のうち、使っている部分だけの型 (埋め込みの生成) */
export interface AiBinding {
  run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }>;
}

export interface VectorizeMatch {
  id: string;
  metadata?: Record<string, string | undefined>;
  score: number;
}

/** Vectorize のうち、使っている部分だけの型 (類似検索と登録) */
export interface VectorizeBinding {
  deleteByIds: (ids: string[]) => Promise<unknown>;
  query: (
    vector: number[],
    options: { topK: number; returnMetadata?: "all" | "indexed" | "none" }
  ) => Promise<{ matches?: VectorizeMatch[] }>;
  upsert: (vectors: { id: string; metadata?: Record<string, string>; values: number[] }[]) => Promise<unknown>;
}

export interface Env {
  ACCESS_AUD?: string; // Cloudflare Access アプリケーションの AUD タグ
  ACCESS_DISABLED?: string; // "true" かつ localhost のときのみ検証をスキップ (開発用)
  ACCESS_TEAM_DOMAIN?: string; // 例: your-team.cloudflareaccess.com
  AI?: AiBinding; // Cloudflare Workers AI binding
  ANALYTICS?: AnalyticsEngineDataset; // アクセス状況の記録 (Workers Analytics Engine)
  ANALYTICS_SALT?: string; // 訪問者ハッシュのソルト (未設定なら固定値)
  ASSETS: Fetcher; // Static assets fetcher in Cloudflare Workers
  AVATARS?: R2Bucket; // ペルソナのアバター画像
  CF_ACCOUNT_ID?: string; // アクセス状況の集計 (Analytics Engine SQL API) に使う
  CF_API_TOKEN?: string; // 権限は「アカウント > Account Analytics > 読み取り」だけにする
  DB: D1Database;
  EMBEDDING_MODEL?: string;
  LLM_PRICE_CACHED?: string; // 費用の試算に使う単価 (100万トークンあたり)。キャッシュ済みの入力。空なら入力と同じ
  LLM_PRICE_CURRENCY?: string; // 単価の通貨の表示 (既定 USD)
  LLM_PRICE_INPUT?: string; // 入力の単価。入力と出力の両方が設定されたときだけ、費用を表示する
  LLM_PRICE_OUTPUT?: string; // 出力の単価
  OPENCODE_API_KEY?: string;
  OPENCODE_BASE_URL?: string;
  OPENCODE_DEFAULT_MODEL?: string;
  STANCE_PILOT?: string; // "off" で対談前の立場生成 (Phase 1) を止める。A/B比較用
  VECTORIZE?: VectorizeBinding; // Cloudflare Vectorize binding
  WEB_ANALYTICS_TOKEN?: string; // Cloudflare Web Analytics のビーコンのトークン (空なら出さない)
}

export interface Persona {
  archivedAt?: string | null;
  avatar: string; // 絵文字（avatarType が image のときはフォールバック）
  avatarType?: "emoji" | "image";
  avatarUrl?: string | null; // 画像アバターの配信URL (avatarType === "image")
  createdAt?: string;
  id: string;
  name: string;
  personality: string; // 性格・価値観プロンプト
  role: string;
  speakingStyle: string; // 口調・一人称・語尾
  themeColor: string; // TailwindカラークラスやHEX
  updatedAt?: string | null;
}

export interface DialogueSession {
  articleSummary: string;
  articleTitle: string;
  createdAt: string;
  id: string;
  personaIds: string[]; // JSON文字列で保存
  sourceUrl: string;
}

export interface Message {
  content: string;
  createdAt: string;
  id: string;
  personaId: string;
  referencedArticleTitle?: string | null;
  referencedSessionId?: string | null;
  sessionId: string;
  turnIndex: number;
}

export interface MemoryChunk {
  articleTitle: string;
  createdAt: string;
  embeddingJson?: string | null;
  id: string;
  keyQuotes: string;
  personaIds: string[];
  sessionId: string;
  sourceUrl: string;
  topicSummary: string;
}
