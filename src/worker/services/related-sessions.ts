import type { Env } from "../types";
import { searchSimilarMemories } from "./memory";

export interface RelatedSession {
  articleTitle: string;
  score: number;
  sessionId: string;
  topicSummary: string;
}

const MIN_SCORE = 0.5;

/** 対談ページの下に出す、内容の近い過去の対談。非表示の対談と自分自身は含めない */
export async function findRelatedSessions(env: Env, sessionId: string, limit = 3): Promise<RelatedSession[]> {
  const row = await env.DB.prepare(
    "SELECT article_title, summary, article_summary FROM sessions WHERE id = ? AND hidden_at IS NULL"
  )
    .bind(sessionId)
    .first<{ article_summary: string; article_title: string; summary: string | null }>();
  if (!row) {
    return [];
  }

  // 自分の記憶が最上位に来るので、その分を多めに取る
  const found = await searchSimilarMemories(
    `${row.article_title}\n${(row.summary || row.article_summary).slice(0, 300)}`,
    env,
    limit + 2,
    MIN_SCORE
  );

  const seen = new Set<string>([sessionId]);
  const related: RelatedSession[] = [];
  for (const m of found) {
    if (seen.has(m.sessionId)) {
      continue;
    }
    seen.add(m.sessionId);
    related.push({
      sessionId: m.sessionId,
      articleTitle: m.articleTitle,
      topicSummary: m.topicSummary,
      score: Math.round(m.score * 100) / 100,
    });
    if (related.length >= limit) {
      break;
    }
  }
  return related;
}
