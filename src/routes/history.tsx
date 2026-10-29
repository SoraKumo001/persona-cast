import React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { MemoryExplorer } from "../client/components/MemoryExplorer";
import { SessionSummary, api, formatDate, hostOf } from "../client/lib/api";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = React.useState<SessionSummary[] | null>(null);

  React.useEffect(() => {
    api<{ sessions: SessionSummary[] }>("/api/sessions")
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-xl font-bold">対談の履歴</h1>
        {sessions === null ? (
          <p className="text-sm text-zinc-500">読み込み中…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-zinc-400">
            まだ対談がありません。
            <Link to="/" className="ml-1 text-indigo-300 hover:text-indigo-200">
              最初のURLを入力してみましょう
            </Link>
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  to="/s/$id"
                  params={{ id: s.id }}
                  className="flex h-full gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-700"
                >
                  {s.ogp?.image ? (
                    <img
                      src={s.ogp.image}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-20 w-20 shrink-0 rounded-lg bg-zinc-800 object-cover"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-xs text-zinc-500">
                      {s.ogp?.siteName || hostOf(s.sourceUrl)} ・ {formatDate(s.createdAt)}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-50">{s.articleTitle}</span>
                    <span className="mt-1 line-clamp-2 text-xs text-zinc-400">{s.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <MemoryExplorer onOpenSession={(id) => navigate({ to: "/s/$id", params: { id } })} />
      </section>
    </div>
  );
}
