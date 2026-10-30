import React from "react";
import type { ChatMessage, PastMemory, Persona, SessionSummary } from "../lib/api";
import type { SavedMessage, SessionDetail } from "../lib/session-detail";

export type Status = "loading" | "streaming" | "done" | "error";

function toChatMessage(p: Persona, turnIndex: number): ChatMessage {
  return {
    turnIndex,
    personaId: p.id,
    name: p.name,
    role: p.role,
    avatar: p.avatar,
    avatarUrl: p.avatarUrl ?? null,
    themeColor: p.themeColor,
    content: "",
    streaming: true,
  };
}

function initialStatus(hasSession: boolean, savedCount: number): Status {
  if (!hasSession) {
    return "error";
  }
  return savedCount > 0 ? "done" : "loading";
}

/** 対談詳細の SSE 消費と状態管理 (発言・参加者・思い出した過去の対談・生成状況) */
export function useSessionStream({ id, detail }: { id: string; detail: SessionDetail | null }) {
  const session = (detail?.session ?? null) as SessionSummary | null;
  const saved: SavedMessage[] = detail?.messages ?? [];
  const [participants, setParticipants] = React.useState<Persona[]>((detail?.participants ?? []) as Persona[]);
  // 保存済みの対談はそのまま表示する (再生成しない)
  const [messages, setMessages] = React.useState<ChatMessage[]>(() =>
    saved.map((m) => ({
      turnIndex: m.turnIndex,
      personaId: m.personaId,
      name: m.personaName || "ペルソナ",
      role: m.personaRole ?? "",
      avatar: m.personaAvatar || "🎙️",
      avatarUrl: m.personaAvatarUrl ?? null,
      themeColor: m.personaThemeColor || "#6366f1",
      content: m.content,
      streaming: false,
      referencedSessionId: m.referencedSessionId,
      referencedArticleTitle: m.referencedArticleTitle,
    }))
  );
  const [pastMemories, setPastMemories] = React.useState<PastMemory[]>([]);
  const [speakerId, setSpeakerId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>(initialStatus(Boolean(session), saved.length));
  const [error, setError] = React.useState<string | null>(null);

  // 未生成の対談だけ、SSEで生成を始める
  // biome-ignore lint/correctness/useExhaustiveDependencies: 生成は id が変わったときだけ始める (session と saved は id から決まる)
  React.useEffect(() => {
    if (!session || saved.length > 0) {
      return;
    }
    let source: EventSource | null = null;
    setStatus("streaming");
    source = new EventSource(`/api/sessions/${id}/stream`);
    const parse = (e: Event) => JSON.parse((e as MessageEvent).data);

    source.addEventListener("session_start", (e) => {
      const evt = parse(e);
      setPastMemories(evt.pastMemories ?? []);
      if (Array.isArray(evt.personas)) {
        setParticipants(evt.personas);
      }
    });
    source.addEventListener("turn_start", (e) => {
      const evt = parse(e);
      setSpeakerId(evt.persona.id);
      setMessages((prev) => [...prev, toChatMessage(evt.persona, evt.turnIndex)]);
    });
    source.addEventListener("chunk", (e) => {
      const evt = parse(e);
      setMessages((prev) =>
        prev.map((m) => (m.turnIndex === evt.turnIndex ? { ...m, content: m.content + evt.chunk } : m))
      );
    });
    source.addEventListener("turn_end", (e) => {
      const evt = parse(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.turnIndex === evt.turnIndex
            ? {
                ...m,
                content: evt.content ?? m.content,
                streaming: false,
                referencedSessionId: evt.referencedSessionId,
                referencedArticleTitle: evt.referencedArticleTitle,
              }
            : m
        )
      );
    });
    source.addEventListener("session_end", () => {
      setSpeakerId(null);
      setStatus("done");
      source?.close();
    });
    // サーバーが送る error イベント (data あり) と、接続断 (data なし) の両方を扱う
    source.addEventListener("error", (e) => {
      const { data } = e as MessageEvent;
      setError(data ? JSON.parse(data).message : "接続が切れました。");
      setSpeakerId(null);
      setStatus("error");
      source?.close();
    });
    return () => source?.close();
  }, [id]);

  return { session, participants, messages, pastMemories, speakerId, status, error };
}
