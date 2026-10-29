import React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Link2, Loader2, MessagesSquare } from "lucide-react";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { GenreCount, SessionListItem, formatDate, hostOf, postJson } from "../client/lib/api";
import { getSessionList } from "../server-fns/sessions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { genre?: string } =>
    typeof search.genre === "string" && search.genre ? { genre: search.genre } : {},
  loaderDeps: ({ search }) => ({ genre: search.genre }),
  loader: ({ deps }) => getSessionList({ data: deps.genre }),
  component: HomePage,
});

function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function HomePage() {
  const { genre } = Route.useSearch();
  const { sessions, genres } = Route.useLoaderData() as { sessions: SessionListItem[]; genres: GenreCount[] };
  return (
    <div className="space-y-10">
      <NewDialogueForm />
      <SessionList genre={genre} sessions={sessions} genres={genres} />
    </div>
  );
}

/** 入力はURLだけ。ペルソナ・ジャンル・発言数はサーバーが自動で決める */
function NewDialogueForm() {
  const navigate = useNavigate();
  const [url, setUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHttpUrl(url) || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postJson<{ sessionId: string; existing: boolean; totalTurns?: number }>("/api/sessions", {
        url: url.trim(),
      });
      await navigate({
        to: "/s/$id",
        params: { id: res.sessionId },
        search: res.existing || !res.totalTurns ? {} : { turns: res.totalTurns },
      });
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-3 pt-2">
      <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">このページ、AIたちに語らせよう</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="url" className="sr-only">
            記事のURL
          </label>
          <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="url"
            type="url"
            inputMode="url"
            required
            disabled={submitting}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="記事のURLを貼り付け"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 pl-11 pr-4 text-base text-zinc-50 placeholder-zinc-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={!isHttpUrl(url) || submitting}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "準備中…" : "対談する"}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
      <p className="text-center text-xs text-zinc-500" aria-live="polite">
        {submitting
          ? "記事を読んで、ジャンルと登場するペルソナを選んでいます…"
          : "ジャンル・参加ペルソナ・発言数は自動で決まります。同じページは保存済みの対談を開きます。"}
      </p>
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </form>
  );
}

function SessionList({ genre, sessions, genres }: { genre?: string; sessions: SessionListItem[]; genres: GenreCount[] }) {
  const total = genres.reduce((n, g) => n + g.count, 0);
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
      active
        ? "border-indigo-500 bg-indigo-500/15 text-indigo-100"
        : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
    }`;

  return (
    <section className="space-y-5" aria-label="対談の一覧">
      {genres.length > 0 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="ジャンルで絞り込み">
          <Link to="/" className={chip(!genre)} aria-current={!genre ? "page" : undefined}>
            すべて <span className="text-zinc-500">{total}</span>
          </Link>
          {genres.map((g) => (
            <Link
              key={g.genre}
              to="/"
              search={{ genre: g.genre }}
              className={chip(genre === g.genre)}
              aria-current={genre === g.genre ? "page" : undefined}
            >
              {g.genre} <span className="text-zinc-500">{g.count}</span>
            </Link>
          ))}
        </nav>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-zinc-400">
          <MessagesSquare className="h-8 w-8 text-zinc-600" />
          {genre ? (
            <p>
              「{genre}」の対談はまだありません。
              <Link to="/" className="ml-1 text-indigo-300 hover:text-indigo-200">
                すべて表示
              </Link>
            </p>
          ) : (
            <p>まだ対談がありません。上の入力欄に記事のURLを貼ってみましょう。</p>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <SessionCard session={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionCard({ session: s }: { session: SessionListItem }) {
  // サムネイルは、サイトのOGP画像 → 無い/読み込めなければ対談ごとの生成画像 → それも不可ならジャンル表示
  const sources = [s.ogp?.image, `/api/sessions/${s.id}/ogp.png`].filter((src): src is string => !!src);
  const [stage, setStage] = React.useState(0);
  const src = sources[stage];
  const isSiteImage = !!s.ogp?.image && stage === 0;

  return (
    <Link
      to="/s/$id"
      params={{ id: s.id }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-600"
    >
      <div className="aspect-[1.91/1] overflow-hidden bg-gradient-to-br from-indigo-950 to-zinc-900">
        {src ? (
          <img
            key={src}
            src={src}
            alt=""
            loading="lazy"
            width={1200}
            height={630}
            referrerPolicy={isSiteImage ? "no-referrer" : undefined}
            // サイトの画像は比率が様々なので切り抜かず全体を見せる
            className={`h-full w-full ${isSiteImage ? "bg-zinc-800 object-contain" : "object-cover"}`}
            onError={() => setStage((n) => n + 1)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm font-medium text-indigo-200/70">
            {s.genre}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-indigo-200">{s.genre}</span>
          <span className="text-zinc-500">{formatDate(s.createdAt)}</span>
        </div>
        <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-50">{s.articleTitle}</h2>
        {s.summary && <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{s.summary}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <ul className="flex -space-x-1.5" aria-label="参加者">
            {s.participants.map((p) => (
              <li key={p.id}>
                <PersonaAvatar {...p} size={28} />
              </li>
            ))}
          </ul>
          <span className="truncate text-xs text-zinc-500">{s.ogp?.siteName || hostOf(s.sourceUrl)}</span>
        </div>
      </div>
    </Link>
  );
}
