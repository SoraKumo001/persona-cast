import React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BrainCircuit, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { OgpCard } from "../client/components/OgpCard";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { getSessionMeta } from "../server-fns/session-meta";
import { ChatMessage, PastMemory, Persona, SessionSummary, api } from "../client/lib/api";

export const Route = createFileRoute("/s/$id")({
  validateSearch: (search: Record<string, unknown>): { turns?: number } => {
    const turns = Number(search.turns);
    return Number.isInteger(turns) && turns > 0 && turns <= 20 ? { turns } : {};
  },
  loader: ({ params }) => getSessionMeta({ data: params.id }),
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: loaderData.title },
            { name: "description", content: loaderData.description },
            { property: "og:type", content: "article" },
            { property: "og:site_name", content: "Persona-Cast" },
            { property: "og:title", content: loaderData.title },
            { property: "og:description", content: loaderData.description },
            { property: "og:url", content: loaderData.pageUrl },
            { property: "og:image", content: loaderData.imageUrl },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
            { name: "twitter:card", content: "summary_large_image" },
            { name: "twitter:image", content: loaderData.imageUrl },
          ],
        }
      : {},
  component: SessionPage,
});

type Status = "loading" | "streaming" | "done" | "error";

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

function SessionPage() {
  const { id } = Route.useParams();
  const { turns = 6 } = Route.useSearch();

  const [session, setSession] = React.useState<SessionSummary | null>(null);
  const [participants, setParticipants] = React.useState<Persona[]>([]);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [pastMemories, setPastMemories] = React.useState<PastMemory[]>([]);
  const [speakerId, setSpeakerId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  React.useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    setSession(null);
    setMessages([]);
    setPastMemories([]);
    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const [detail, all] = await Promise.all([
          api<{
            session: SessionSummary;
            messages: (ChatMessage & {
              personaName: string | null;
              personaAvatar: string | null;
              personaAvatarUrl: string | null;
              personaThemeColor: string | null;
            })[];
          }>(`/api/sessions/${id}`),
          api<{ personas: Persona[] }>("/api/personas").catch(() => ({ personas: [] as Persona[] })),
        ]);
        if (cancelled) return;

        setSession(detail.session);
        setParticipants(all.personas.filter((p) => detail.session.personaIds.includes(p.id)));

        // 保存済みの対談があればそのまま表示する (再生成しない)
        if (detail.messages.length > 0) {
          setMessages(
            detail.messages.map((m: any) => ({
              turnIndex: m.turnIndex,
              personaId: m.personaId,
              name: m.personaName || "ペルソナ",
              role: all.personas.find((p) => p.id === m.personaId)?.role ?? "",
              avatar: m.personaAvatar || "🎙️",
              avatarUrl: m.personaAvatarUrl ?? null,
              themeColor: m.personaThemeColor || "#6366f1",
              content: m.content,
              streaming: false,
              referencedSessionId: m.referencedSessionId,
              referencedArticleTitle: m.referencedArticleTitle,
            }))
          );
          setStatus("done");
          return;
        }

        // 未生成ならSSEで対談を開始
        setStatus("streaming");
        source = new EventSource(`/api/sessions/${id}/stream?turns=${turns}`);
        const parse = (e: Event) => JSON.parse((e as MessageEvent).data);

        source.addEventListener("session_start", (e) => {
          const evt = parse(e);
          setPastMemories(evt.pastMemories ?? []);
          if (Array.isArray(evt.personas)) setParticipants(evt.personas);
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
          const data = (e as MessageEvent).data;
          setError(data ? JSON.parse(data).message : "接続が切れました。");
          setSpeakerId(null);
          setStatus("error");
          source?.close();
        });
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [id, turns]);

  // 末尾付近を見ている間だけ自動スクロールする
  React.useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => {
    if (status === "streaming" && stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  if (status === "loading" && !session) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…
      </div>
    );
  }
  if (!session) {
    return (
      <div className="space-y-3 py-24 text-center">
        <p className="text-zinc-300">{error ?? "対談が見つかりません"}</p>
        <Link to="/" className="text-sm text-indigo-300 hover:text-indigo-200">
          新しい対談を始める
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="flex items-center gap-2 text-xs text-zinc-400" aria-label="パンくず">
        <Link to="/" className="hover:text-zinc-200">
          対談一覧
        </Link>
        {session.genre && (
          <>
            <span aria-hidden>/</span>
            <Link
              to="/"
              search={{ genre: session.genre }}
              className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-indigo-200 hover:bg-indigo-500/25"
            >
              {session.genre}
            </Link>
          </>
        )}
      </nav>

      <OgpCard
        url={session.sourceUrl}
        title={session.articleTitle}
        summary={session.summary ?? session.articleSummary.slice(0, 200)}
        ogp={session.ogp}
      />

      <div className="flex items-center justify-between gap-3">
        <ul className="flex items-center -space-x-1" aria-label="参加者">
          {participants.map((p) => (
            <li key={p.id}>
              <PersonaAvatar {...p} size={36} active={speakerId === p.id} />
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-1.5 text-xs text-zinc-400" aria-live="polite">
          {status === "streaming" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 対談中…
            </>
          )}
          {status === "done" && (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 対談終了
            </>
          )}
        </p>
      </div>

      {pastMemories.length > 0 && (
        <details className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm" open>
          <summary className="flex cursor-pointer items-center gap-2 text-zinc-300">
            <BrainCircuit className="h-4 w-4 text-indigo-300" />
            過去の対談を {pastMemories.length} 件思い出しています
          </summary>
          <ul className="mt-3 space-y-2">
            {pastMemories.map((m) => (
              <li key={m.sessionId}>
                <Link
                  to="/s/$id"
                  params={{ id: m.sessionId }}
                  className="block rounded-lg px-2 py-1.5 hover:bg-zinc-800/70"
                >
                  <span className="block font-medium text-zinc-100">{m.articleTitle}</span>
                  <span className="block text-xs text-zinc-400">{m.topicSummary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ol className="space-y-5" aria-label="対談ログ">
        {messages.map((m) => (
          <li key={m.turnIndex} className="flex gap-3">
            <PersonaAvatar
              name={m.name}
              avatar={m.avatar}
              avatarUrl={m.avatarUrl}
              themeColor={m.themeColor}
              size={40}
              active={m.streaming}
            />
            <div className="min-w-0 flex-1">
              <p className="mb-1 flex items-baseline gap-2 text-xs">
                <span className="font-semibold" style={{ color: m.themeColor }}>
                  {m.name}
                </span>
                {m.role && <span className="text-zinc-500">{m.role}</span>}
              </p>
              <div
                className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-100"
                style={{ borderLeft: `3px solid ${m.themeColor}` }}
              >
                {m.content || <span className="text-zinc-500">…</span>}
                {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400 align-middle" />}
              </div>
              {m.referencedArticleTitle && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-indigo-300">
                  <BrainCircuit className="h-3 w-3" />
                  {m.referencedSessionId ? (
                    <Link to="/s/$id" params={{ id: m.referencedSessionId }} className="hover:underline">
                      「{m.referencedArticleTitle}」の対談を参照
                    </Link>
                  ) : (
                    <span>「{m.referencedArticleTitle}」を参照</span>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {status === "done" && (
        <div className="pt-2 text-center">
          <Link to="/" className="text-sm text-indigo-300 hover:text-indigo-200">
            別のURLで対談する
          </Link>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
