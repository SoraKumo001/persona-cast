import { Env, Persona, DialogueSession, Message } from "../types";
import { streamChatCompletion, generateChatCompletion, ChatMessage } from "./llm";
import { searchSimilarMemories, saveMemoryChunk, MemorySearchResult } from "./memory";
import { PERSONA_COLUMNS, toPersona } from "./persona-store";

export interface DialogueEvent {
  type: "session_start" | "turn_start" | "chunk" | "turn_end" | "session_end" | "error";
  data: any;
}

/**
 * ターン制のペルソナ対談をリアルタイムに進行・ストリーミングするオーケストレーター
 */
export async function* orchestrateDialogue(
  sessionId: string,
  env: Env,
  totalTurns: number = 6,
  modelName?: string
): AsyncGenerator<DialogueEvent, void, unknown> {
  // 1. セッション情報の取得
  const sessionRow: any = await env.DB.prepare(
    "SELECT id, source_url, article_title, article_summary, persona_ids, created_at FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first();

  if (!sessionRow) {
    yield { type: "error", data: { message: "セッションが見つかりません" } };
    return;
  }

  const personaIds: string[] = JSON.parse(sessionRow.persona_ids || "[]");
  if (personaIds.length === 0) {
    yield { type: "error", data: { message: "対談に参加するペルソナが選択されていません" } };
    return;
  }

  // 2. 参加ペルソナ情報の取得
  const placeholders = personaIds.map(() => "?").join(",");
  const { results: personaRows } = await env.DB.prepare(
    `SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${placeholders})`
  )
    .bind(...personaIds)
    .all();

  const personasMap = new Map<string, any>();
  for (const p of personaRows as any[]) {
    personasMap.set(p.id, toPersona(p));
  }
  const activePersonas = personaIds.map((id) => personasMap.get(id)).filter(Boolean);

  // 3. 過去の類似対談記憶（エピソード記憶）を検索
  const pastMemories = await searchSimilarMemories(
    `${sessionRow.article_title}\n${sessionRow.article_summary}`,
    env,
    3,
    0.50
  );

  yield {
    type: "session_start",
    data: {
      sessionId,
      articleTitle: sessionRow.article_title,
      sourceUrl: sessionRow.source_url,
      personas: activePersonas,
      pastMemories: pastMemories.map((m) => ({
        sessionId: m.sessionId,
        articleTitle: m.articleTitle,
        topicSummary: m.topicSummary,
        score: Math.round(m.score * 100) / 100,
      })),
      totalTurns,
    },
  };

  const conversationHistory: { personaName: string; text: string }[] = [];

  // 4. 各ターンの掛け合いループ
  for (let turn = 0; turn < totalTurns; turn++) {
    const currentPersona = activePersonas[turn % activePersonas.length];
    const isFirstSpeaker = turn === 0;

    yield {
      type: "turn_start",
      data: {
        turnIndex: turn,
        persona: currentPersona,
      },
    };

    // プロンプトの組み立て
    const promptMessages = buildPromptForTurn({
      currentPersona,
      allPersonas: activePersonas,
      articleTitle: sessionRow.article_title,
      articleSummary: sessionRow.article_summary,
      pastMemories,
      history: conversationHistory,
      turnIndex: turn,
      totalTurns,
      isFirstSpeaker,
    });

    let fullTurnContent = "";
    try {
      for await (const chunk of streamChatCompletion(promptMessages, env, sessionId, modelName)) {
        fullTurnContent += chunk;
        yield {
          type: "chunk",
          data: {
            turnIndex: turn,
            personaId: currentPersona.id,
            chunk,
          },
        };
      }
    } catch (err: any) {
      console.error(`Error generating turn ${turn}:`, err);
      yield {
        type: "error",
        data: { message: `ターン ${turn + 1} の生成中にエラーが発生しました: ${err.message}` },
      };
      return;
    }

    // 過去記憶を参照したか判定（記事タイトルが含まれているかなど）
    let referencedSessionId: string | null = null;
    let referencedArticleTitle: string | null = null;
    for (const mem of pastMemories) {
      if (
        mem.articleTitle &&
        fullTurnContent.toLowerCase().includes(mem.articleTitle.toLowerCase().slice(0, 15))
      ) {
        referencedSessionId = mem.sessionId;
        referencedArticleTitle = mem.articleTitle;
        break;
      }
    }

    // 会話履歴に追加
    conversationHistory.push({
      personaName: currentPersona.name,
      text: fullTurnContent,
    });

    // メッセージをD1に保存
    const messageId = `msg_${sessionId}_${turn}_${Date.now()}`;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO messages (id, session_id, persona_id, turn_index, content, referenced_session_id, referenced_article_title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        messageId,
        sessionId,
        currentPersona.id,
        turn,
        fullTurnContent,
        referencedSessionId,
        referencedArticleTitle,
        now
      )
      .run();

    yield {
      type: "turn_end",
      data: {
        turnIndex: turn,
        personaId: currentPersona.id,
        content: fullTurnContent,
        referencedSessionId,
        referencedArticleTitle,
      },
    };
  }

  // 5. 対談完了後の「記憶の定着（Memory Consolidation）」
  yield {
    type: "session_end",
    data: {
      message: "対談が完了しました。今回の対談内容を長期記憶として定着させています...",
    },
  };

  // バックグラウンドで今回の対談記憶チャンクを生成・保存
  try {
    await consolidateSessionMemory(sessionId, sessionRow, activePersonas, conversationHistory, env);
  } catch (err) {
    console.warn("Memory consolidation failed:", err);
  }
}

/**
 * ターンごとのプロンプト生成
 */
function buildPromptForTurn(params: {
  currentPersona: any;
  allPersonas: any[];
  articleTitle: string;
  articleSummary: string;
  pastMemories: MemorySearchResult[];
  history: { personaName: string; text: string }[];
  turnIndex: number;
  totalTurns: number;
  isFirstSpeaker: boolean;
}): ChatMessage[] {
  const {
    currentPersona,
    allPersonas,
    articleTitle,
    articleSummary,
    pastMemories,
    history,
    turnIndex,
    totalTurns,
    isFirstSpeaker,
  } = params;

  const otherNames = allPersonas
    .filter((p) => p.id !== currentPersona.id)
    .map((p) => `${p.name}（${p.role}）`)
    .join("、");

  let memoryContextText = "なし";
  if (pastMemories.length > 0) {
    memoryContextText = pastMemories
      .map(
        (m, idx) =>
          `[過去の対談記録 #${idx + 1}]
記事: 『${m.articleTitle}』
当時の議論要点: ${m.topicSummary}
当時の発言抜粋: ${m.keyQuotes}`
      )
      .join("\n\n");
  }

  const systemPrompt = `あなたはポッドキャスト・ラジオ番組に出演しているペルソナ「${currentPersona.name}」（${currentPersona.role}）です。
他の出演者（${otherNames}）と共に、提供されたWeb記事の内容について語り合ってください。

【あなたのキャラクター設定】
- 性格・価値観: ${currentPersona.personality}
- 口調・話し方: ${currentPersona.speakingStyle}

【語り合う対象の記事】
タイトル: ${articleTitle}
記事概要:
${articleSummary}

【あなたの頭の中にある「過去の対談記憶」】
${memoryContextText}

【対談進行の重要ルール】
1. ラジオ・対談番組の自然なフリートークとして発言してください。挨拶定型句（「こんにちは」「本日はよろしく」など）は省き、本題の議論・掛け合いに集中してください。
2. 1回あたりの発言は日本語で120〜250文字程度で、テンポよく返してください。長すぎる演説は避けてください。
3. 直前の相手の発言を受けて、相槌や反論、独自の視点を投げかけてください。
4. 【過去記憶の引用】もし「過去の対談記憶」に関連する話題がある場合、対話の流れで自然に引用してください。（例：「前に話した『〇〇』の記事のときも〜だったけど、今回も似てない？」「以前の議論で〇〇さんは〜って言ってたけど、この件はどう思う？」など）。無理に全記憶を使う必要はありませんが、関連があれば積極的に活用してください。
5. あなたの口調・一人称・キャラクターを徹底して維持してください。
6. 出力には「${currentPersona.name}:」などの話者名は含めず、発言本文のみを出力してください。`;

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (isFirstSpeaker) {
    messages.push({
      role: "user",
      content: `記事『${articleTitle}』について、あなたのペルソナとしての第一声（話題提起や最初の感想）を述べて対談をスタートしてください。`,
    });
  } else {
    // これまでの会話履歴をプロンプトに注入
    const historyText = history
      .map((h) => `${h.personaName}: 「${h.text}」`)
      .join("\n\n");

    const isLastTurn = turnIndex === totalTurns - 1;
    let turnInstruction = `直前の相手の発言に対して、あなたの視点から応答・意見を述べてください。`;
    if (isLastTurn) {
      turnInstruction = `今回は対談の最終ターンです。ここまでの議論を踏まえて、あなたの立場から今回のテーマを総括・締めくくってください。`;
    }

    messages.push({
      role: "user",
      content: `【ここまでの対談の流れ】\n${historyText}\n\n${turnInstruction}`,
    });
  }

  return messages;
}

/**
 * 対談終了後に記憶を抽出・ベクトル化して保存
 */
async function consolidateSessionMemory(
  sessionId: string,
  sessionRow: any,
  personas: any[],
  history: { personaName: string; text: string }[],
  env: Env
): Promise<void> {
  if (history.length === 0) return;

  const conversationText = history
    .map((h) => `${h.personaName}: ${h.text}`)
    .join("\n");

  const prompt: ChatMessage[] = [
    {
      role: "system",
      content:
        "あなたは対談内容を要約し、将来のAIが過去の記憶として検索・引用しやすいチャンクを作成するアシスタントです。JSON形式で返答してください。",
    },
    {
      role: "user",
      content: `以下の記事についてのペルソナ対談を分析し、
1. topicSummary: どのような論点で誰がどう主張し、どんな結論・疑問が残ったか（150文字程度）
2. keyQuotes: 最も印象的な議論の対立や名言（1〜2文）
を抽出してください。

記事: 『${sessionRow.article_title}』
対談内容:
${conversationText}

回答形式(JSON):
{
  "topicSummary": "...",
  "keyQuotes": "..."
}`,
    },
  ];

  let topicSummary = `${sessionRow.article_title}についての議論。`;
  let keyQuotes = history.slice(0, 2).map((h) => h.text).join(" / ");

  try {
    const rawResult = await generateChatCompletion(prompt, env, sessionId);
    const cleaned = rawResult.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.topicSummary) topicSummary = parsed.topicSummary;
    if (parsed.keyQuotes) keyQuotes = parsed.keyQuotes;
  } catch (err) {
    console.warn("LLM summary generation fallback to heuristic:", err);
  }

  const chunkId = `mem_${sessionId}_${Date.now()}`;
  await saveMemoryChunk(
    {
      id: chunkId,
      sessionId,
      articleTitle: sessionRow.article_title,
      sourceUrl: sessionRow.source_url,
      topicSummary,
      keyQuotes,
      personaIds: personas.map((p) => p.id),
    },
    env
  );
}
