import { Stat } from "./AnalyticsUi";
import { nf } from "./format";
import type { Report } from "./types";

export function SummaryStats({
  totals,
  created,
  limited,
}: {
  totals: Report["totals"];
  created: number;
  limited: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="ページビュー" value={nf.format(totals.pageviews)} />
      <Stat label="訪問者 (推定)" note="日ごとに数える" value={nf.format(totals.visitors)} />
      <Stat label="新しい対談" value={nf.format(created)} />
      <Stat label="制限で断った (429)" value={nf.format(limited)} />
      <Stat label="ボットの閲覧 (除外)" value={nf.format(totals.botPageviews)} />
    </div>
  );
}
