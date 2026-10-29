import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const personas = sqliteTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  avatar: text("avatar").notNull(),
  themeColor: text("theme_color").notNull().default("#3b82f6"),
  personality: text("personality").notNull(),
  speakingStyle: text("speaking_style").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  articleTitle: text("article_title").notNull(),
  articleSummary: text("article_summary").notNull(),
  personaIds: text("persona_ids").notNull(), // JSON array string
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  personaId: text("persona_id").notNull().references(() => personas.id),
  turnIndex: integer("turn_index").notNull(),
  content: text("content").notNull(),
  referencedSessionId: text("referenced_session_id"),
  referencedArticleTitle: text("referenced_article_title"),
  createdAt: text("created_at").notNull(),
});

export const memoryChunks = sqliteTable("memory_chunks", {
  id: text("id").primaryKey(), // VectorizeのIDと一致
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  articleTitle: text("article_title").notNull(),
  sourceUrl: text("source_url").notNull(),
  topicSummary: text("topic_summary").notNull(),
  keyQuotes: text("key_quotes").notNull(),
  personaIds: text("persona_ids").notNull(), // JSON array string
  embeddingJson: text("embedding_json"), // ローカル検索・フォールバック用
  createdAt: text("created_at").notNull(),
});
