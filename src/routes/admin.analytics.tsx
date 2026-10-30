import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { AnalyticsBody } from "../client/components/analytics/AnalyticsBody";
import { type AnalyticsResponse, RANGE_LABELS, type RangeKey } from "../client/components/analytics/types";
import { api } from "../client/lib/api";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [range, setRange] = React.useState<RangeKey>("24h");
  const [data, setData] = React.useState<AnalyticsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<AnalyticsResponse>(`/api/admin/analytics?range=${range}`)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">アクセス状況</h1>
        <fieldset className="m-0 flex gap-1 border-0 p-0">
          <legend className="sr-only">期間</legend>
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button
              aria-pressed={range === k}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                range === k
                  ? "border-indigo-500 bg-indigo-500/15 text-indigo-100"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
              }`}
              key={k}
              onClick={() => setRange(k)}
              type="button"
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </fieldset>
      </div>

      <AnalyticsBody data={data} error={error} />
    </div>
  );
}
