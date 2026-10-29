import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EyeOff, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
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
  const navigate = useNavigate();
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

  const act = async (s: AdminSession, action: Action) => {
    setBusyId(s.id);
    try {
      await api(`/api/admin/sessions/${encodeURIComponent(s.id)}/${action}`, { method: "POST" });
      if (action === "regenerate") {
        // 未生成に戻った対談のページを開くと、生成が始まる
        await navigate({ to: "/s/$id", params: { id: s.id } });
        return;
      }
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
              <SessionItem busy={busyId === s.id} key={s.id} onAction={(a) => act(s, a)} session={s} />
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

type Action = "hide" | "restore" | "regenerate";

const CONFIRM: Record<"hide" | "regenerate", { label: string; note: string }> = {
  hide: { label: "非表示にする", note: "公開をやめます (あとで再公開できます)" },
  regenerate: {
    label: "再生成する",
    note: "発言と記憶を消し、要約・ジャンル・参加者を取り直して作り直します (元に戻せません)",
  },
};

function statusNote(s: AdminSession): string {
  if (s.hiddenAt) {
    return " ・ 非表示";
  }
  return s.messageCount === 0 ? " ・ 未生成" : "";
}

function RowIcon({ busy, icon: Icon }: { busy: boolean; icon: typeof EyeOff }) {
  return busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />;
}

/** 1件分の行。非表示・再生成の前は、同じ行の中で確認を取る */
function SessionItem({
  session: s,
  busy,
  onAction,
}: {
  session: AdminSession;
  busy: boolean;
  onAction: (action: Action) => void;
}) {
  const [confirming, setConfirming] = React.useState<"hide" | "regenerate" | null>(null);
  const button = "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40";
  const idle = `${button} border-zinc-700 text-zinc-200 hover:bg-zinc-800`;

  let actions: React.ReactNode;
  if (confirming) {
    actions = (
      <>
        <button
          className={`${button} border-red-500/60 text-red-200 hover:bg-red-500/10`}
          disabled={busy}
          onClick={() => {
            setConfirming(null);
            onAction(confirming);
          }}
          type="button"
        >
          {CONFIRM[confirming].label}
        </button>
        <button
          className={`${button} border-zinc-700 text-zinc-300 hover:bg-zinc-800`}
          onClick={() => setConfirming(null)}
          type="button"
        >
          やめる
        </button>
      </>
    );
  } else if (s.hiddenAt) {
    actions = (
      <button className={idle} disabled={busy} onClick={() => onAction("restore")} type="button">
        <RowIcon busy={busy} icon={RotateCcw} />
        再公開
      </button>
    );
  } else {
    actions = (
      <>
        {s.messageCount > 0 && (
          <button className={idle} disabled={busy} onClick={() => setConfirming("regenerate")} type="button">
            <RowIcon busy={busy} icon={RefreshCw} />
            再生成
          </button>
        )}
        <button className={idle} disabled={busy} onClick={() => setConfirming("hide")} type="button">
          <RowIcon busy={busy} icon={EyeOff} />
          非表示
        </button>
      </>
    );
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${s.hiddenAt ? "opacity-60" : ""}`}>
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
        {confirming ? <p className="mt-1 text-xs text-red-300">{CONFIRM[confirming].note}</p> : null}
      </div>
      {actions}
    </li>
  );
}
