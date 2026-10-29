import type { Persona } from "../../worker/types";

export type { Persona };

export interface Ogp {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
  type: string | null;
}

export interface SessionSummary {
  id: string;
  sourceUrl: string;
  normalizedUrl: string | null;
  articleTitle: string;
  articleSummary: string;
  summary: string | null;
  genre: string | null;
  ogp: Ogp | null;
  personaIds: string[];
  createdAt: string;
}

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  avatarUrl: string | null;
  themeColor: string;
}

/** 一覧用: ジャンルと参加ペルソナ付き */
export interface SessionListItem extends SessionSummary {
  genre: string;
  participants: Participant[];
}

export interface GenreCount {
  genre: string;
  count: number;
}

export interface PastMemory {
  sessionId: string;
  articleTitle: string;
  topicSummary: string;
  score: number;
}

export interface ChatMessage {
  turnIndex: number;
  personaId: string;
  name: string;
  role: string;
  avatar: string;
  avatarUrl: string | null;
  themeColor: string;
  content: string;
  streaming: boolean;
  referencedSessionId?: string | null;
  referencedArticleTitle?: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `リクエストに失敗しました (HTTP ${res.status})`, res.status);
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
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
