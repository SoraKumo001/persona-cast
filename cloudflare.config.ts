import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "persona-cast",
    compatibilityDate: "2025-03-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/server.ts",
    observability: {
      enabled: true,
    },
    env: {
      OPENCODE_BASE_URL: bindings.text("https://opencode.ai/inference/go/openai/v1"),
      OPENCODE_DEFAULT_MODEL: bindings.text("deepseek-v4.1-flash"),
      EMBEDDING_MODEL: bindings.text("@cf/baai/bge-m3"),
      DB: bindings.d1({
        name: "persona-cast-db",
        id: "00000000-0000-0000-0000-000000000000",
      }),
      VECTORIZE: bindings.vectorize({
        name: "persona-cast-memories",
      }),
      AI: bindings.ai({}),
    },
  },
});
