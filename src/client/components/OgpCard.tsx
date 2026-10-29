import { ExternalLink } from "lucide-react";
import React from "react";
import { hostOf, type Ogp } from "../lib/api";

interface OgpCardProps {
  loading?: boolean;
  ogp?: Ogp | null;
  summary?: string | null;
  title: string;
  url: string;
}

/** URL先のOGP情報(画像・サイト名)・タイトル・短い要約を表示するカード */
export function OgpCard({ url, title, summary, ogp, loading }: OgpCardProps) {
  const [imageBroken, setImageBroken] = React.useState(false);
  const [faviconBroken, setFaviconBroken] = React.useState(false);
  const imageSrc = imageBroken ? null : ogp?.image;

  return (
    <article
      aria-busy={loading}
      className={`overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 sm:flex sm:items-center ${loading ? "opacity-60" : ""}`}
    >
      {imageSrc ? (
        // OGP画像の標準比率(1.91:1)の枠に、切り抜かず全体が収まるよう表示する
        <div className="aspect-[1.91/1] bg-zinc-800 sm:w-80 sm:shrink-0">
          <img
            alt=""
            className="h-full w-full object-contain"
            height={630}
            loading="lazy"
            onError={() => setImageBroken(true)}
            referrerPolicy="no-referrer"
            src={imageSrc}
            width={1200}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
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
        </div>
        <h2 className="line-clamp-2 text-base leading-snug font-semibold text-zinc-50 sm:text-lg">{title}</h2>
        {summary ? <p className="mt-2 text-sm leading-relaxed text-zinc-300">{summary}</p> : null}
        <a
          className="mt-3 inline-flex max-w-full items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{url}</span>
        </a>
      </div>
    </article>
  );
}
