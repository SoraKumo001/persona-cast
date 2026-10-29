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

### 前提
- **Workers Paid プランが必要です。** OGP 画像の生成に使う WASM が約 12.7MB あり、無料枠のサイズ上限を超えます。
- `cf` CLI でログイン済みで、`cloudflare.config.ts` の `DB.id` (D1 の ID) がデプロイ先アカウントのものと一致していること。

### 1. リソースを作る (初回のみ)
```bash
cf d1 create --name persona-cast-db
cf vectorize create --name persona-cast-memories --index-config-dimensions 1024 --index-config-metric cosine
cf r2 buckets create --name persona-cast-avatars
```
`cf` のコマンドは、名前を位置引数ではなく `--name` で渡します (`cf d1 create persona-cast-db` は「Unknown command」になります)。
実行前に `--dry-run` を付けると、作らずに内容だけ確認できます。
D1 を作ったら、発行された ID (`cf d1 list` でも確認できます) を **`cloudflare.config.ts` の `DB.id` に設定します**。`bun run d1:migrate` はこの ID を読むので、ほかに書く場所はありません。リポジトリの ID (`b2c5e638-…`) は別アカウントのものなので、そのままだと「The database … could not be found」になります。
Analytics Engine のデータセット (`persona_cast_events`) は、デプロイ時に作られる想定です。

### 2. 本番 D1 のマイグレーション (**デプロイより先**)
```bash
bun run d1:migrate
```
新しいコードを先にデプロイすると、起動時の自動追加 (`ensureDatabaseTables`) が列を足し、その後のマイグレーションが「列が重複」で失敗します。必ずマイグレーションを先に流してください。

### 3. シークレットの準備
**`cf workers secrets update` は、Worker がまだ存在しない初回には使えません** (「This Worker does not exist on your account」になります)。初回は、シークレットをファイルに書き、デプロイと一緒にアップロードします。

`.dev.vars.production` を作ります (`.dev.vars.*` は git の管理外です。**コミットしないこと**)。

```dotenv
OPENCODE_API_KEY=...
ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
ACCESS_AUD=...
# 任意
ANALYTICS_SALT=...
CF_ACCOUNT_ID=...
CF_API_TOKEN=...
```

| シークレット | 用途 | |
|---|---|---|
| `OPENCODE_API_KEY` | LLM。未設定だとデモ用の応答になる | 必須 |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | 管理画面の認証 (後述)。未設定だと管理 API は常に拒否 | 必須 |
| `ANALYTICS_SALT` | 訪問者ハッシュのソルト (長いランダムな文字列) | 任意 |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | アクセス状況の集計 (トークンの権限は Account Analytics の読み取りだけ) | 任意 |

`ACCESS_DISABLED` は本番では設定しません (localhost でしか効きませんが、念のため)。
`ACCESS_AUD` は、手順6で Access のアプリを作ってから分かります。先にデプロイしたい場合は、まず必須のうち `OPENCODE_API_KEY` だけを入れ、あとから追加できます (手順4の「2回目以降」)。

### 4. デプロイ
```bash
bun run check && bun test && bun run build   # 事前確認 (任意)
cf deploy --secrets-file .dev.vars.production --dry-run   # アップロードせずに確認
cf deploy --secrets-file .dev.vars.production             # 初回
```
- ファイルに書いたキーのうち、`cloudflare.config.ts` で宣言済みのものだけがアップロードされます。
- **2回目以降**にシークレットだけ変えるときは、Worker が存在するので `cf workers secrets update <名前> --worker persona-cast --text <値>` (複数なら `cf workers secrets bulk`) が使えます。値をコマンドラインに書くとシェルの履歴に残る点に注意してください。
- `cf deploy` は、設定にある資源 (D1・R2・Vectorize など) が無い場合に自動で作る (`--provision`、既定で有効) 場合があります。手順1で先に作ってある前提で、足りないものだけが作られます。

### 5. 独自ドメイン
ダッシュボードの Workers > 該当 Worker > Settings > Domains & Routes で、公開するドメイン (`croud.jp`) を追加します。**`*.workers.dev` では Cache API が効きません。**

### 6. 管理者認証 (Cloudflare Access)
ペルソナの編集・設定・アクセス状況は管理者のみです。`/admin` と `/admin/*` (画面) と `/api/admin/*` (API) を Cloudflare Access で保護します。
Worker 側でも `Cf-Access-Jwt-Assertion` の署名・`aud`・`iss` を検証します (設定が欠けていれば常に拒否)。

1. Zero Trust ダッシュボード > Access > Applications > Self-hosted でアプリを作る
   - パス: `/admin` (画面の本体。`/admin/*` だけでは `/admin` が含まれない)、`/admin/*`、`/api/admin/*` の3つ。旧URLの `/admin/personas` は `/admin` に転送します
   - ポリシー: 許可する管理者のメールアドレスのみ Allow
2. 発行された **Application Audience (AUD) タグ** と **チームドメイン** (`<team>.cloudflareaccess.com`) を、手順3の `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` に登録する

ローカル開発では `.dev.vars` に `ACCESS_DISABLED="true"` を設定すると、`localhost` に限り検証をスキップします。

### 7. 任意の設定
- アクセス状況の集計: 手順3の `CF_ACCOUNT_ID` / `CF_API_TOKEN` を登録すると `/admin/analytics` に出ます (詳細は「アクセス状況」)。
- Web Analytics: ダッシュボードで有効にします (詳細は「アクセス状況」)。

### 8. デプロイ後の確認
1. `/` と `/s/<id>` が開く。
2. 新しい URL を送ると対談が生成される (LLM のキーの確認)。
3. `/admin` が Access のログインを経由し、ペルソナを編集できる。
4. `/api/health` が `hasApiKey` / `hasAiBinding` / `hasVectorizeBinding` とも `true`。
5. `curl -I https://<ドメイン>/` を2回送り、2回目に `x-cache: HIT` が付く (独自ドメインのキャッシュ)。
6. `/api/sessions/<id>/ogp.png` が表示される (WASM が動いている確認)。
7. 管理画面で、1日の対談数の上限 (既定 1000) を確認する。

## 同一URLの扱い

URLは正規化 (`https` 統一・`www.`/fragment/トラッキングクエリ除去・クエリ整列・canonical 採用) して比較します。
同じページの対談が既にある場合は、再取得・再生成せず保存済みの対談を表示します。

## 対談ごとのOGP画像

`GET /api/sessions/:id/ogp.png` が、対談ごとの OGP 画像 (1200x630 PNG) を [wasm-html-to-image](https://github.com/SoraKumo001/wasm-html-to-image) で生成します。
記事タイトル・要約・参加ペルソナ(アバター)の発言抜粋・人数/発言数を載せ、`/s/$id` の `og:image` / `twitter:card` に設定されます。

- 生成結果は R2 (`ogp/{sessionId}/{テンプレート版}-{発言数}.png`) にキャッシュします。発言数が変わると別キーになるため、対談の途中状態が固定化されることはありません。デザインを変えたら `ogp-image.ts` の `TEMPLATE_VERSION` を上げてください。
- フォント (Noto Sans JP) は生成時に Google Fonts から自動取得されます。
- WASM は約12.7MB (gzip 約4.4MB) です。Workers の無料プラン上限 (圧縮3MB) を超えるため、**Workers Paid プランが必要**です。

## 自動編成とジャンル

入力は記事のURLだけです。`POST /api/sessions` が、1回のLLM呼び出しで **短い要約・ジャンル・参加ペルソナ(3〜4人。ペルソナが3人未満なら全員)** を決め、発言数は人数に応じて自動 (6〜9) になります。

- ジャンルは固定リスト (`services/genres.ts`) から選びます。LLMが使えない/失敗したときは、キーワード分類とURLに基づくペルソナ選定にフォールバックします。
- トップページ(`/`)は対談の一覧です。ジャンルで絞り込めます (`/?genre=...`)。サムネイルは対談ごとのOGP画像で、対談完了時に先に生成します。
- `/memories` は過去の対談記憶の検索です。
- マイグレーション `0003_genre.sql` を `bun run d1:migrate` で適用してください。

## キャッシュ (Cache API)

Worker の動的な応答は Cache-Control を付けてもエッジに自動ではキャッシュされないため、`src/worker/cache.ts` が `caches.default` に入れます (`src/server.ts` の入口で包んでいます)。

- ハンドラが `cacheFor(秒数)` で申告した応答だけをキャッシュします。申告がなければキャッシュしません。
- 対象 (エッジの保持): 発言が保存された対談 (`/s/:id` と `/api/sessions/:id`、600秒)、トップと対談一覧 (15秒。新しい対談が増えるため短い)、ペルソナ一覧 (60秒)、OGP画像 (3600秒)、アバター (1年・immutable)。
- 対象外: 生成前・生成中の対談、SSE、POST、認証ヘッダ付きのリクエスト。`/admin` 以下と `/api/admin/*` には `private, no-store` を付けます。
- **ブラウザには、エッジとは別の `Cache-Control` を返します。** 一覧・対談・ペルソナ一覧は `no-cache` (毎回エッジに確認する。エッジのキャッシュは使える)、OGP画像は1時間、アバターは1年です。ブラウザに古い応答が残って、画面遷移で古い一覧が出る、といったことを防ぎます。
- 応答には `X-Cache: HIT|MISS` が付きます。ペルソナ編集の反映は最大10分遅れることがあります。
- Cloudflare のゾーン設定の **Browser Cache TTL** は「Respect Existing Headers」にしてください。時間 (例: 4時間) を指定すると、アプリが指定した値より長くブラウザに保存されます。
- 画面遷移 (クライアント側) でも、古いデータを先に見せず、取り直してから表示します (`src/router.tsx` の `defaultStaleReloadMode: "blocking"`)。
- Cache API は独自ドメイン (ゾーン) でのみ効きます。`*.workers.dev` では何もしません。

## 公開APIの保護

認証なしの公開エンドポイントは LLM・Workers AI を呼ぶため、悪用でコストが膨らまないようにしています。

- `GET /api/sessions/:id/stream`: 発言が保存済みの対談は 409 で拒否し、生成は同時に1つだけ (`sessions.generating_at` に印を付ける。10分で失効)。発言数は参加人数から決まり、`turns` や `model` はクライアントから指定できません。
- レート制限 (IPごと、D1 の `rate_limits` テーブル): `POST /api/sessions` は新規の記事取得のみ 10回/時かつ30回/日 (日本時間の0時区切り)、`/stream` は 20回/時、`/api/memories/search` は 60回/分。超えると 429 (`Retry-After` 付き)。IP は `CF-Connecting-IP` を使い、IPv6 は /64 単位でまとめて数えます。Cloudflare を通さないローカル開発では制限されません。
- `/api/memories/search` の `limit` (1〜20)、`minScore` (0〜1)、クエリ長 (500文字) は範囲を検証します。
- 既存のDBには、起動時に `generating_at` 列と `rate_limits` テーブルが自動で追加されます (`migrations/0004_generation_lock_rate_limit.sql` と同等)。

## 18禁コンテンツの除外

成人向けの記事は対談の対象にしません (`POST /api/sessions` が 400 で断ります)。LLM のコストをかけないよう、安い判定から順に行います。

1. ドメイン: アダルト専用のTLD (`.xxx` など) と代表的なアダルトサイトは、取得も分析もせずに断る (`src/worker/services/adult-filter.ts`)。
2. ページ自身の宣言: `<meta name="rating" content="adult">` と RTA ラベル、リダイレクト先のドメイン。
3. 記事の内容: 記事分析の LLM 呼び出しが `adult` を返す (追加の呼び出しなし)。医療・性教育・報道など、性を扱っても露骨でないものは対象外。強いキーワードが4種類以上あれば、LLM が false でも成人向けとして扱う。

ドメインの一覧は網羅できないため、3 の内容判定が本命です。成人向けと判定された記事は、セッションとして保存しません。

## トップページのOGP画像・Xへのシェア・1日の対談数の上限

- トップページのOGP画像: `GET /api/ogp.png` (1200x630)。サイトの紹介と、出演するペルソナ (最大5人) を描き、構成が変わるたびにR2へ作り直します。`og:*` / `twitter:*` は SSR で出力します。
- Xへのシェア: 生成済みの対談ページに「Xでシェア」のリンクを出します (`https://x.com/intent/post`)。JS なしで動く普通のリンクで、対談のタイトルとURLが入ります。
- 1日の対談数の上限: 管理画面の上部で、全利用者の合計で1日に新しく作れる対談の数を設定できます。既定は 1000、日本時間の0時にリセット、0 にすると新規作成を止めます。上限に達すると `POST /api/sessions` が 429 を返します (保存済みの対談を開くことはできます)。設定は D1 の `app_settings` に保存します (`migrations/0005_app_settings.sql` と同等のテーブルは起動時にも自動作成)。

## 一覧のページ送り

トップページの一覧は1ページ24件で、`/?page=N` (ジャンル指定と併用できる `/?genre=…&page=N`) で切り替えます。1ページ目は `page` を省略します。範囲外のページは端に寄せます。`GET /api/sessions` も `page` と `limit` (1〜100) を受け付け、`total` と `totalPages` を返します。各ページは普通のリンクなので、SSR とエッジキャッシュはページごとに効きます。

## 対談の非表示 (管理画面 > 対談)

- 公開した対談は、管理画面の「対談」タブで非表示にできます (タイトル・URLで検索可、「非表示のみ」で絞り込み、いつでも再公開)。削除はせず、`sessions.hidden_at` に日時を入れます (`migrations/0006_session_hidden.sql` と同等の列は起動時にも自動追加)。
- 非表示の対談は、一覧・詳細 (`/s/:id`、`GET /api/sessions/:id`)・OGP画像・sitemap/RSS・記憶検索・「関連する対談」から外れます。同じ記事のURLを送っても作り直せません (409)。
- 非表示・再公開のときは、その対談と一覧・sitemap・RSS のエッジキャッシュを消します。消せなかったコピーは、有効期限 (最長10分) で切れます。

## 関連する対談・検索エンジン向けの出力

- 生成済みの対談ページの下に、内容の近い過去の対談を最大3件出します。記憶検索 (Vectorize、無ければ D1) の類似度が 0.5 以上のものだけです。検索に失敗してもページは表示します。
- `/sitemap.xml` (公開中の対談を新しい順に最大5000件)、`/rss.xml` (新着30件)、`/robots.txt` (`/admin` と `/api/` を除外し、sitemap を案内) を返します。対談ページには canonical と JSON-LD (Article) を出し、存在しない・非表示のページには `noindex` を付けます。

## キーワード検索

トップページの検索欄で、対談のタイトルと要約を絞り込めます (`/?q=…`、`GET /api/sessions?q=…`)。空白で区切った語はすべて含むものに絞り (最大5語・全体で50文字まで)、ジャンル・ページ送りとも併用できます。ジャンルの件数も、検索で絞った中の件数になります。JS なしでも動く GET のフォームで、検索結果のページには `noindex` を付けます。

## ファビコンと管理画面のURL

- ファビコンは `public/` にあります (`favicon.svg` が本体、`favicon-32.png` / `favicon.ico` / `apple-touch-icon.png` は `python scripts/make-favicons.py public` で同じ図形から生成。Pillow が必要)。
- 管理画面のURLは `/admin` です。旧URLの `/admin/personas` は 301 で `/admin` に転送します。Cloudflare Access のパスには `/admin` 自体も含めてください (`/admin/*` だけでは `/admin` が対象外です)。

## アクセス状況 (管理画面 > アクセス状況)

管理者が `/admin/analytics` で、アクセスの状況を見られます。記録と集計は Cloudflare の **Workers Analytics Engine**、実訪問者の計測は **Web Analytics** を使います。

### 記録するもの
`src/server.ts` の入口で、リクエストごとに `ANALYTICS` (データセット `persona_cast_events`) へ書き込みます。応答は遅らせず、失敗してもアプリには影響しません。列の使い方は `src/worker/services/analytics-track.ts` の先頭に書いてあります。

- ページ (HTMLを返した回数)・API: ルート名 (IDは含めない)、ステータス、応答時間、エッジのキャッシュ HIT/MISS、国、参照元ホスト、端末 (PC/スマホ/タブレット/ボット)。対談ページは対談IDも。
- 業務イベント: 新しく作られた対談、18禁で断った送信、1日の上限で断った送信、LLM の入力トークンとキャッシュ済みトークン。
- 対象外: `/admin` 以下、静的ファイル、`/_serverFn`、ヘルスチェック。未知のパスは `other` にまとめます。
- **生のIPは保存しません。** 訪問者は `IP + UA + 日付(日本時間) + ソルト` のハッシュで数え、日をまたぐと別人扱いです。ボットは `User-Agent` で判定し、人のページビューから除きます。

### 見える指標
ページビュー・訪問者(推定)・推移(24時間/7日/30日)、よく見られている対談、流入元、ページ別、国、端末、ステータス別の件数、キャッシュ HIT 率、応答時間 p50/p95、新規対談数、制限で断った数(429)、18禁・日次上限で断った数、LLM の入力キャッシュ率。
アプリ内の画面遷移はサーバーが HTML を返さないため、ページビューには入りません (Web Analytics 側で見られます)。

### 設定
1. **API トークンを作る**: Cloudflare ダッシュボード > My Profile > API Tokens で、権限を「Account > Account Analytics > Read」だけにしたトークンを作ります。
2. **シークレットを登録**: 上の「Cloudflare への本番デプロイ」の手順3のとおり、`CF_ACCOUNT_ID` (アカウントID)、`CF_API_TOKEN`、`ANALYTICS_SALT` を `cf workers secrets update` で登録します。
3. 登録するまで、画面には設定の案内が出ます。ローカル (`cf dev`) では記録先に問い合わせできないため、集計は表示できません (記録の書き込みは単体テストで確認しています)。

保持は約3か月で、データが多いときはサンプリングされます (集計は `_sample_interval` で重み付けします)。料金は Cloudflare の最新の価格表を確認してください。

### Web Analytics (実訪問者・Core Web Vitals)
`croud.jp` が Cloudflare のゾーンにあるので、次のどちらかで有効にします。

- **自動**: ダッシュボードの Web Analytics で `croud.jp` を追加し、自動設定 (プロキシ経由で JS を自動挿入) を選ぶ。コードの変更は不要です。
- **手動**: サイトを追加して表示される `token` を `cloudflare.config.ts` の `WEB_ANALYTICS_TOKEN` に設定する。設定するとビーコンを `<body>` の末尾に出します (管理画面では出しません)。**自動設定と併用すると二重に計測されるため、どちらか一方にしてください。**

## Lint・フォーマット (Ultracite / Biome)

[Ultracite](https://www.ultracite.ai/) のプリセット (Biome) で、lint とフォーマットを行います。設定は `biome.jsonc` です。

```bash
bun run check   # 検査 (エラーがあれば終了コードが0以外)
bun run fix     # 安全な自動修正とフォーマット
```

- 行の幅は 120 文字です。生成ファイル (`src/routeTree.gen.ts`)、`public/`、ビルド成果物は対象外です。
- 一部のルールは意図的に緩めています。理由は `biome.jsonc` のコメントを参照してください (`useTopLevelRegex`、`noJsxPropsBind`、`noAwaitInLoops`、`noIncrementDecrement`、`useNamedCaptureGroup`、`<img>` の `onError` を禁じる a11y ルールは無効)。
- `noExplicitAny` と `noLeakedRender` も有効です。D1 の行は `src/worker/db-types.ts` の型を `.all<T>()` / `.first<T>()` に渡して読み、`catch` した値は `unknown` のまま `errorMessage()` で扱います。
- ルールを例外にするときは、`// biome-ignore lint/...: 理由` の形で、理由を必ず書きます。

