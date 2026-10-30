import { Metric, Panel, Ranking } from "./AnalyticsUi";
import { nf, pct } from "./format";
import type { Report } from "./types";

export function StatusPanel({
  status,
  total,
  cache,
  latency,
}: {
  status: Report["status"];
  total: number;
  cache: Report["cache"];
  latency: Report["latency"];
}) {
  return (
    <Panel title="応答の状態">
      <Ranking items={status.map((s) => ({ key: s.cls, label: s.cls, value: s.count }))} total={total} />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label="エッジのキャッシュ HIT 率" value={pct(cache.hitRate)} />
        <Metric
          label="応答時間 p50 / p95"
          value={latency ? `${nf.format(latency.p50)} / ${nf.format(latency.p95)} ms` : "—"}
        />
      </dl>
    </Panel>
  );
}
