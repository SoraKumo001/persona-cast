import React from "react";
import { ExternalLink } from "lucide-react";
import { Ogp, hostOf } from "../lib/api";

interface OgpCardProps {
  url: string;
  title: string;
  summary?: string | null;
  ogp?: Ogp | null;
  loading?: boolean;
}

/** URL先のOGP情報(画像・サイト名)・タイトル・短い要約を表示するカード */
export function OgpCard({ url, title, summary, ogp, loading }: OgpCardProps) {
  const [imageBroken, setImageBroken] = React.useState(false);
  const [faviconBroken, setFaviconBroken] = React.useState(false);
  const showImage = !!ogp?.image && !imageBroken;

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 sm:flex ${loading ? "opacity-60" : ""}`}
      aria-busy={loading}
    >
      {showImage && (
        <div className="aspect-[1.91/1] bg-zinc-800 sm:aspect-auto sm:w-56 sm:shrink-0">
          <img
            src={ogp!.image!}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setImageBroken(true)}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
          {ogp?.favicon && !faviconBroken && (
            <img
              src={ogp.favicon}
              alt=""
              width={14}
              height={14}
              referrerPolicy="no-referrer"
              className="h-3.5 w-3.5 rounded-sm"
              onError={() => setFaviconBroken(true)}
            />
          )}
          <span className="truncate">{ogp?.siteName || hostOf(url)}</span>
        </div>
        <h2 className="line-clamp-2 text-base font-semibold leading-snug text-zinc-50 sm:text-lg">{title}</h2>
        {summary && <p className="mt-2 text-sm leading-relaxed text-zinc-300">{summary}</p>}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex max-w-full items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{url}</span>
        </a>
      </div>
    </article>
  );
}
