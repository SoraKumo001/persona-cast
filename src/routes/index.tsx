import React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, History, Link2, Loader2, TriangleAlert } from "lucide-react";
import { OgpCard } from "../client/components/OgpCard";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { Persona, UrlPreview, api, postJson } from "../client/lib/api";
import { DEFAULT_PERSONAS } from "../worker/presets";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const TURN_OPTIONS = [4, 6, 8, 12];

function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<UrlPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [personas, setPersonas] = React.useState<Persona[]>(DEFAULT_PERSONAS);
  const [selected, setSelected] = React.useState<string[]>(DEFAULT_PERSONAS.slice(0, 2).map((p) => p.id));
  const [turns, setTurns] = React.useState(6);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<{ personas: Persona[] }>("/api/personas")
      .then(({ personas }) => {
        setPersonas(personas);
        setSelected((prev) => {
          const valid = prev.filter((id) => personas.some((p) => p.id === id));
          return valid.length > 0 ? valid : personas.slice(0, 2).map((p) => p.id);
        });
      })
      .catch(() => {});
  }, []);

  // URL入力が止まったらプレビュー(OGP・要約・既存対談の有無)を取得
  React.useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!isHttpUrl(url)) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<UrlPreview>("/api/sessions/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      })
        .then(setPreview)
        .catch((err) => {
          if (err.name !== "AbortError") setPreviewError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canStart = isHttpUrl(url) && selected.length > 0 && !submitting;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await postJson<{ sessionId: string; existing: boolean }>("/api/sessions", {
        url: url.trim(),
        personaIds: selected,
        totalTurns: turns,
      });
      await navigate({
        to: "/s/$id",
        params: { id: res.sessionId },
        search: res.existing ? {} : { turns },
      });
    } catch (err: any) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  const existingId = preview?.existingSessionId;

  return (
    <form onSubmit={start} className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-3 pt-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">このページ、AIたちに語らせよう</h1>
        <p className="text-sm text-zinc-400">
          記事のURLを貼ると、選んだペルソナが内容について対談します。
        </p>
      </section>

      <section className="space-y-3">
        <label htmlFor="url" className="sr-only">
          記事のURL
        </label>
        <div className="relative">
          <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="url"
            type="url"
            inputMode="url"
            autoFocus
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-4 pl-11 pr-12 text-base text-zinc-50 placeholder-zinc-600 outline-none transition-colors focus:border-indigo-500"
          />
          {previewing && (
            <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />
          )}
        </div>

        <div aria-live="polite">
          {previewError && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {previewError}
            </p>
          )}
          {preview && (
            <div className="space-y-2">
              <OgpCard url={url.trim()} title={preview.title} summary={preview.summary} ogp={preview.ogp} />
              {existingId && (
                <p className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
                  <History className="h-4 w-4 shrink-0" />
                  このページの対談は既にあります。開始すると、保存済みの対談をそのまま表示します。
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">登場するペルソナ</h2>
          <span className="text-xs text-zinc-500">{selected.length}人選択中</span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {personas.map((p) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    on ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                  }`}
                >
                  <PersonaAvatar {...p} size={44} active={on} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-50">{p.name}</span>
                    <span className="block truncate text-xs text-zinc-400">{p.role}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <label htmlFor="turns">発言数</label>
          <select
            id="turns"
            value={turns}
            onChange={(e) => setTurns(Number(e.target.value))}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-100"
          >
            {TURN_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!canStart}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {existingId ? "保存済みの対談を開く" : "対談を始める"}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </button>
      </section>

      {submitError && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {submitError}
        </p>
      )}
    </form>
  );
}
