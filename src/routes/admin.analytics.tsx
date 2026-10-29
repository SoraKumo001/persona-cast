import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import React from "react";
import { api } from "../client/lib/api";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

type RangeKey = "24h" | "7d" | "30d";
const RANGE_LABELS: Record<RangeKey, string> = { "24h": "24時間", "7d": "7日間", "30d": "30日間" };

interface Count {
  count: number;
}
interface Report {
  bucket: "HOUR" | "DAY";
  cache: { hit: number; miss: number; none: number; hitRate: number | null };
  countries: (Count & { country: string })[];
  devices: (Count & { device: string })[];
  events: (Count & { name: string })[];
  latency: { p50: number; p95: number } | null;
  limited: (Count & { route: string })[];
  llm: { calls: number; inputTokens: number; cachedTokens: number; cacheRate: number | null };
  range: RangeKey;
  referrers: (Count & { host: string })[];
  series: { t: string; pageviews: number; visitors: number }[];
  status: (Count & { cls: string })[];
  topDialogues: (Count & { id: string; title: string | null; genre: string | null })[];
  topPages: (Count & { route: string })[];
  totals: { pageviews: number; visitors: number; botPageviews: number };
}
type AnalyticsResponse =
  | { configured: false; hasDataset: boolean }
  | { configured: true; report: Report; errors: string[] };

const EVENT_LABELS: Record<string, string> = {
  dialogue_created: "新しく作られた対談",
  adult_blocked: "18禁として断った送信",
  daily_limit_reached: "1日の上限で断った送信",
};
const DEVICE_LABELS: Record<string, string> = {
  pc: "PC",
  mobile: "スマートフォン",
  tablet: "タブレット",
  bot: "ボット",
};
const ROUTE_LABELS: Record<string, string> = {
  "/": "トップ",
  "/memories": "記憶検索",
  "/s/:id": "対談ページ",
  other: "その他のパス",
};

const nf = new Intl.NumberFormat("ja-JP");
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Analytics Engine の時刻 (UTC, "YYYY-MM-DD HH:MM:SS") を日本時間のラベルにする */
function bucketLabel(t: string, bucket: "HOUR" | "DAY"): string {
  const d = new Date(`${t.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) {
    return t;
  }
  return bucket === "HOUR"
    ? d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric" }).replace(/\s/gu, "")
    : d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

function AnalyticsPage() {
  const [range, setRange] = React.useState<RangeKey>("24h");
  const [data, setData] = React.useState<AnalyticsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<AnalyticsResponse>(`/api/admin/analytics?range=${range}`)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">アクセス状況</h1>
        <fieldset className="m-0 flex gap-1 border-0 p-0">
          <legend className="sr-only">期間</legend>
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button
              aria-pressed={range === k}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                range === k
                  ? "border-indigo-500 bg-indigo-500/15 text-indigo-100"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
              }`}
              key={k}
              onClick={() => setRange(k)}
              type="button"
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </fieldset>
      </div>

      <AnalyticsBody data={data} error={error} />
    </div>
  );
}

function AnalyticsBody({ data, error }: { data: AnalyticsResponse | null; error: string | null }) {
  if (error) {
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…
      </p>
    );
  }
  if (!data.configured) {
    return <SetupNotice hasDataset={data.hasDataset} />;
  }
  return <ReportView errors={data.errors} report={data.report} />;
}

function SetupNotice({ hasDataset }: { hasDataset: boolean }) {
  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-300">
      <h2 className="font-semibold text-zinc-100">集計を表示するための設定が未完了です</h2>
      <p>
        アクセスの記録は Workers Analytics Engine に保存されます
        {hasDataset ? "" : " (このWorkerにはデータセットのバインディングがありません)"}。
        画面に出すには、次の2つのシークレットを設定してください。
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Cloudflare ダッシュボードで、権限が「アカウント &gt; Account Analytics &gt; 読み取り」だけの API
          トークンを作る
        </li>
        <li>
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">CF_ACCOUNT_ID</code> (アカウントID) と{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">CF_API_TOKEN</code> を{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">cf workers secrets update</code> で登録する
        </li>
      </ol>
      <p className="text-xs text-zinc-500">
        ローカル開発 (cf dev) では、記録先のデータセットに問い合わせできないため、集計は表示できません。
      </p>
    </div>
  );
}

function ReportView({ report, errors }: { report: Report; errors: string[] }) {
  const created = report.events.find((e) => e.name === "dialogue_created")?.count ?? 0;
  const limited = report.limited.reduce((n, l) => n + l.count, 0);
  const deviceTotal = report.devices.reduce((n, d) => n + d.count, 0);
  const statusTotal = report.status.reduce((n, s) => n + s.count, 0);

  return (
    <>
      {errors.length > 0 && (
        <details className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
          <summary className="cursor-pointer">
            一部の集計を取得できませんでした ({errors.length}件)。記録を始めたばかりで、データがまだ無い場合もあります。
          </summary>
          <ul className="mt-2 space-y-1 break-all text-zinc-500">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="ページビュー" value={nf.format(report.totals.pageviews)} />
        <Stat label="訪問者 (推定)" note="日ごとに数える" value={nf.format(report.totals.visitors)} />
        <Stat label="新しい対談" value={nf.format(created)} />
        <Stat label="制限で断った (429)" value={nf.format(limited)} />
        <Stat label="ボットの閲覧 (除外)" value={nf.format(report.totals.botPageviews)} />
      </div>

      <Panel title="ページビューの推移">
        <BarChart bucket={report.bucket} series={report.series} />
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="よく見られている対談">
          <Ranking
            empty="まだ閲覧がありません"
            items={report.topDialogues.map((d) => ({
              key: d.id,
              label: d.title ?? d.id,
              sub: d.genre ?? undefined,
              value: d.count,
              href: d.title ? d.id : undefined,
            }))}
          />
        </Panel>
        <Panel title="流入元 (参照元サイト)">
          <Ranking
            empty="参照元のある閲覧はまだありません"
            items={report.referrers.map((r) => ({ key: r.host, label: r.host, value: r.count }))}
          />
        </Panel>
        <Panel title="ページ別">
          <Ranking
            items={report.topPages.map((p) => ({
              key: p.route,
              label: ROUTE_LABELS[p.route] ?? p.route,
              value: p.count,
            }))}
          />
        </Panel>
        <Panel title="国・地域">
          <Ranking items={report.countries.map((c) => ({ key: c.country, label: c.country, value: c.count }))} />
        </Panel>
        <Panel title="端末">
          <Ranking
            items={report.devices.map((d) => ({
              key: d.device,
              label: DEVICE_LABELS[d.device] ?? d.device,
              value: d.count,
            }))}
            total={deviceTotal}
          />
        </Panel>
        <Panel title="応答の状態">
          <Ranking
            items={report.status.map((s) => ({ key: s.cls, label: s.cls, value: s.count }))}
            total={statusTotal}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Metric label="エッジのキャッシュ HIT 率" value={pct(report.cache.hitRate)} />
            <Metric
              label="応答時間 p50 / p95"
              value={report.latency ? `${nf.format(report.latency.p50)} / ${nf.format(report.latency.p95)} ms` : "—"}
            />
          </dl>
        </Panel>
        <Panel title="運用">
          <Ranking
            empty="記録されたイベントはありません"
            items={report.events.map((e) => ({ key: e.name, label: EVENT_LABELS[e.name] ?? e.name, value: e.count }))}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Metric label="LLM の呼び出し" value={nf.format(report.llm.calls)} />
            <Metric label="LLM の入力キャッシュ率" value={pct(report.llm.cacheRate)} />
          </dl>
        </Panel>
        <Panel title="制限・上限で断ったリクエスト">
          <Ranking
            empty="ありません"
            items={report.limited.map((l) => ({
              key: l.route,
              label: ROUTE_LABELS[l.route] ?? l.route,
              value: l.count,
            }))}
          />
        </Panel>
      </div>

      <p className="text-xs text-zinc-500">
        集計は Workers Analytics Engine に記録した値です (保持は約3か月、多いときはサンプリングされます)。
        生のIPは保存せず、訪問者は日ごとのハッシュで数えています。
        アプリ内の画面遷移はサーバーへのページ取得を伴わないため、ページビューにはサーバーが HTML
        を返した回数だけが入ります。
      </p>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
      {note ? <p className="mt-0.5 text-[11px] text-zinc-500">{note}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-100">{value}</dd>
    </div>
  );
}

interface RankItem {
  /** 対談ID。指定すると対談ページへのリンクにする */
  href?: string;
  key: string;
  label: string;
  sub?: string;
  value: number;
}

function Ranking({
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
function BarChart({ series, bucket }: { series: Report["series"]; bucket: "HOUR" | "DAY" }) {
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
