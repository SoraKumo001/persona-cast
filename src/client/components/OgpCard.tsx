import { ExternalLink, MessagesSquare } from "lucide-react";
import React from "react";
import { hostOf, isThemeBasedSourceUrl, type Ogp, type SessionMode } from "../lib/api";

interface OgpCardProps {
  loading?: boolean;
  mode?: SessionMode;
  ogp?: Ogp | null;
  /** 論戦など、サイトOGPではなく対談ごとの生成画像を出すときに渡す */
  sessionId?: string;
  sources?: { title: string; url: string }[];
  summary?: string | null;
  title: string;
  url: string;
}

/** URL先のOGP情報(画像・サイト名)・タイトル・短い要約を表示するカード */
export function OgpCard({ url, title, summary, ogp, loading, mode, sources, sessionId }: OgpCardProps) {
  const [imageBroken, setImageBroken] = React.useState(false);
  const [faviconBroken, setFaviconBroken] = React.useState(false);
  const themeBased = mode === "debate" || mode === "heated" || isThemeBasedSourceUrl(url);
  const heated = mode === "heated" || url.startsWith("heated://");
  // 論戦/激論は調査先のOGPではなく、対談ごとに生成した画像をアイキャッチにする
  const preferredImage = themeBased && sessionId ? `/api/sessions/${sessionId}/ogp.png` : ogp?.image;
  const imageSrc = imageBroken ? null : preferredImage;
  const isGeneratedImage = themeBased && !!sessionId && !imageBroken;

  return (
    <article
      aria-busy={loading}
      className={`overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 sm:flex sm:items-center ${loading ? "opacity-60" : ""}`}
    >
      {imageSrc ? (
        // OGP画像の標準比率(1.91:1)。生成画像はカバー、サイト画像は全体が収まるようにする
        <div className={`aspect-[1.91/1] sm:w-80 sm:shrink-0 ${isGeneratedImage ? "" : "bg-zinc-800"}`}>
          <img
            alt=""
            className={`h-full w-full ${isGeneratedImage ? "object-cover" : "object-contain"}`}
            height={630}
            loading="lazy"
            onError={() => setImageBroken(true)}
            referrerPolicy={isGeneratedImage ? undefined : "no-referrer"}
            src={imageSrc}
            width={1200}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
          {themeBased ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                heated ? "bg-rose-500/15 text-rose-200" : "bg-amber-500/15 text-amber-200"
              }`}
            >
              <MessagesSquare className="h-3 w-3" />
              {heated ? "激論" : "論戦"}
            </span>
          ) : (
            <>
              {ogp?.favicon && !faviconBroken && (
                <img
                  alt=""
                  className="h-3.5 w-3.5 rounded-sm"
                  height={14}
                  onError={() => setFaviconBroken(true)}
                  referrerPolicy="no-referrer"
                  src={ogp.favicon}
                  width={14}
                />
              )}
              <span className="truncate">{ogp?.siteName || hostOf(url)}</span>
            </>
          )}
        </div>
        <h2 className="line-clamp-2 text-base leading-snug font-semibold text-zinc-50 sm:text-lg">{title}</h2>
        {summary ? <p className="mt-2 text-sm leading-relaxed text-zinc-300">{summary}</p> : null}
        {themeBased && sources && sources.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-zinc-400">
            <li className="font-medium text-zinc-300">参考にしたページ</li>
            {sources.slice(0, 4).map((s) => (
              <li key={s.url}>
                <a
                  className="inline-flex max-w-full items-center gap-1 text-indigo-300 hover:text-indigo-200"
                  href={s.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.title || s.url}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {themeBased ? null : (
          <a
            className="mt-3 inline-flex max-w-full items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{url}</span>
          </a>
        )}
      </div>
    </article>
  );
}
