import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MemoryExplorer } from "../client/components/MemoryExplorer";

export const Route = createFileRoute("/memories")({
  component: MemoriesPage,
});

function MemoriesPage() {
  const navigate = useNavigate();
  return <MemoryExplorer onOpenSession={(id) => navigate({ to: "/s/$id", params: { id } })} />;
}
