import { Link } from "@tanstack/react-router";
import React from "react";
import { formatDate, hostOf, type SessionListItem } from "../lib/api";
import { PersonaAvatar } from "./PersonaAvatar";

/** 対談の一覧に並べるカード。トップページとペルソナ別ページで使う */
export function SessionCard({ session: s }: { session: SessionListItem }) {
  // サムネイルは、サイトのOGP画像 → 無い/読み込めなければ対談ごとの生成画像 → それも不可ならジャンル表示
  const sources = [s.ogp?.image, `/api/sessions/${s.id}/ogp.png`].filter(
    (candidate): candidate is string => !!candidate
  );
  const [stage, setStage] = React.useState(0);
  const src = sources[stage];
  const isSiteImage = !!s.ogp?.image && stage === 0;

  return (
    <Link
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-600"
      params={{ id: s.id }}
      to="/s/$id"
    >
      <div className="aspect-[1.91/1] overflow-hidden bg-gradient-to-br from-indigo-950 to-zinc-900">
        {src ? (
          <img
            alt=""
            // サイトの画像は比率が様々なので切り抜かず全体を見せる
            className={`h-full w-full ${isSiteImage ? "bg-zinc-800 object-contain" : "object-cover"}`}
            height={630}
            key={src}
            loading="lazy"
            onError={() => setStage((n) => n + 1)}
            referrerPolicy={isSiteImage ? "no-referrer" : undefined}
            src={src}
            width={1200}
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
        <h2 className="line-clamp-2 text-sm leading-snug font-semibold text-zinc-50">{s.articleTitle}</h2>
        {s.summary ? <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{s.summary}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <ul aria-label="参加者" className="flex -space-x-1.5">
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
