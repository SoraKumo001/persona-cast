import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, ChevronRight, ImagePlus, Loader2, Plus, RotateCcw, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { ApiError, Persona, api, postJson } from "../client/lib/api";

export const Route = createFileRoute("/admin")({
  component: AdminPersonasPage,
});

const BLANK: Persona = {
  id: "",
  name: "",
  role: "コメンテーター",
  avatar: "🎙️",
  avatarType: "emoji",
  avatarUrl: null,
  themeColor: "#6366f1",
  personality: "",
  speakingStyle: "",
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** 中央を正方形に切り抜き、512px の WebP にして送信サイズを抑える */
async function cropToSquareWebp(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))), "image/webp", 0.9)
  );
}

function AdminPersonasPage() {
  const [personas, setPersonas] = React.useState<Persona[] | null>(null);
  const [draft, setDraft] = React.useState<Persona | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);

  // AI生成: 結果は下書きとして画面に反映するだけで、保存は人が確認してから行う
  const [aiInstruction, setAiInstruction] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [aiPrev, setAiPrev] = React.useState<{ draft: Persona | null } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await api<{ personas: Persona[] }>("/api/admin/personas");
      setPersonas(r.personas);
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiError && [401, 403, 503].includes(err.status)) setDenied(true);
      setError(err instanceof Error ? err.message : String(err));
      setPersonas([]);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!draft) return;
      const body = {
        name: draft.name,
        role: draft.role,
        avatar: draft.avatar,
        themeColor: draft.themeColor,
        personality: draft.personality,
        speakingStyle: draft.speakingStyle,
      };
      const res = draft.id
        ? await postJson<{ persona: Persona }>(`/api/admin/personas/${draft.id}`, body, "PUT")
        : await postJson<{ persona: Persona }>("/api/admin/personas", body);
      setDraft(res.persona);
      await load();
    });

  /** modify=true なら編集中の内容を指示で修正し、false なら指示から新しく作る */
  const generate = async (modify: boolean) => {
    const instruction = aiInstruction.trim();
    if (!instruction || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const base =
        modify && draft
          ? {
              name: draft.name,
              role: draft.role,
              avatar: draft.avatar,
              themeColor: draft.themeColor,
              personality: draft.personality,
              speakingStyle: draft.speakingStyle,
            }
          : undefined;
      const res = await postJson<{ draft: Pick<Persona, "name" | "role" | "avatar" | "themeColor" | "personality" | "speakingStyle"> }>(
        "/api/admin/personas/generate",
        { instruction, base }
      );
      setAiPrev({ draft });
      // 修正のときは id・画像アバターを維持し、新規のときは未保存の新規ペルソナにする
      setDraft(modify && draft ? { ...draft, ...res.draft } : { ...BLANK, ...res.draft });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const undoAi = () => {
    if (!aiPrev) return;
    setDraft(aiPrev.draft);
    setAiPrev(null);
  };

  const uploadAvatar = (file: File) =>
    run(async () => {
      if (!draft?.id) throw new Error("先にペルソナを保存してから画像を設定してください");
      if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選択してください");
      const blob = await cropToSquareWebp(file);
      if (blob.size > MAX_AVATAR_BYTES) throw new Error("画像が大きすぎます (2MB以下)");
      const res = await api<{ persona: Persona }>(`/api/admin/personas/${draft.id}/avatar`, {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: blob,
      });
      setDraft(res.persona);
      await load();
    });

  const removeAvatar = () =>
    run(async () => {
      if (!draft?.id) return;
      await api(`/api/admin/personas/${draft.id}/avatar`, { method: "DELETE" });
      setDraft({ ...draft, avatarType: "emoji", avatarUrl: null });
      await load();
    });

  const setArchived = (p: Persona, archive: boolean) =>
    run(async () => {
      await api(`/api/admin/personas/${p.id}${archive ? "" : "/restore"}`, { method: archive ? "DELETE" : "POST" });
      if (draft?.id === p.id) setDraft(null);
      await load();
    });

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

  const field = "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-indigo-500";
  const set = (patch: Partial<Persona>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const renderPersonaItem = (p: Persona) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => setDraft(p)}
        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
          draft?.id === p.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
        } ${p.archivedAt ? "opacity-60" : ""}`}
      >
        <PersonaAvatar {...p} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-zinc-50">{p.name}</span>
          <span className="block truncate text-xs text-zinc-500">{p.archivedAt ? "アーカイブ済み" : p.role}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-8">
      <DailyLimitPanel />
      <div className="grid gap-8 md:grid-cols-[18rem_1fr]">
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">ペルソナ管理</h1>
          <button
            type="button"
            onClick={() => setDraft({ ...BLANK })}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
          >
            <Plus className="h-3.5 w-3.5" /> 新規
          </button>
        </div>
        {personas === null ? (
          <p className="text-sm text-zinc-500">読み込み中…</p>
        ) : (
          <>
            <ul className="space-y-1.5">{personas.filter((p) => !p.archivedAt).map(renderPersonaItem)}</ul>

            {/* アーカイブ済みは、開く操作をするまで見えない場所に置く */}
            {personas.some((p) => p.archivedAt) && (
              <details className="group pt-2" open={!!draft?.archivedAt}>
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  アーカイブ済み ({personas.filter((p) => p.archivedAt).length})
                </summary>
                <ul className="mt-2 space-y-1.5">{personas.filter((p) => p.archivedAt).map(renderPersonaItem)}</ul>
              </details>
            )}
          </>
        )}
      </aside>

      <section>
        <div className="mb-6 space-y-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Sparkles className="h-4 w-4 text-indigo-300" /> AIで生成・修正
          </h2>
          <label htmlFor="ai-instruction" className="sr-only">
            AIへの指示
          </label>
          <textarea
            id="ai-instruction"
            rows={2}
            maxLength={500}
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            placeholder={draft ? "例: もっと辛口に / 口調を関西弁に / 一人称を「僕」に" : "例: 皮肉屋のベテラン編集者 / 子どもにもわかりやすく話す科学の先生"}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-indigo-500"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={aiBusy || !aiInstruction.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              新しく作る
            </button>
            {draft && (
              <button
                type="button"
                onClick={() => generate(true)}
                disabled={aiBusy || !aiInstruction.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/50 px-3.5 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" /> 編集中の内容を修正
              </button>
            )}
            {aiPrev && (
              <button
                type="button"
                onClick={undoAi}
                disabled={aiBusy}
                className="inline-flex items-center gap-1.5 px-2 py-2 text-xs text-zinc-400 hover:text-zinc-100"
              >
                <Undo2 className="h-3.5 w-3.5" /> 元に戻す
              </button>
            )}
            {aiBusy && <span className="text-xs text-zinc-400">生成中…</span>}
          </div>
          {aiPrev && !aiBusy && (
            <p className="text-xs text-zinc-400">AIの下書きを反映しました。内容を確認・調整して「保存」してください。</p>
          )}
          {aiError && (
            <p role="alert" className="text-xs text-red-300">
              {aiError}
            </p>
          )}
        </div>

        {!draft ? (
          <p className="py-16 text-center text-sm text-zinc-500">左の一覧から選ぶか、「新規」で作成します。</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="space-y-5"
          >
            <div className="flex items-center gap-4">
              <PersonaAvatar {...draft} size={72} />
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 ${
                      !draft.id || busy ? "pointer-events-none opacity-40" : ""
                    }`}
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> 画像を選択
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) uploadAvatar(file);
                      }}
                    />
                  </label>
                  {draft.avatarType === "image" && (
                    <button
                      type="button"
                      onClick={removeAvatar}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> 画像を外す
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  {draft.id ? "中央を正方形に切り抜いて保存されます (PNG/JPEG/WebP)" : "画像は保存後に設定できます"}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-zinc-400">
                名前
                <input required className={field} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs text-zinc-400">
                肩書き
                <input className={field} value={draft.role} onChange={(e) => set({ role: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs text-zinc-400">
                絵文字 (画像がないときの表示)
                <input className={field} value={draft.avatar} maxLength={8} onChange={(e) => set({ avatar: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs text-zinc-400">
                テーマ色
                <input
                  type="color"
                  className="h-[38px] w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-1"
                  value={draft.themeColor}
                  onChange={(e) => set({ themeColor: e.target.value })}
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs text-zinc-400">
              性格・価値観
              <textarea required rows={4} className={field} value={draft.personality} onChange={(e) => set({ personality: e.target.value })} />
            </label>
            <label className="block space-y-1 text-xs text-zinc-400">
              口調・話し方
              <textarea required rows={3} className={field} value={draft.speakingStyle} onChange={(e) => set({ speakingStyle: e.target.value })} />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存
              </button>
              {draft.id &&
                (draft.archivedAt ? (
                  <button
                    type="button"
                    onClick={() => setArchived(draft, false)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100"
                  >
                    <RotateCcw className="h-4 w-4" /> 復元
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setArchived(draft, true)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-red-300"
                  >
                    <Archive className="h-4 w-4" /> アーカイブ
                  </button>
                ))}
            </div>
          </form>
        )}
      </section>
      </div>
    </div>
  );
}

/** 1日に新しく作れる対談の総数 (全利用者の合計)。日本時間の0時にリセットされる */
function DailyLimitPanel() {
  const [info, setInfo] = React.useState<{ dailyLimit: number; todayCount: number; maxDailyLimit: number } | null>(null);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    api<{ dailyLimit: number; todayCount: number; maxDailyLimit: number }>("/api/admin/settings")
      .then((r) => {
        setInfo(r);
        setValue(String(r.dailyLimit));
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

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
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="space-y-1">
        <label htmlFor="daily-limit" className="block text-sm font-semibold text-zinc-100">
          1日の対談数の上限
        </label>
        <p className="text-xs text-zinc-500">
          全員の合計で、1日に新しく作れる対談の数です (日本時間の0時にリセット)。0 にすると新規作成を止めます。
        </p>
      </div>
      <input
        id="daily-limit"
        type="number"
        min={0}
        max={info.maxDailyLimit}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-indigo-500"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存
      </button>
      <p className="text-sm text-zinc-400" aria-live="polite">
        本日 <span className="font-semibold text-zinc-100">{info.todayCount}</span> / {info.dailyLimit} 件
        {message && <span className={`ml-3 ${message.ok ? "text-emerald-400" : "text-red-300"}`}>{message.text}</span>}
      </p>
    </form>
  );
}
