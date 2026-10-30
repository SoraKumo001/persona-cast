import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { bucketLabel, nf } from "./format";
import type { Report } from "./types";

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
      {note ? <p className="mt-0.5 text-[11px] text-zinc-500">{note}</p> : null}
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-100">{value}</dd>
    </div>
  );
}

export interface RankItem {
  /** 対談ID。指定すると対談ページへのリンクにする */
  href?: string;
  key: string;
  label: string;
  sub?: string;
  value: number;
}

export function Ranking({
  items,
  empty = "データがありません",
  total,
}: {
  items: RankItem[];
  empty?: string;
  total?: number;
}) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-zinc-500">{empty}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const label = (
          <span className="min-w-0 flex-1 truncate">
            {i.label}
            {i.sub ? <span className="ml-2 text-xs text-zinc-500">{i.sub}</span> : null}
          </span>
        );
        return (
          <li className="text-sm" key={i.key}>
            <div className="flex items-center justify-between gap-3 text-zinc-200">
              {i.href ? (
                <Link className="flex min-w-0 flex-1 hover:text-indigo-300" params={{ id: i.href }} to="/s/$id">
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 text-zinc-400 tabular-nums">
                {nf.format(i.value)}
                {total ? (
                  <span className="ml-1 text-xs text-zinc-500">({Math.round((i.value / total) * 100)}%)</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-zinc-800">
              <div
                className="h-1 rounded-full bg-indigo-500/70"
                style={{ width: `${Math.max((i.value / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** ページビューの棒グラフ (訪問者は折れ線)。ライブラリを使わないインラインSVG */
export function BarChart({ series, bucket }: { series: Report["series"]; bucket: "HOUR" | "DAY" }) {
  if (series.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500">この期間のデータはまだありません</p>;
  }

  const W = 640;
  const H = 160;
  const pad = { l: 36, r: 8, t: 8, b: 22 };
  const max = Math.max(...series.map((s) => s.pageviews), 1);
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const step = innerW / series.length;
  const barW = Math.max(step * 0.7, 2);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const line = series.map((s, i) => `${pad.l + step * i + step / 2},${y(Math.min(s.visitors, max))}`).join(" ");
  const labelEvery = Math.ceil(series.length / 8);

  return (
    <div>
      <svg aria-label="ページビューの推移" className="w-full" role="img" viewBox={`0 0 ${W} ${H}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              className="text-zinc-800"
              stroke="currentColor"
              strokeWidth="1"
              x1={pad.l}
              x2={W - pad.r}
              y1={y(max * f)}
              y2={y(max * f)}
            />
            <text className="fill-zinc-500" fontSize="10" textAnchor="end" x={pad.l - 6} y={y(max * f) + 3}>
              {nf.format(Math.round(max * f))}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <g key={s.t}>
            <rect
              className="fill-indigo-500/70"
              height={pad.t + innerH - y(s.pageviews)}
              rx="1.5"
              width={barW}
              x={pad.l + step * i + (step - barW) / 2}
              y={y(s.pageviews)}
            >
              <title>{`${bucketLabel(s.t, bucket)}: ${nf.format(s.pageviews)} PV / ${nf.format(s.visitors)} 人`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                className="fill-zinc-500"
                fontSize="10"
                textAnchor="middle"
                x={pad.l + step * i + step / 2}
                y={H - 6}
              >
                {bucketLabel(s.t, bucket)}
              </text>
            )}
          </g>
        ))}
        <polyline className="stroke-emerald-400" fill="none" points={line} strokeWidth="1.5" />
      </svg>
      <p className="mt-1 flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-indigo-500/70" /> ページビュー
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-emerald-400" /> 訪問者
        </span>
      </p>
    </div>
  );
}
