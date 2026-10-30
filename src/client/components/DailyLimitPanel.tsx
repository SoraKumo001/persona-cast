import { Loader2, Save } from "lucide-react";
import React from "react";
import { api, errorMessage, postJson } from "../lib/api";

/** 1日に新しく作れる対談の総数 (全利用者の合計)。日本時間の0時にリセットされる */
export function DailyLimitPanel() {
  const [info, setInfo] = React.useState<{ dailyLimit: number; todayCount: number; maxDailyLimit: number } | null>(
    null
  );
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    api<{ dailyLimit: number; todayCount: number; maxDailyLimit: number }>("/api/admin/settings")
      .then((r) => {
        setInfo(r);
        setValue(String(r.dailyLimit));
      })
      .catch(() => undefined);
  }, []);

  if (!info) {
    return null;
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > info.maxDailyLimit) {
      setMessage({ ok: false, text: `0〜${info.maxDailyLimit} の整数を入力してください` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const r = await postJson<typeof info>("/api/admin/settings", { dailyLimit: n }, "PUT");
      setInfo(r);
      setValue(String(r.dailyLimit));
      setMessage({ ok: true, text: "保存しました" });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
      onSubmit={save}
    >
      <div className="space-y-1">
        <label className="block text-sm font-semibold text-zinc-100" htmlFor="daily-limit">
          1日の対談数の上限
        </label>
        <p className="text-xs text-zinc-500">
          全員の合計で、1日に新しく作れる対談の数です (日本時間の0時にリセット)。0 にすると新規作成を止めます。
        </p>
      </div>
      <input
        className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-indigo-500"
        id="daily-limit"
        inputMode="numeric"
        max={info.maxDailyLimit}
        min={0}
        onChange={(e) => setValue(e.target.value)}
        step={1}
        type="number"
        value={value}
      />
      <button
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
        disabled={busy}
        type="submit"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存
      </button>
      <p aria-live="polite" className="text-sm text-zinc-400">
        本日 <span className="font-semibold text-zinc-100">{info.todayCount}</span> / {info.dailyLimit} 件
        {message ? (
          <span className={`ml-3 ${message.ok ? "text-emerald-400" : "text-red-300"}`}>{message.text}</span>
        ) : null}
      </p>
    </form>
  );
}
