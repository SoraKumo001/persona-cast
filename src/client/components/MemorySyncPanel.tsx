import { Loader2, RotateCcw } from "lucide-react";
import React from "react";
import { api, errorMessage, postJson } from "../lib/api";

/** 記憶 (D1) を検索用の Vectorize に登録し直す。保存時に Vectorize への書き込みが失敗してずれたときに使う */
export function MemorySyncPanel() {
  const [info, setInfo] = React.useState<{ total: number; vectorize: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    api<{ total: number; vectorize: boolean }>("/api/admin/memories")
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  if (!info) {
    return null;
  }

  const resync = async () => {
    setBusy(true);
    setProgress(0);
    setMessage(null);
    let done = 0;
    let regenerated = 0;
    try {
      let after: string | null = "";
      while (after !== null) {
        const r: { processed: number; regenerated: number; next: string | null } = await postJson(
          "/api/admin/memories/resync",
          { after }
        );
        done += r.processed;
        regenerated += r.regenerated;
        setProgress(done);
        after = r.next;
      }
      setMessage({
        ok: true,
        text: `${done} 件を登録しました${regenerated > 0 ? ` (埋め込みを作り直した記憶: ${regenerated} 件)` : ""}`,
      });
    } catch (err) {
      setMessage({ ok: false, text: `${done} 件で止まりました: ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">記憶の再同期</h2>
        <p className="text-xs text-zinc-500">
          D1 に保存した記憶 {info.total} 件を、検索用の Vectorize に登録し直します。 何度実行しても同じ結果になります。
          {info.vectorize ? "" : " (Vectorize が未設定のため、実行できません)"}
        </p>
      </div>
      <button
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        disabled={busy || !info.vectorize || info.total === 0}
        onClick={resync}
        type="button"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        {busy ? `${progress} / ${info.total} 件…` : "再同期"}
      </button>
      {message ? (
        <p
          aria-live="polite"
          className={`basis-full text-sm ${message.ok ? "text-emerald-400" : "text-red-300"}`}
          role={message.ok ? undefined : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
