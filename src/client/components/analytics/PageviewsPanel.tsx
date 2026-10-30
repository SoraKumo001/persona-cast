import { BarChart, Panel } from "./AnalyticsUi";
import type { Report } from "./types";

export function PageviewsPanel({ series, bucket }: { series: Report["series"]; bucket: "HOUR" | "DAY" }) {
  return (
    <Panel title="ページビューの推移">
      <BarChart bucket={bucket} series={series} />
    </Panel>
  );
}
