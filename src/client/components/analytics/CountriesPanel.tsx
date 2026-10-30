import { Panel, Ranking } from "./AnalyticsUi";
import type { Report } from "./types";

export function CountriesPanel({ items }: { items: Report["countries"] }) {
  return (
    <Panel title="国・地域">
      <Ranking items={items.map((c) => ({ key: c.country, label: c.country, value: c.count }))} />
    </Panel>
  );
}
