import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import React from "react";
import "../client/index.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Persona-Cast | AIペルソナがURL記事を語り合う対話プラットフォーム (SSR)" },
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

function RootComponent() {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-indigo-500 selection:text-white">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
