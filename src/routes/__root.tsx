import { Link, Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import React from "react";
import { Mic } from "lucide-react";
import "../client/index.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Persona-Cast | URLをAIペルソナが語り合う" },
    ],
    links: [
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎙️</text></svg>",
      },
    ],
  }),
  component: RootComponent,
});

const NAV = [
  { to: "/", label: "対談" },
  { to: "/memories", label: "記憶検索" },
  { to: "/admin/personas", label: "ペルソナ管理" },
] as const;

function RootComponent() {
  return (
    <html lang="ja">
      <head>
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
