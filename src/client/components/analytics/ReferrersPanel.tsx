import { Panel, Ranking } from "./AnalyticsUi";
import type { Report } from "./types";

export function ReferrersPanel({ items }: { items: Report["referrers"] }) {
  return (
    <Panel title="流入元 (参照元サイト)">
      <Ranking
        empty="参照元のある閲覧はまだありません"
        items={items.map((r) => ({ key: r.host, label: r.host, value: r.count }))}
      />
    </Panel>
  );
}
