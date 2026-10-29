import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // index.html によるSPAフォールバックを無効化し、SSR (TanStack Start) に処理させる
  appType: "custom",
  environments: {
    client: {
      build: { rollupOptions: { input: "src/client.tsx" } },
    },
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    tanstackStart(),
    react(),
    tailwindcss(),
  ],
});
