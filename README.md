# Persona-Cast 🎙️

URLを指定すると、設定したAIペルソナたちが内容について過去の対談記憶を引き出しながらリアルタイムに語り合うWebアプリケーションです。

---

## 技術スタック & アーキテクチャ

- **フロントエンド & SSR**: **TanStack Start** (`@tanstack/react-start` + `@tanstack/react-router`)
  - サーバーサイドレンダリング (SSR) による高速な初期ロードとSEO親和性
  - React 19, Tailwind CSS v4, Lucide Icons
- **Cloudflare インテグレーション**:
  - **`@cloudflare/vite-plugin` v2** (`2.0.0-beta.v.7`)
  - **Cloudflare CLI (`cf`)**: `cf dev`, `cf deploy`, `cf d1`, `cf workers types`
  - **`cloudflare.config.ts`**: 型安全な Cloudflare ワーカー & バインディング定義
- **データベース & ORM**: **Cloudflare D1** + **Drizzle ORM 1.x** (`^1.0.0-rc.5`)
- **埋め込みモデル (Embedding)**: **Cloudflare Workers AI** (`@cf/baai/bge-m3`, 1024次元)
- **ベクトル検索**: **Cloudflare Vectorize** (`persona-cast-memories`)
- **対話LLM**: **OpenCode Go API** (`https://opencode.ai/inference/go/openai/v1`)
  - `deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k3.1-pro` 等のオープンウェイト系モデルを横断利用

---

## ディレクトリ構成

```text
persona-cast/
├── cloudflare.config.ts        # cf CLI 用ワーカー設定 (D1, Vectorize, AI, 環境変数)
├── drizzle.config.ts           # Drizzle 1.x マイグレーション設定
├── tsr.config.json             # TanStack Router ルート生成設定
├── package.json
├── vite.config.ts              # Vite + TanStack Start + @cloudflare/vite-plugin v2
├── migrations/                 # D1 SQLマイグレーションファイル
├── src/
│   ├── server.ts               # Cloudflare Workers エントリ (SSR + API / SSEルーター)
│   ├── router.tsx              # TanStack Router 定義
│   ├── client.tsx              # TanStack Start クライアントハイドレーション
│   ├── routes/
│   │   ├── __root.tsx          # HTMLシェル & HeadContent / Scripts
│   │   └── index.tsx           # SSR メインページ
│   ├── worker/                 # バックエンドサービス (D1, Vectorize, LLM, スクレイパー)
│   │   ├── services/
│   │   │   ├── scraper.ts      # URLコンテンツ抽出
│   │   │   ├── memory.ts       # Workers AI Embedding (@cf/baai/bge-m3) & Vectorize 検索
│   │   │   ├── llm.ts          # OpenCode Go API ストリーミング
│   │   │   └── dialogue.ts     # 過去記憶引用プロンプト & ターン進行 & 記憶定着
│   │   └── routes/             # APIエンドポイント (/api/personas, /api/sessions, /api/memories)
│   └── client/                 # UIコンポーネント (Stage, MemoryExplorer, PersonaManager)
└── README.md
```

---

## セットアップ & 開発手順

### 1. 依存関係のインストール
```bash
bun install
# または npm install
```

### 2. 環境変数設定 (`.dev.vars`)
`.dev.vars.example` をコピーして `.dev.vars` を作成し、OpenCode Go の API キーを設定します。
```bash
cp .dev.vars.example .dev.vars
```

```env
OPENCODE_API_KEY="your-opencode-api-key-here"
OPENCODE_BASE_URL="https://opencode.ai/inference/go/openai/v1"
OPENCODE_DEFAULT_MODEL="deepseek-v4.1-flash"
EMBEDDING_MODEL="@cf/baai/bge-m3"
```

> **Note**: APIキー未設定の場合でも、ローカルシミュレーション対話エンジンによりUIと過去記憶引き出しのフローを確認できます。

### 3. D1 データベースのローカルマイグレーション (`cf` CLI)
```bash
bun run d1:migrate:local
```

### 4. 開発サーバーの起動 (`cf dev`)
```bash
bun run dev
# または cf dev
```
TanStack Start による SSR ページと API サーバーがローカル `workerd` ランタイム上で起動します。

---

## Cloudflare への本番デプロイ (`cf` CLI)

### 1. D1 データベース & Vectorize インデックスの準備
```bash
cf d1 create persona-cast-db
cf vectorize create persona-cast-memories --dimensions=1024 --metric=cosine
```
発行された `database_id` を `cloudflare.config.ts` に反映します。

### 2. 本番 D1 へのマイグレーション適用
```bash
bun run d1:migrate
```

### 3. 本番シークレット登録 & デプロイ
```bash
cf workers secrets put OPENCODE_API_KEY
bun run deploy
# または cf deploy
```

---

## 管理者認証 (Cloudflare Access) とアバター (R2)

ペルソナの編集は管理者のみ。`/admin/*` (画面) と `/api/admin/*` (API) を Cloudflare Access で保護します。
Worker 側でも `Cf-Access-Jwt-Assertion` の署名・`aud`・`iss` を検証します (設定が欠けていれば常に拒否)。

1. **R2 バケット作成**: `cf r2 bucket create persona-cast-avatars`
2. **Access アプリ作成** (Zero Trust ダッシュボード → Access → Applications → Self-hosted)
   - パス: `/admin/*` と `/api/admin/*` の2つ
   - ポリシー: 許可する管理者のメールアドレスのみ Allow
   - 発行された **Application Audience (AUD) タグ** と **チームドメイン** (`<team>.cloudflareaccess.com`) を控える
3. **シークレット登録**
   ```bash
   cf workers secrets put ACCESS_TEAM_DOMAIN
   cf workers secrets put ACCESS_AUD
   ```
4. **マイグレーション適用**: `bun run d1:migrate` (`0002_avatars_urls_ogp.sql`)

ローカル開発では `.dev.vars` に `ACCESS_DISABLED="true"` を設定すると、`localhost` に限り検証をスキップします。

## 同一URLの扱い

URLは正規化 (`https` 統一・`www.`/fragment/トラッキングクエリ除去・クエリ整列・canonical 採用) して比較します。
同じページの対談が既にある場合は、再取得・再生成せず保存済みの対談を表示します。
