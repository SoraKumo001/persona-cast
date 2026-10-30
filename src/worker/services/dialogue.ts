import type { DialogueSessionRow } from "../db-types";
import { errorMessage } from "../errors";
import { buildConsolidateMessages, buildTurnMessages } from "../prompts";
import type { Env, Persona } from "../types";
import { parseArticleSummary } from "./analyze";
import { assignKeyPoints } from "./keypoint-assignment";
import { generateChatCompletion, streamChatCompletion } from "./llm";
import { MEMORY_MIN_SCORE, saveMemoryChunk, searchSimilarMemories } from "./memory";
import { detectMemoryReference } from "./memory-reference";
import { listPersonasByIds, toPersona } from "./persona-store";
import { personaTemperature } from "./persona-temperature";
import { getDialogueSession, insertMessage } from "./session-queries";
import { generateStances } from "./stance";

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

  // 保存時のハイブリッド要約からキー引用・論点を復元し、対談プロンプトへ渡す
  const {
    keyPoints: articleKeyPoints,
    keyQuotes: articleKeyQuotes,
    summary: articleSummary,
  } = parseArticleSummary(sessionRow.article_summary);
  const effectiveSummary = articleSummary || sessionRow.article_summary;
  const keyQuotesText = articleKeyQuotes.length > 0 ? articleKeyQuotes.map((q) => `「${q}」`).join("\n") : undefined;
  // 論点割当パイロット: keyPoints を personas 順に分散所有させる。
  // KEYPOINT_ASSIGN=off なら空 Map になり、プロンプトはパイロット前と同じになる。
  const keyPointAssignments = assignKeyPoints(activePersonas, articleKeyPoints, env);

  // 3. 過去の類似対談記憶（エピソード記憶）の検索と、Phase 1 の「立場」生成を並列で走らせる。
  //    Phase 1 は全ペルソナ分を Promise.all で一度に生成する (逐次ループにしない)。
  //    生成に失敗したペルソナは Map から欠落し、そのまま stance なしで対談を続行する。
  const [pastMemories, stances] = await Promise.all([
    searchSimilarMemories(`${sessionRow.article_title}\n${sessionRow.article_summary}`, env, 3, MEMORY_MIN_SCORE),
    generateStances(
      {
        // A/B比較用: STANCE_PILOT=off なら Phase 1 を丸ごと飛ばす (空配列なら LLM 呼び出しも 0 回)
        personas: env.STANCE_PILOT === "off" ? [] : activePersonas,
        articleTitle: sessionRow.article_title,
        articleSummary: effectiveSummary,
        articleKeyQuotes: keyQuotesText,
        keyPoints: articleKeyPoints.length > 0 ? articleKeyPoints : undefined,
        keyPointAssignments,
      },
      env,
      sessionId,
      { modelName }
    ),
  ]);

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
      articleSummary: effectiveSummary,
      articleKeyQuotes: keyQuotesText,
      keyPoints: articleKeyPoints.length > 0 ? articleKeyPoints : undefined,
      stance: stances.get(currentPersona.id),
      assignedKeyPoints: keyPointAssignments.get(currentPersona.id),
      pastMemories,
      history: conversationHistory,
      turnIndex: turn,
      totalTurns,
      isFirstSpeaker,
    });

    // この発言の生成を始めた時刻。これ以降に作られた記憶は参照しようがない (時系列ガード)
    const turnStartedAt = new Date().toISOString();

    let fullTurnContent = "";
    // 発言者ごとの temperature (パイロット)。PERSONA_TEMP_PILOT=off なら全員 0.75
    const temperature = personaTemperature(currentPersona.id, env);
    try {
      for await (const chunk of streamChatCompletion(promptMessages, env, sessionId, modelName, temperature)) {
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

    // 過去記憶を参照したか判定。自己参照・タイトル先頭一致・時系列の矛盾は参照とみなさない
    const reference = detectMemoryReference(fullTurnContent, pastMemories, sessionId, turnStartedAt);
    const referencedSessionId = reference?.sessionId ?? null;
    const referencedArticleTitle = reference?.articleTitle ?? null;

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
  // 記憶の失敗は SSE 本体 (対談) の成否と切り離す。ここで例外を外に漏らすと、
  // 呼び出し側のストリーム後処理まで巻き込むため、必ず握り潰す。
  await consolidateSafely(sessionId, sessionRow, activePersonas, conversationHistory, env);
}

/** 記憶の定着。失敗しても対談の成否に影響させない (警告のみ) */
async function consolidateSafely(
  sessionId: string,
  sessionRow: DialogueSessionRow,
  personas: Persona[],
  history: { personaName: string; text: string }[],
  env: Env
): Promise<void> {
  try {
    await consolidateSessionMemory(sessionId, sessionRow, personas, history, env);
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
