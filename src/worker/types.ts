export interface Env {
  DB: D1Database;
  AI?: any; // Cloudflare Workers AI binding
  VECTORIZE?: any; // Cloudflare Vectorize binding
  ASSETS: Fetcher; // Static assets fetcher in Cloudflare Workers
  OPENCODE_API_KEY?: string;
  OPENCODE_BASE_URL?: string;
  OPENCODE_DEFAULT_MODEL?: string;
  EMBEDDING_MODEL?: string;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  avatar: string; // 絵文字またはアバターコード
  themeColor: string; // TailwindカラークラスやHEX
  personality: string; // 性格・価値観プロンプト
  speakingStyle: string; // 口調・一人称・語尾
  createdAt?: string;
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
