import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { THEME_INIT_SCRIPT, ThemeToggle } from "../client/components/ThemeToggle";
import { getWebAnalyticsToken } from "../server-fns/site-meta";
import "../client/index.css";

export const Route = createRootRoute({
  // ビーコンのトークンはデプロイ中は変わらないので、画面遷移のたびに取り直さない
  loader: () => getWebAnalyticsToken(),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Persona-Cast | URLをAIペルソナが語り合う" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "alternate", type: "application/rss+xml", title: "Persona-Cast", href: "/rss.xml" },
    ],
  }),
  component: RootComponent,
});

const NAV = [
  { to: "/", label: "対談" },
  { to: "/memories", label: "記憶検索" },
  { to: "/admin", label: "管理" },
] as const;

function RootComponent() {
  const webAnalyticsToken = Route.useLoaderData();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 管理画面の閲覧は、訪問者の統計に混ぜない
  const showBeacon = !!webAnalyticsToken && !(pathname === "/admin" || pathname.startsWith("/admin/"));

  return (
    // data-theme はスクリプトが描画前に付与するため、サーバー出力との差を許容する
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 固定の文字列 (テーマの初期化) で、利用者の入力は含まない。描画前に実行して画面のちらつきを防ぐ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500 selection:text-white">
        <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link className="flex items-center gap-2 font-semibold tracking-tight" to="/">
              <img
                alt="Persona-Cast"
                className="h-7 w-7 rounded-lg shadow-sm"
                height={28}
                src="/favicon.svg"
                width={28}
              />
              <span className="hidden sm:inline">Persona-Cast</span>
            </Link>
            <nav aria-label="メイン" className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  activeOptions={{ exact: item.to === "/" }}
                  className="rounded-lg px-2.5 py-1.5 whitespace-nowrap text-zinc-400 transition-colors hover:text-zinc-100 data-[status=active]:bg-zinc-800 data-[status=active]:text-zinc-50 sm:px-3"
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                </Link>
              ))}
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">
          <Outlet />
        </main>
        {showBeacon ? (
          <script
            data-cf-beacon={JSON.stringify({ token: webAnalyticsToken })}
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
