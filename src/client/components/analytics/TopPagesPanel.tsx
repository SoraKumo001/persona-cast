import { Panel, Ranking } from "./AnalyticsUi";
import { type Report, ROUTE_LABELS } from "./types";

export function TopPagesPanel({ items }: { items: Report["topPages"] }) {
  return (
    <Panel title="ページ別">
      <Ranking
        items={items.map((p) => ({
          key: p.route,
          label: ROUTE_LABELS[p.route] ?? p.route,
          value: p.count,
        }))}
      />
    </Panel>
  );
}
