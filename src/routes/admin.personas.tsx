import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, ImagePlus, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { ApiError, Persona, api, postJson } from "../client/lib/api";

export const Route = createFileRoute("/admin/personas")({
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

  return (
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
          <ul className="space-y-1.5">
            {personas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setDraft(p)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    draft?.id === p.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                  } ${p.archivedAt ? "opacity-50" : ""}`}
                >
                  <PersonaAvatar {...p} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-50">{p.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{p.archivedAt ? "アーカイブ済み" : p.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section>
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
  );
}
