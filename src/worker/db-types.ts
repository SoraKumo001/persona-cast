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
