import { Panel, Ranking } from "./AnalyticsUi";
import { type Report, ROUTE_LABELS } from "./types";

export function LimitedPanel({ items }: { items: Report["limited"] }) {
  return (
    <Panel title="制限・上限で断ったリクエスト">
      <Ranking
        empty="ありません"
        items={items.map((l) => ({
          key: l.route,
          label: ROUTE_LABELS[l.route] ?? l.route,
          value: l.count,
        }))}
      />
    </Panel>
  );
}
