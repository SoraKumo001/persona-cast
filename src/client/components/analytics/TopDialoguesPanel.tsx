import { Panel, Ranking } from "./AnalyticsUi";
import type { Report } from "./types";

export function TopDialoguesPanel({ items }: { items: Report["topDialogues"] }) {
  return (
    <Panel title="よく見られている対談">
      <Ranking
        empty="まだ閲覧がありません"
        items={items.map((d) => ({
          key: d.id,
          label: d.title ?? d.id,
          sub: d.genre ?? undefined,
          value: d.count,
          href: d.title ? d.id : undefined,
        }))}
      />
    </Panel>
  );
}
