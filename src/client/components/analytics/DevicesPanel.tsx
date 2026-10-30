import { Panel, Ranking } from "./AnalyticsUi";
import { DEVICE_LABELS, type Report } from "./types";

export function DevicesPanel({ items, total }: { items: Report["devices"]; total: number }) {
  return (
    <Panel title="端末">
      <Ranking
        items={items.map((d) => ({
          key: d.device,
          label: DEVICE_LABELS[d.device] ?? d.device,
          value: d.count,
        }))}
        total={total}
      />
    </Panel>
  );
}
