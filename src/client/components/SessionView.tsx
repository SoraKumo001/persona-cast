import { Link } from "@tanstack/react-router";
import { BrainCircuit, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import React from "react";
import { useSessionStream } from "../hooks/use-session-stream";
import { formatDateTime } from "../lib/api";
import type { RelatedSession, SessionDetail } from "../lib/session-detail";
import { OgpCard } from "./OgpCard";
import { PersonaAvatar } from "./PersonaAvatar";

/** X (旧Twitter) の投稿画面を開くリンク。JS なしでも動くよう、普通のリンクにしている */
function ShareOnX({ url, title }: { url: string; title: string }) {
  const text = `${title}｜AIペルソナの対談`;
  const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <a
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      Xでシェア
    </a>
  );
}

/** 内容の近い過去の対談。対談ページ同士のリンクにもなる */
export function RelatedSessions({ items }: { items: RelatedSession }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="related-heading" className="space-y-2 pt-2">
      <h2 className="text-sm font-semibold text-zinc-200" id="related-heading">
        関連する対談
      </h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.sessionId}>
            <Link
              className="block rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 hover:border-zinc-600"
              params={{ id: r.sessionId }}
              to="/s/$id"
            >
              <span className="block text-sm font-medium text-zinc-100">{r.articleTitle}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400">{r.topicSummary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionView({
  id,
  detail,
  pageUrl,
  related,
}: {
  id: string;
  detail: SessionDetail | null;
  pageUrl: string | null;
  related: RelatedSession;
}) {
  const { session, participants, messages, pastMemories, speakerId, status, error } = useSessionStream({ id, detail });
  // 共有URLは、loader が返した値を優先し、無ければ (取得に失敗したときなど) 表示中のURLから作る
  const shareUrl =
    pageUrl ?? (typeof window === "undefined" ? null : `${window.location.origin}/s/${encodeURIComponent(id)}`);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  // 末尾付近を見ている間だけ自動スクロールする
  React.useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 発言が増えるたびに末尾へスクロールするため、messages を依存に入れる
  React.useEffect(() => {
    if (status === "streaming" && stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, status]);

  if (!session) {
    return (
      <div className="space-y-3 py-24 text-center">
        <p className="text-zinc-300">{error ?? "対談が見つかりません"}</p>
        <Link className="text-sm text-indigo-300 hover:text-indigo-200" to="/">
          新しい対談を始める
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="パンくず" className="flex items-center gap-2 text-xs text-zinc-400">
          <Link className="hover:text-zinc-200" to="/">
            対談一覧
          </Link>
          {session.genre ? (
            <>
              <span aria-hidden>/</span>
              <Link
                className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-indigo-200 hover:bg-indigo-500/25"
                search={{ genre: session.genre }}
                to="/"
              >
                {session.genre}
              </Link>
            </>
          ) : null}
        </nav>
        {status === "done" && shareUrl && session && <ShareOnX title={session.articleTitle} url={shareUrl} />}
      </div>

      <OgpCard
        ogp={session.ogp}
        summary={session.summary ?? session.articleSummary.slice(0, 200)}
        title={session.articleTitle}
        url={session.sourceUrl}
      />

      <div className="flex items-center justify-between gap-3">
        <ul aria-label="参加者" className="flex items-center -space-x-1">
          {participants.map((p) => (
            <li key={p.id}>
              <Link aria-label={`${p.name}のページ`} params={{ id: p.id }} to="/persona/$id">
                <PersonaAvatar {...p} active={speakerId === p.id} size={36} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-end gap-0.5 text-xs text-zinc-400">
          {formatDateTime(session.createdAt) && (
            <time className="text-zinc-500" dateTime={session.createdAt}>
              {formatDateTime(session.createdAt)} 生成
            </time>
          )}
          <p aria-live="polite" className="flex items-center gap-1.5">
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
                  className="block rounded-lg px-2 py-1.5 hover:bg-zinc-800/70"
                  params={{ id: m.sessionId }}
                  to="/s/$id"
                >
                  <span className="block font-medium text-zinc-100">{m.articleTitle}</span>
                  <span className="block text-xs text-zinc-400">{m.topicSummary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ol aria-label="対談ログ" className="space-y-5">
        {messages.map((m) => (
          <li className="flex gap-3" key={m.turnIndex}>
            <PersonaAvatar
              active={m.streaming}
              avatar={m.avatar}
              avatarUrl={m.avatarUrl}
              name={m.name}
              size={40}
              themeColor={m.themeColor}
            />
            <div className="min-w-0 flex-1">
              <p className="mb-1 flex items-baseline gap-2 text-xs">
                <span className="font-semibold" style={{ color: m.themeColor }}>
                  {m.name}
                </span>
                {m.role ? <span className="text-zinc-500">{m.role}</span> : null}
              </p>
              <div
                className="rounded-2xl rounded-tl-sm border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-zinc-100"
                style={{ borderLeft: `3px solid ${m.themeColor}` }}
              >
                {m.content || <span className="text-zinc-500">…</span>}
                {m.streaming ? (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400 align-middle" />
                ) : null}
              </div>
              {m.referencedArticleTitle ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-indigo-300">
                  <BrainCircuit className="h-3 w-3" />
                  {m.referencedSessionId ? (
                    <Link className="hover:underline" params={{ id: m.referencedSessionId }} to="/s/$id">
                      「{m.referencedArticleTitle}」の対談を参照
                    </Link>
                  ) : (
                    <span>「{m.referencedArticleTitle}」を参照</span>
                  )}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {error ? (
        <p
          className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {status === "done" && <RelatedSessions items={related} />}

      {status === "done" && (
        <div className="pt-2 text-center">
          <Link className="text-sm text-indigo-300 hover:text-indigo-200" to="/">
            別のURLで対談する
          </Link>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
