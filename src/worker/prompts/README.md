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
| `dialogue-system.md` | 対談: 番組のルール・記事・記憶・出演者 (system、全発言者で共通) | cast, articleTitle, articleSummary, articleKeyQuotes, keyPoints, memoryContext |
| `dialogue-speaker.md` | 対談: 今回の発言者の役 (user の末尾に差し込む) | name, role, otherNames, personality, speakingStyle |
| `dialogue-memory-item.md` | 対談: 過去の対談記憶1件分 | index, articleTitle, topicSummary, keyQuotes |
| `dialogue-opening.md` | 対談: 最初の発言の依頼 (user) | speaker, articleTitle |
| `dialogue-turn.md` | 対談: 2回目以降の依頼 (user) | history, speaker, instruction |
| `dialogue-instruction-reply.md` / `-final.md` | 対談: 通常 / 最終ターンの指示 | (reply) lengthHint / (final) なし |
| `consolidate-system.md` / `-user.md` | 対談後の記憶の要約 | (user) articleTitle, conversation |
| `analyze-system.md` / `-user.md` | 記事の分析 (要約・ジャンル・参加者) | (system) genres, minPersonas, maxPersonas, personaList / (user) title, content |
| `persona-generate-system.md` | 管理画面のAI生成 (system) | nameMax, roleMax, example |
| `persona-generate-others.md` | 〃 既存の出演者 (system に追記) | others |
| `persona-generate-new.md` / `-modify.md` | 〃 新規 / 修正の依頼 (user) | instruction / base, instruction |

## プロンプトキャッシュを意識した並び

LLM のプロンプトキャッシュは**先頭から一致した部分**だけが効きます。対談では、全発言者で共通の内容を前に、発言者ごとに違う内容を最後に置いています。

`system` (ルール・記事・記憶・出演者) → `user` (これまでの対談 → 発言者の役 → 今回の指示)

発言者の名前や性格を system の先頭に戻すと、発言者が変わるたびにキャッシュが外れます。実測では、8発言の対談で入力トークンのキャッシュ率が約22%から約76%になりました。
