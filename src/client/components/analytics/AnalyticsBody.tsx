import { Loader2 } from "lucide-react";
import { ReportView } from "./ReportView";
import { SetupNotice } from "./SetupNotice";
import type { AnalyticsResponse } from "./types";

export function AnalyticsBody({ data, error }: { data: AnalyticsResponse | null; error: string | null }) {
  if (error) {
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…
      </p>
    );
  }
  if (!data.configured) {
    return <SetupNotice hasDataset={data.hasDataset} />;
  }
  return <ReportView cost={data.cost} errors={data.errors} report={data.report} />;
}
