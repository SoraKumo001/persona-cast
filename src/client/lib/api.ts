export type { Persona } from "../../worker/types";

export interface Ogp {
  description: string | null;
  favicon: string | null;
  image: string | null;
  siteName: string | null;
  title: string | null;
  type: string | null;
}

export interface SessionSummary {
  articleSummary: string;
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  id: string;
  normalizedUrl: string | null;
  ogp: Ogp | null;
  personaIds: string[];
  sourceUrl: string;
  summary: string | null;
}

export interface Participant {
  avatar: string;
  avatarUrl: string | null;
  id: string;
  name: string;
  themeColor: string;
}

/** 一覧用: ジャンルと参加ペルソナ付き */
export interface SessionListItem extends SessionSummary {
  genre: string;
  participants: Participant[];
}

export interface GenreCount {
  count: number;
  genre: string;
}

export interface PastMemory {
  articleTitle: string;
  score: number;
  sessionId: string;
  topicSummary: string;
}

export interface ChatMessage {
  avatar: string;
  avatarUrl: string | null;
  content: string;
  name: string;
  personaId: string;
  referencedArticleTitle?: string | null;
  referencedSessionId?: string | null;
  role: string;
  streaming: boolean;
  themeColor: string;
  turnIndex: number;
}

/** catch した値 (unknown) からメッセージを取り出す */
export function errorMessage(err: unknown, fallback = "不明なエラーが発生しました"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(data.error ?? `リクエストに失敗しました (HTTP ${res.status})`, res.status);
  }
  return data as T;
}

export function postJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** 年つきの日時 (対談ページの生成時刻用)。サーバーとブラウザで同じ表示になるよう JST に固定する */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
