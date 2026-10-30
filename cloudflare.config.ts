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
        id: "540e1319-2d21-485a-81bf-4c748450be6d",
      }),
      VECTORIZE: bindings.vectorize({
        name: "persona-cast-memories",
      }),
      AI: bindings.ai({}),
      // シークレット: ローカルは .dev.vars、本番は `cf workers secrets update` で設定
      OPENCODE_API_KEY: bindings.secret(),
      ACCESS_TEAM_DOMAIN: bindings.secret(),
      ACCESS_AUD: bindings.secret(),
      ACCESS_DISABLED: bindings.secret(), // ローカル開発専用 (localhost でのみ有効)
      // A/B比較用: "off" で対談前の立場生成 (Phase 1) を止める。未設定は ON のまま
      STANCE_PILOT: bindings.secret(),
      AVATARS: bindings.r2({ name: "persona-cast-avatars" }),
      // アクセス状況: 記録先のデータセット名は src/worker/services/analytics-track.ts の DATASET と同じにする
      ANALYTICS: bindings.analyticsEngineDataset({ name: "persona_cast_events" }),
      ANALYTICS_SALT: bindings.secret(),
      CF_ACCOUNT_ID: bindings.secret(),
      CF_API_TOKEN: bindings.secret(), // 権限は Account Analytics の読み取りだけ
      WEB_ANALYTICS_TOKEN: bindings.text(""), // Web Analytics のサイトトークン (空ならビーコンを出さない)
      // 費用の試算に使う LLM の単価 (100万トークンあたり)。入力と出力の両方が入ったときだけ、管理画面に金額を出す
      LLM_PRICE_INPUT: bindings.text(""),
      LLM_PRICE_OUTPUT: bindings.text(""),
      LLM_PRICE_CACHED: bindings.text(""), // 空なら入力と同じ単価
      LLM_PRICE_CURRENCY: bindings.text("USD"),
    },
  },
});
