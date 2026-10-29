import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight, Link2, Loader2, MessagesSquare, Search } from "lucide-react";
import React from "react";
import { SessionCard } from "../client/components/SessionCard";
import { errorMessage, type GenreCount, postJson, type SessionListItem } from "../client/lib/api";
import { pageItems } from "../client/lib/pagination";
import { getSessionList } from "../server-fns/sessions";
import { getSiteOrigin } from "../server-fns/site-meta";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { genre?: string; page?: number; q?: string } => {
    const page = Number(search.page);
    const q = typeof search.q === "string" ? search.q.trim().slice(0, 50) : "";
    return {
      ...(typeof search.genre === "string" && search.genre ? { genre: search.genre } : {}),
      ...(q ? { q } : {}),
      // 1ページ目は省略する (URLを1つに保つ)
      ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    };
  },
  loaderDeps: ({ search }) => ({ genre: search.genre, page: search.page, q: search.q }),
  loader: async ({ deps }) => {
    const [list, origin] = await Promise.all([
      getSessionList({ data: { genre: deps.genre, page: deps.page, q: deps.q } }),
      getSiteOrigin(),
    ]);
    return { ...list, origin, q: deps.q };
  },
  head: ({ loaderData }) => {
    const title = "Persona-Cast | URLをAIペルソナが語り合う";
    const description = "記事のURLを貼るだけで、個性の違うAIペルソナがその内容について対談します。";
    const image = loaderData ? `${loaderData.origin}/api/ogp.png` : undefined;
    return {
      meta: [
        { title },
        // 検索結果のページは、検索エンジンの索引に入れない
        ...(loaderData?.q ? [{ name: "robots", content: "noindex" }] : []),
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Persona-Cast" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(loaderData ? [{ property: "og:url", content: `${loaderData.origin}/` }] : []),
        ...(image
          ? [
              { property: "og:image", content: image },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
              { name: "twitter:card", content: "summary_large_image" },
              { name: "twitter:image", content: image },
            ]
          : [{ name: "twitter:card", content: "summary" }]),
      ],
    };
  },
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
  const { genre, q } = Route.useSearch();
  const { sessions, genres, page, totalPages } = Route.useLoaderData() as {
    sessions: SessionListItem[];
    genres: GenreCount[];
    page: number;
    totalPages: number;
  };
  return (
    <div className="space-y-10">
      <NewDialogueForm />
      <SessionList genre={genre} genres={genres} page={page} q={q} sessions={sessions} totalPages={totalPages} />
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
    if (!isHttpUrl(url) || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await postJson<{ sessionId: string; existing: boolean }>("/api/sessions", {
        url: url.trim(),
      });
      await navigate({
        to: "/s/$id",
        params: { id: res.sessionId },
      });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <form className="mx-auto max-w-2xl space-y-3 pt-2" onSubmit={submit}>
      <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">このページ、AIたちに語らせよう</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label className="sr-only" htmlFor="url">
            記事のURL
          </label>
          <Link2 className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 pr-4 pl-11 text-base text-zinc-50 placeholder-zinc-600 transition-colors outline-none focus:border-indigo-500 disabled:opacity-60"
            disabled={submitting}
            id="url"
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
            placeholder="記事のURLを貼り付け"
            required
            type="url"
            value={url}
          />
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!isHttpUrl(url) || submitting}
          type="submit"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "準備中…" : "対談する"}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
      <p aria-live="polite" className="text-center text-xs text-zinc-500">
        {submitting
          ? "記事を読んで、ジャンルと登場するペルソナを選んでいます…"
          : "ジャンル・参加ペルソナ・発言数は自動で決まります。同じページは保存済みの対談を開きます。"}
      </p>
      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** キーワード検索。JS なしでも動くよう、GET のフォームにしている (結果は ?q= のURLで共有できる) */
function SearchForm({ genre, q }: { genre?: string; q?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = React.useState(q ?? "");
  // 戻る・進むや「クリア」でURLの q が変わったら、入力欄も合わせる
  React.useEffect(() => {
    setValue(q ?? "");
  }, [q]);

  return (
    <search className="mx-auto block max-w-md">
      <form
        action="/"
        className="relative"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          const next = value.trim();
          navigate({ to: "/", search: { ...(genre ? { genre } : {}), ...(next ? { q: next } : {}) } });
        }}
      >
        <label className="sr-only" htmlFor="q">
          対談をキーワードで検索
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          className="w-full rounded-full border border-zinc-800 bg-zinc-900 py-2 pr-4 pl-10 text-sm text-zinc-50 placeholder-zinc-600 outline-none focus:border-indigo-500"
          id="q"
          maxLength={50}
          name="q"
          onChange={(e) => setValue(e.target.value)}
          placeholder="対談をキーワードで検索"
          type="search"
          value={value}
        />
        {genre ? <input name="genre" type="hidden" value={genre} /> : null}
      </form>
    </search>
  );
}

function SessionList({
  genre,
  q,
  sessions,
  genres,
  page,
  totalPages,
}: {
  genre?: string;
  q?: string;
  sessions: SessionListItem[];
  genres: GenreCount[];
  page: number;
  totalPages: number;
}) {
  const total = genres.reduce((n, g) => n + g.count, 0);
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
      active
        ? "border-indigo-500 bg-indigo-500/15 text-indigo-100"
        : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
    }`;

  return (
    <section aria-label="対談の一覧" className="space-y-5">
      <SearchForm genre={genre} q={q} />
      {genres.length > 0 && (
        <nav aria-label="ジャンルで絞り込み" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Link aria-current={genre ? undefined : "page"} className={chip(!genre)} search={q ? { q } : {}} to="/">
            すべて <span className="text-zinc-500">{total}</span>
          </Link>
          {genres.map((g) => (
            <Link
              aria-current={genre === g.genre ? "page" : undefined}
              className={chip(genre === g.genre)}
              key={g.genre}
              search={{ genre: g.genre, ...(q ? { q } : {}) }}
              to="/"
            >
              {g.genre} <span className="text-zinc-500">{g.count}</span>
            </Link>
          ))}
        </nav>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-zinc-400">
          <MessagesSquare className="h-8 w-8 text-zinc-600" />
          {q || genre ? (
            <p>
              {q ? `「${q}」に一致する` : `「${genre}」の`}対談はありません。
              <Link className="ml-1 text-indigo-300 hover:text-indigo-200" to="/">
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

      {totalPages > 1 && <Pagination genre={genre} page={page} q={q} totalPages={totalPages} />}
    </section>
  );
}

/** ページ送り。各ページは ?page=N のリンクなので、URLで共有でき、SSRもキャッシュもページごとに効く */
function Pagination({ genre, q, page, totalPages }: { genre?: string; q?: string; page: number; totalPages: number }) {
  const cell = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm transition-colors";
  const idle = "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600";
  const searchFor = (p: number) => ({
    ...(genre ? { genre } : {}),
    ...(q ? { q } : {}),
    ...(p > 1 ? { page: p } : {}),
  });

  return (
    <nav aria-label="ページ送り" className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
      {page > 1 ? (
        <Link className={`${cell} ${idle} gap-1`} rel="prev" search={searchFor(page - 1)} to="/">
          <ChevronLeft className="h-4 w-4" /> 前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={`${cell} gap-1 border-zinc-900 text-zinc-600`}>
          <ChevronLeft className="h-4 w-4" /> 前へ
        </span>
      )}

      {pageItems(page, totalPages).map((item, i, items) =>
        item === "…" ? (
          <span aria-hidden="true" className="px-1 text-zinc-600" key={`gap-after-${items[i - 1]}`}>
            …
          </span>
        ) : (
          <Link
            aria-current={item === page ? "page" : undefined}
            aria-label={`${item}ページ目`}
            className={`${cell} ${item === page ? "border-indigo-500 bg-indigo-500/15 text-indigo-100" : idle}`}
            key={item}
            search={searchFor(item)}
            to="/"
          >
            {item}
          </Link>
        )
      )}

      {page < totalPages ? (
        <Link className={`${cell} ${idle} gap-1`} rel="next" search={searchFor(page + 1)} to="/">
          次へ <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-disabled="true" className={`${cell} gap-1 border-zinc-900 text-zinc-600`}>
          次へ <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
