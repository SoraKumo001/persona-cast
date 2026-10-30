import type { MemoryChunkDbRow } from "../db-types";
import type { Env } from "../types";

export interface MemorySearchResult {
  articleTitle: string;
  createdAt: string;
  id: string;
  keyQuotes: string;
  personaIds: string[];
  score: number;
  sessionId: string;
  sourceUrl: string;
  topicSummary: string;
}

/** 類似記憶として採用するスコアの下限。呼び出し側ごとにばらつかせない */
export const MEMORY_MIN_SCORE = 0.5;

/**
 * テキストから1024次元のEmbeddingベクトルを生成
 * Cloudflare Workers AI (@cf/baai/bge-m3) を使用し、本物の埋め込みが得られないときは null を返す。
 * (ダミーの決定論的ベクトルを保存・検索に使うと D1 フォールバック検索が汚染されるため作らない)
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[] | null> {
  const model = env.EMBEDDING_MODEL || "@cf/baai/bge-m3";
  const trimmed = text.slice(0, 2000); // bge-m3 の入力上限保護

  if (env.AI) {
    try {
      const response = await env.AI.run(model, {
        text: [trimmed],
      });
      // @cf/baai/bge-m3 の出力形式: { shape: [1, 1024], data: [[...]] }
      const [first] = response.data ?? [];
      if (first) {
        return first;
      }
    } catch (err) {
      console.warn("Workers AI Embedding failed:", err);
    }
  }

  return null;
}

/**
 * 過去の対談記憶から、記事内容やクエリに類似するチャンクを検索。
 * 管理者が非表示にした対談の記憶は、結果から外す
 */
export async function searchSimilarMemories(
  queryText: string,
  env: Env,
  limit = 3,
  minScore = MEMORY_MIN_SCORE
): Promise<MemorySearchResult[]> {
  // 外した分で件数が減らないよう、多めに取ってから絞る
  const found = await searchRawMemories(queryText, env, limit + 5, minScore);
  if (found.length === 0) {
    return found;
  }
  const ids = [...new Set(found.map((m) => m.sessionId))];
  const { results: hidden } = await env.DB.prepare(
    `SELECT id FROM sessions WHERE hidden_at IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`
  )
    .bind(...ids)
    .all<{ id: string }>();
  const hiddenIds = new Set(hidden.map((r) => r.id));
  return found.filter((m) => !hiddenIds.has(m.sessionId)).slice(0, limit);
}

async function searchRawMemories(
  queryText: string,
  env: Env,
  limit: number,
  minScore: number
): Promise<MemorySearchResult[]> {
  const queryVector = await generateEmbedding(queryText, env);
  if (!queryVector) {
    // 本物の埋め込みが無い環境 (AI 未接続・障害) では、類似度を偽装せず記憶検索を諦める
    console.warn("Embedding unavailable; skipping memory search");
    return [];
  }

  // 1. Cloudflare Vectorize がバインドされている場合はVectorizeを最優先
  if (env.VECTORIZE) {
    try {
      const vecResult = await env.VECTORIZE.query(queryVector, {
        topK: limit,
        returnMetadata: "all",
      });

      if (vecResult.matches && vecResult.matches.length > 0) {
        const matches = vecResult.matches.flatMap((m): MemorySearchResult[] => {
          // 識別に必要な情報が欠けた行は、空文字で埋めずに除外する
          const meta = m.metadata as Record<string, string | undefined> | undefined;
          if (m.score < minScore || !meta?.sessionId || !meta.articleTitle) {
            return [];
          }
          return [
            {
              id: m.id,
              sessionId: meta.sessionId,
              articleTitle: meta.articleTitle,
              sourceUrl: meta.sourceUrl ?? "",
              topicSummary: meta.topicSummary ?? "",
              keyQuotes: meta.keyQuotes ?? "",
              personaIds: parsePersonaIds(meta.personaIds),
              score: m.score,
              createdAt: meta.createdAt ?? "",
            },
          ];
        });

        if (matches.length > 0) {
          return matches;
        }
      }
    } catch (err) {
      console.warn("Vectorize query failed, falling back to D1 search:", err);
    }
  }

  // 2. Vectorize未接続またはローカル開発環境: D1のmemory_chunksからコサイン類似度で検索
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, session_id, article_title, source_url, topic_summary, key_quotes, persona_ids, embedding_json, created_at FROM memory_chunks ORDER BY created_at DESC LIMIT 50"
    ).all<MemoryChunkDbRow>();

    if (!results || results.length === 0) {
      return [];
    }

    const scored = results
      .flatMap((row): MemorySearchResult[] => {
        // 埋め込みが無い (保存時に作れなかった) 行は、スコア0で混ぜず除外する
        const vec = parseStoredEmbedding(row.embedding_json);
        if (!vec) {
          return [];
        }
        return [
          {
            id: row.id,
            sessionId: row.session_id,
            articleTitle: row.article_title,
            sourceUrl: row.source_url,
            topicSummary: row.topic_summary,
            keyQuotes: row.key_quotes,
            personaIds: parsePersonaIds(row.persona_ids),
            score: cosineSimilarity(queryVector, vec),
            createdAt: row.created_at,
          },
        ];
      })
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  } catch (err) {
    console.error("D1 memory search error:", err);
    return [];
  }
}

/** persona_ids の JSON。壊れていても検索全体を落とさず空として扱う */
function parsePersonaIds(json: string | null | undefined): string[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** D1 に保存された埋め込み。無い・壊れている場合は null */
function parseStoredEmbedding(json: string | null): number[] | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

/** Vectorize に入れる1件分 (保存時と、管理画面からの再同期で同じ形にする) */
export function toVectorRecord(
  chunk: {
    articleTitle: string;
    id: string;
    keyQuotes: string;
    personaIds: string[];
    sessionId: string;
    sourceUrl: string;
    topicSummary: string;
  },
  embedding: number[],
  createdAt: string
) {
  return {
    id: chunk.id,
    values: embedding,
    metadata: {
      sessionId: chunk.sessionId,
      articleTitle: chunk.articleTitle,
      sourceUrl: chunk.sourceUrl,
      topicSummary: chunk.topicSummary.slice(0, 400),
      keyQuotes: chunk.keyQuotes.slice(0, 400),
      personaIds: JSON.stringify(chunk.personaIds),
      createdAt,
    },
  };
}

/**
 * 対談終了後に新しい記憶チャンクをD1およびVectorizeに永続化
 */
export async function saveMemoryChunk(
  chunk: {
    id: string;
    sessionId: string;
    articleTitle: string;
    sourceUrl: string;
    topicSummary: string;
    keyQuotes: string;
    personaIds: string[];
  },
  env: Env
): Promise<void> {
  const textToEmbed = `${chunk.articleTitle}\n${chunk.topicSummary}\n${chunk.keyQuotes}`;
  const embedding = await generateEmbedding(textToEmbed, env);
  const now = new Date().toISOString();

  // 1. D1 に保存 (本物の埋め込みが無いときは embedding_json を NULL にし、検索側で除外させる)
  await env.DB.prepare(
    `INSERT INTO memory_chunks (id, session_id, article_title, source_url, topic_summary, key_quotes, persona_ids, embedding_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      chunk.id,
      chunk.sessionId,
      chunk.articleTitle,
      chunk.sourceUrl,
      chunk.topicSummary,
      chunk.keyQuotes,
      JSON.stringify(chunk.personaIds),
      embedding ? JSON.stringify(embedding) : null,
      now
    )
    .run();

  // 2. Vectorize に upsert (埋め込みが無い行は登録しない)
  if (env.VECTORIZE && embedding) {
    try {
      await env.VECTORIZE.upsert([toVectorRecord(chunk, embedding, now)]);
    } catch (err) {
      console.warn("Vectorize upsert warning:", err);
    }
  }
}

/**
 * コサイン類似度の計算
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
