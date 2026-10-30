import { createFileRoute } from "@tanstack/react-router";
import { DailyLimitPanel } from "../client/components/DailyLimitPanel";
import { MemorySyncPanel } from "../client/components/MemorySyncPanel";
import { PersonaEditor } from "../client/components/PersonaEditor";

export const Route = createFileRoute("/admin/")({
  component: AdminPersonasPage,
});

function AdminPersonasPage() {
  return (
    <div className="space-y-8">
      <DailyLimitPanel />
      <MemorySyncPanel />
      <PersonaEditor />
    </div>
  );
}
