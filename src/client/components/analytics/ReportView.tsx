import { CountriesPanel } from "./CountriesPanel";
import { DevicesPanel } from "./DevicesPanel";
import { LimitedPanel } from "./LimitedPanel";
import { LlmPanel } from "./LlmPanel";
import { OperationsPanel } from "./OperationsPanel";
import { PageviewsPanel } from "./PageviewsPanel";
import { ReferrersPanel } from "./ReferrersPanel";
import { StatusPanel } from "./StatusPanel";
import { SummaryStats } from "./SummaryStats";
import { TopDialoguesPanel } from "./TopDialoguesPanel";
import { TopPagesPanel } from "./TopPagesPanel";
import type { Cost, Report } from "./types";

export function ReportView({ report, errors, cost }: { report: Report; errors: string[]; cost: Cost | null }) {
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

      <SummaryStats created={created} limited={limited} totals={report.totals} />

      <PageviewsPanel bucket={report.bucket} series={report.series} />

      <div className="grid gap-4 md:grid-cols-2">
        <TopDialoguesPanel items={report.topDialogues} />
        <ReferrersPanel items={report.referrers} />
        <TopPagesPanel items={report.topPages} />
        <CountriesPanel items={report.countries} />
        <DevicesPanel items={report.devices} total={deviceTotal} />
        <StatusPanel cache={report.cache} latency={report.latency} status={report.status} total={statusTotal} />
        <OperationsPanel events={report.events} llm={report.llm} />
        <LlmPanel cost={cost} llm={report.llm} />
        <LimitedPanel items={report.limited} />
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
