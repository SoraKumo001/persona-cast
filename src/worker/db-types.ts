/** D1 から読む行の型 (SQL の `as` で付けた別名と対応する) */

export interface PersonaRow {
  archivedAt: string | null;
  avatar: string;
  avatarKey: string | null;
  avatarType: string | null;
  createdAt?: string;
  id: string;
  name: string;
  personality: string;
  role: string;
  speakingStyle: string;
  themeColor: string;
  updatedAt: string | null;
}

/** sessions を列名そのまま (別名なし) で読むときの行 */
export interface DialogueSessionRow {
  article_summary: string;
  article_title: string;
  created_at: string;
  id: string;
  persona_ids: string;
  source_url: string;
}

/** 非表示の対談も探せるように、hidden_at を足した行 */
export interface ExistingSessionRow extends SessionRow {
  hiddenAt: string | null;
}

/** memory_chunks を列名そのまま (別名なし) で読むときの行 */
export interface MemoryChunkDbRow {
  article_title: string;
  created_at: string;
  embedding_json: string | null;
  id: string;
  key_quotes: string;
  persona_ids: string;
  session_id: string;
  source_url: string;
  topic_summary: string;
}

export interface SessionRow {
  articleSummary: string;
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  id: string;
  normalizedUrl: string | null;
  ogJson: string | null;
  personaIds: string;
  sourceUrl: string;
  summary: string | null;
}

export interface MessageRow {
  content: string;
  createdAt: string;
  id: string;
  personaAvatar: string | null;
  personaAvatarKey: string | null;
  personaAvatarType: string | null;
  personaId: string;
  personaName: string | null;
  personaRole: string | null;
  personaThemeColor: string | null;
  referencedArticleTitle: string | null;
  referencedSessionId: string | null;
  sessionId: string;
  turnIndex: number;
}
