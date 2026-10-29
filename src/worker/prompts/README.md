# プロンプト

LLM に渡す文面は、ここの `*.md` を編集して変更します。`index.ts` がビルド時に `?raw` で取り込み、
`{{変数}}` を差し込んで組み立てます (`render.ts`)。

- ファイル1つが、1つのメッセージ (system または user) の本文です。
- 変数の過不足は、組み立て時に例外になります。**変数を増減したら `index.ts` の差し込みも合わせて直してください。**
- 差し込む値に含まれる `{{...}}` は展開されません。
- 条件によって文面が変わるもの (最初の発言 / 通常 / 最終ターン、新規 / 修正 など) は、別ファイルに分けています。
- 反映にはビルドとデプロイが必要です。

| ファイル | 用途 | 変数 |
|---|---|---|
| `dialogue-speaker.md` | 対談: 発言者のペルソナ設定 (system) | name, role, otherNames, personality, speakingStyle, articleTitle, articleSummary, memoryContext |
| `dialogue-memory-item.md` | 対談: 過去の対談記憶1件分 | index, articleTitle, topicSummary, keyQuotes |
| `dialogue-opening.md` | 対談: 最初の発言の依頼 (user) | articleTitle |
| `dialogue-turn.md` | 対談: 2回目以降の依頼 (user) | history, instruction |
| `dialogue-instruction-reply.md` / `-final.md` | 対談: 通常 / 最終ターンの指示 | なし |
| `consolidate-system.md` / `-user.md` | 対談後の記憶の要約 | (user) articleTitle, conversation |
| `analyze-system.md` / `-user.md` | 記事の分析 (要約・ジャンル・参加者) | (system) genres, minPersonas, maxPersonas, personaList / (user) title, content |
| `persona-generate-system.md` | 管理画面のAI生成 (system) | nameMax, roleMax, example |
| `persona-generate-others.md` | 〃 既存の出演者 (system に追記) | others |
| `persona-generate-new.md` / `-modify.md` | 〃 新規 / 修正の依頼 (user) | instruction / base, instruction |
