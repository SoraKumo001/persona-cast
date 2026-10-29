export interface Env {
  DB: D1Database;
  AI?: any; // Cloudflare Workers AI binding
  VECTORIZE?: any; // Cloudflare Vectorize binding
  ASSETS: Fetcher; // Static assets fetcher in Cloudflare Workers
  AVATARS?: R2Bucket; // ペルソナのアバター画像
  ANALYTICS?: AnalyticsEngineDataset; // アクセス状況の記録 (Workers Analytics Engine)
  ANALYTICS_SALT?: string; // 訪問者ハッシュのソルト (未設定なら固定値)
  CF_ACCOUNT_ID?: string; // アクセス状況の集計 (Analytics Engine SQL API) に使う
  CF_API_TOKEN?: string; // 権限は「アカウント > Account Analytics > 読み取り」だけにする
  WEB_ANALYTICS_TOKEN?: string; // Cloudflare Web Analytics のビーコンのトークン (空なら出さない)
  ACCESS_TEAM_DOMAIN?: string; // 例: your-team.cloudflareaccess.com
  ACCESS_AUD?: string; // Cloudflare Access アプリケーションの AUD タグ
  ACCESS_DISABLED?: string; // "true" かつ localhost のときのみ検証をスキップ (開発用)
  OPENCODE_API_KEY?: string;
  OPENCODE_BASE_URL?: string;
  OPENCODE_DEFAULT_MODEL?: string;
  EMBEDDING_MODEL?: string;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  avatar: string; // 絵文字（avatarType が image のときはフォールバック）
  avatarType?: "emoji" | "image";
  avatarUrl?: string | null; // 画像アバターの配信URL (avatarType === "image")
  themeColor: string; // TailwindカラークラスやHEX
  personality: string; // 性格・価値観プロンプト
  speakingStyle: string; // 口調・一人称・語尾
  createdAt?: string;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface DialogueSession {
  id: string;
  sourceUrl: string;
  articleTitle: string;
  articleSummary: string;
  personaIds: string[]; // JSON文字列で保存
  createdAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  personaId: string;
  turnIndex: number;
  content: string;
  referencedSessionId?: string | null;
  referencedArticleTitle?: string | null;
  createdAt: string;
}

export interface MemoryChunk {
  id: string;
  sessionId: string;
  articleTitle: string;
  sourceUrl: string;
  topicSummary: string;
  keyQuotes: string;
  personaIds: string[];
  embeddingJson?: string | null;
  createdAt: string;
}
