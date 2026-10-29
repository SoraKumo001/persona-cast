import { createFileRoute, Link } from "@tanstack/react-router";
import { EyeOff, Loader2, RotateCcw, Search } from "lucide-react";
import React from "react";
import { ApiError, api, errorMessage, formatDateTime, hostOf } from "../client/lib/api";

export const Route = createFileRoute("/admin/sessions")({
  component: AdminSessionsPage,
});

interface AdminSession {
  articleTitle: string;
  createdAt: string;
  genre: string | null;
  hiddenAt: string | null;
  id: string;
  messageCount: number;
  sourceUrl: string;
}

interface SessionPage {
  page: number;
  sessions: AdminSession[];
  total: number;
  totalPages: number;
}

/** 公開中の対談を、後から非表示にする (削除はしない。復元できる) */
function AdminSessionsPage() {
  const [data, setData] = React.useState<SessionPage | null>(null);
  const [query, setQuery] = React.useState("");
  const [applied, setApplied] = React.useState("");
  const [hiddenOnly, setHiddenOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);

  const load = React.useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (applied) {
      params.set("q", applied);
    }
    if (hiddenOnly) {
      params.set("hidden", "1");
    }
    try {
      setData(await api<SessionPage>(`/api/admin/sessions?${params}`));
      setError(null);
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiError && [401, 403, 503].includes(err.status)) {
        setDenied(true);
      }
      setError(errorMessage(err));
    }
  }, [page, applied, hiddenOnly]);
  React.useEffect(() => {
    load();
  }, [load]);

  const toggle = async (s: AdminSession) => {
    setBusyId(s.id);
    try {
      await api(`/api/admin/sessions/${encodeURIComponent(s.id)}/${s.hiddenAt ? "restore" : "hide"}`, {
        method: "POST",
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (denied) {
    return (
      <div className="mx-auto max-w-md space-y-2 py-20 text-center">
        <h1 className="text-lg font-semibold">管理者のみ利用できます</h1>
        <p className="text-sm text-zinc-400">
          Cloudflare Access で認証されたアカウントでアクセスしてください。({error})
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">対談の管理</h1>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(query.trim());
        }}
      >
        <label className="sr-only" htmlFor="session-query">
          タイトルまたはURLで検索
        </label>
        <input
          className="w-72 max-w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-indigo-500"
          id="session-query"
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="タイトルまたはURLで検索"
          value={query}
        />
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          type="submit"
        >
          <Search className="h-4 w-4" /> 検索
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            checked={hiddenOnly}
            onChange={(e) => {
              setPage(1);
              setHiddenOnly(e.target.checked);
            }}
            type="checkbox"
          />
          非表示のみ
        </label>
      </form>

      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {error}
        </p>
      ) : null}

      {data === null ? (
        <p className="text-sm text-zinc-500">読み込み中…</p>
      ) : (
        <>
          <p className="text-xs text-zinc-500">{data.total} 件</p>
          <ul className="divide-y divide-zinc-800 rounded-2xl border border-zinc-800">
            {data.sessions.map((s) => (
              <SessionItem busy={busyId === s.id} key={s.id} onToggle={() => toggle(s)} session={s} />
            ))}
            {data.sessions.length === 0 && <li className="px-4 py-8 text-center text-sm text-zinc-500">該当なし</li>}
          </ul>
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 text-sm text-zinc-300">
              <button
                className="rounded-lg border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
                type="button"
              >
                前へ
              </button>
              <span>
                {data.page} / {data.totalPages}
              </span>
              <button
                className="rounded-lg border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage(data.page + 1)}
                type="button"
              >
                次へ
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusNote(s: AdminSession): string {
  if (s.hiddenAt) {
    return " ・ 非表示";
  }
  return s.messageCount === 0 ? " ・ 未生成" : "";
}

function ToggleIcon({ busy, hidden }: { busy: boolean; hidden: boolean }) {
  if (busy) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  return hidden ? <RotateCcw className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />;
}

/** 1件分の行。非表示にする前は、同じ行の中で確認を取る */
function SessionItem({ session: s, busy, onToggle }: { session: AdminSession; busy: boolean; onToggle: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  const button = "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40";

  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${s.hiddenAt ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-50">
          {s.hiddenAt || s.messageCount === 0 ? (
            s.articleTitle
          ) : (
            <Link className="hover:underline" params={{ id: s.id }} to="/s/$id">
              {s.articleTitle}
            </Link>
          )}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {hostOf(s.sourceUrl)} ・ {s.genre ?? "その他"} ・ 発言 {s.messageCount} ・ {formatDateTime(s.createdAt)}
          {statusNote(s)}
        </p>
      </div>
      {confirming ? (
        <>
          <button
            className={`${button} border-red-500/60 text-red-200 hover:bg-red-500/10`}
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onToggle();
            }}
            type="button"
          >
            非表示にする
          </button>
          <button
            className={`${button} border-zinc-700 text-zinc-300 hover:bg-zinc-800`}
            onClick={() => setConfirming(false)}
            type="button"
          >
            やめる
          </button>
        </>
      ) : (
        <button
          className={`${button} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
          disabled={busy}
          onClick={s.hiddenAt ? onToggle : () => setConfirming(true)}
          type="button"
        >
          <ToggleIcon busy={busy} hidden={Boolean(s.hiddenAt)} />
          {s.hiddenAt ? "再公開" : "非表示"}
        </button>
      )}
    </li>
  );
}
