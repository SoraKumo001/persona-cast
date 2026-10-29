import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const TABS = [
  { to: "/admin", label: "ペルソナ・設定", exact: true },
  { to: "/admin/analytics", label: "アクセス状況", exact: false },
] as const;

/** 管理画面の共通枠。ページを切り替えるタブを上に置く */
function AdminLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-zinc-800" aria-label="管理メニュー">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 data-[status=active]:border-indigo-500 data-[status=active]:text-zinc-50"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
