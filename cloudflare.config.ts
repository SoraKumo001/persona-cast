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
        id: "b2c5e638-4f91-4c91-9e28-3d1f5e27a901",
      }),
      VECTORIZE: bindings.vectorize({
        name: "persona-cast-memories",
      }),
      AI: bindings.ai({}),
      // シークレット: ローカルは .dev.vars、本番は `cf workers secrets put` で設定
      OPENCODE_API_KEY: bindings.secret(),
      ACCESS_TEAM_DOMAIN: bindings.secret(),
      ACCESS_AUD: bindings.secret(),
      ACCESS_DISABLED: bindings.secret(), // ローカル開発専用 (localhost でのみ有効)
      AVATARS: bindings.r2({ name: "persona-cast-avatars" }),
      // アクセス状況: 記録先のデータセット名は src/worker/services/analytics-track.ts の DATASET と同じにする
      ANALYTICS: bindings.analyticsEngineDataset({ name: "persona_cast_events" }),
      ANALYTICS_SALT: bindings.secret(),
      CF_ACCOUNT_ID: bindings.secret(),
      CF_API_TOKEN: bindings.secret(), // 権限は Account Analytics の読み取りだけ
      WEB_ANALYTICS_TOKEN: bindings.text(""), // Web Analytics のサイトトークン (空ならビーコンを出さない)
    },
  },
});
