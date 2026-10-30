import { Metric, Panel, Ranking } from "./AnalyticsUi";
import { nf, pct } from "./format";
import { EVENT_LABELS, type Report } from "./types";

export function OperationsPanel({ events, llm }: { events: Report["events"]; llm: Report["llm"] }) {
  return (
    <Panel title="運用">
      <Ranking
        empty="記録されたイベントはありません"
        items={events.map((e) => ({ key: e.name, label: EVENT_LABELS[e.name] ?? e.name, value: e.count }))}
      />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label="LLM の呼び出し" value={nf.format(llm.calls)} />
        <Metric label="LLM の入力キャッシュ率" value={pct(llm.cacheRate)} />
      </dl>
    </Panel>
  );
}
