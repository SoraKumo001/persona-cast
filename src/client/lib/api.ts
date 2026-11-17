import type { CreateSessionStep } from "../../worker/routes/sessions-list";

export type { CreateSessionStep } from "../../worker/routes/sessions-list";
export type { Persona } from "../../worker/types";

export interface Ogp {
  description: string | null;
  favicon: string | null;
  image: string | null;
  siteName: string | null;
  title: string | null;
  type: string | null;
}

export type SessionMode = "article" | "debate" | "heated";

export interface SessionSummary {
  articleSummary: string;
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  id: string;
  /** 無い古い応答は article 扱い */
  mode?: SessionMode;
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

function unwrap<T>(data: { error?: string }, status: number): T {
  if (status < 200 || status >= 300) {
    throw new ApiError(data.error ?? `リクエストに失敗しました (HTTP ${status})`, status);
  }
  return data as T;
}

async function readJson<T>(res: Response): Promise<T> {
  return unwrap<T>((await res.json().catch(() => ({}))) as { error?: string }, res.status);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return readJson<T>(await fetch(path, init));
}

const NDJSON = "application/x-ndjson";

type ProgressLine =
  | { step: CreateSessionStep; type: "progress" }
  | { body: { error?: string }; status: number; type: "result" };

export type CreateSessionInput =
  | { url: string; theme?: never; heated?: never }
  | { theme: string; url?: never; heated?: boolean };

/**
 * 対談の作成。サーバーが進めるたびに onProgress を呼び、最後の結果を返す。
 * 入力エラーや既存の対談など、すぐ決まる応答は通常の JSON で返ってくるので両方を扱う。
 */
export async function createSessionWithProgress<T>(
  input: CreateSessionInput | string,
  onProgress: (step: CreateSessionStep) => void
): Promise<T> {
  const body: CreateSessionInput = typeof input === "string" ? { url: input } : input;
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: `${NDJSON}, application/json` },
    body: JSON.stringify(body),
  });
  if (!(res.headers.get("content-type")?.includes(NDJSON) && res.body)) {
    return readJson<T>(res);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    // 最後の要素は行の途中かもしれないので次回に回す
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines.filter((l) => l.trim())) {
      const parsed = JSON.parse(line) as ProgressLine;
      if (parsed.type === "result") {
        return unwrap<T>(parsed.body, parsed.status);
      }
      onProgress(parsed.step);
    }
    if (done) {
      throw new ApiError("接続が切れました。もう一度お試しください。", 502);
    }
  }
}

/** theme:// の合成URLかどうか (論戦セッション) */
export function isThemeSourceUrl(url: string): boolean {
  return url.startsWith("theme://");
}

/** heated:// の合成URLかどうか (激論セッション) */
export function isHeatedSourceUrl(url: string): boolean {
  return url.startsWith("heated://");
}

/** テーマ調査ベース (論戦・激論) かどうか */
export function isThemeBasedSourceUrl(url: string): boolean {
  return isThemeSourceUrl(url) || isHeatedSourceUrl(url);
}

export function postJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function hostOf(url: string): string {
  if (isHeatedSourceUrl(url)) {
    return "激論";
  }
  if (isThemeSourceUrl(url)) {
    return "テーマ論戦";
  }
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
