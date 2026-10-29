import { Link, Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import React from "react";
import { Mic } from "lucide-react";
import { THEME_INIT_SCRIPT, ThemeToggle } from "../client/components/ThemeToggle";
import "../client/index.css";

export const Route = createRootRoute({
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
  return (
    // data-theme はスクリプトが描画前に付与するため、サーバー出力との差を許容する
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500 selection:text-white">
        <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-white">
                <Mic className="h-4 w-4" />
              </span>
              <span className="hidden sm:inline">Persona-Cast</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm" aria-label="メイン">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-zinc-400 sm:px-3 transition-colors hover:text-zinc-100 data-[status=active]:bg-zinc-800 data-[status=active]:text-zinc-50"
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
        <Scripts />
      </body>
    </html>
  );
}
