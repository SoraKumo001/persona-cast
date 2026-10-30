import type { DialogueSessionRow } from "../db-types";
import { errorMessage } from "../errors";
import { buildConsolidateMessages, buildTurnMessages } from "../prompts";
import type { Env, Persona } from "../types";
import { generateChatCompletion, streamChatCompletion } from "./llm";
import { saveMemoryChunk, searchSimilarMemories } from "./memory";
import { listPersonasByIds, toPersona } from "./persona-store";
import { getDialogueSession, insertMessage } from "./session-queries";

export interface DialogueEvent {
  data: Record<string, unknown>;
  type: "session_start" | "turn_start" | "chunk" | "turn_end" | "session_end" | "error";
}

/**
 * ターン制のペルソナ対談をリアルタイムに進行・ストリーミングするオーケストレーター
 */
export async function* orchestrateDialogue(
  sessionId: string,
  env: Env,
  totalTurns = 6,
  modelName?: string
): AsyncGenerator<DialogueEvent, void, unknown> {
  // 1. セッション情報の取得
  const sessionRow = await getDialogueSession(env.DB, sessionId);

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
  const personaRows = await listPersonasByIds(env.DB, personaIds);

  const personasMap = new Map<string, Persona>();
  for (const p of personaRows) {
    personasMap.set(p.id, toPersona(p));
  }
  const activePersonas = personaIds.map((id) => personasMap.get(id)).filter((p): p is Persona => p !== undefined);

  // 3. 過去の類似対談記憶（エピソード記憶）を検索
  const pastMemories = await searchSimilarMemories(
    `${sessionRow.article_title}\n${sessionRow.article_summary}`,
    env,
    3,
    0.5
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
    const promptMessages = buildTurnMessages({
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
    } catch (err) {
      console.error(`Error generating turn ${turn}:`, err);
      yield {
        type: "error",
        data: { message: `ターン ${turn + 1} の生成中にエラーが発生しました: ${errorMessage(err)}` },
      };
      return;
    }

    // 過去記憶を参照したか判定（記事タイトルが含まれているかなど）
    let referencedSessionId: string | null = null;
    let referencedArticleTitle: string | null = null;
    for (const mem of pastMemories) {
      if (mem.articleTitle && fullTurnContent.toLowerCase().includes(mem.articleTitle.toLowerCase().slice(0, 15))) {
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
    await insertMessage(env.DB, {
      id: messageId,
      sessionId,
      personaId: currentPersona.id,
      turnIndex: turn,
      content: fullTurnContent,
      referencedSessionId,
      referencedArticleTitle,
      createdAt: now,
    });

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
 * 対談終了後に記憶を抽出・ベクトル化して保存
 */
async function consolidateSessionMemory(
  sessionId: string,
  sessionRow: DialogueSessionRow,
  personas: Persona[],
  history: { personaName: string; text: string }[],
  env: Env
): Promise<void> {
  if (history.length === 0) {
    return;
  }

  const prompt = buildConsolidateMessages(sessionRow.article_title, history);

  let topicSummary = `${sessionRow.article_title}についての議論。`;
  let keyQuotes = history
    .slice(0, 2)
    .map((h) => h.text)
    .join(" / ");

  try {
    const rawResult = await generateChatCompletion(prompt, env, sessionId);
    const cleaned = rawResult
      .replace(/```json/gu, "")
      .replace(/```/gu, "")
      .trim();
    const parsed: { topicSummary?: unknown; keyQuotes?: unknown } | null = JSON.parse(cleaned);
    const { topicSummary: summary, keyQuotes: quotes } = parsed ?? {};
    if (typeof summary === "string" && summary) {
      topicSummary = summary;
    }
    if (typeof quotes === "string" && quotes) {
      keyQuotes = quotes;
    }
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
