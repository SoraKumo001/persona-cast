import type { Env } from "../types";

interface MemoryChunkDbRow {
  article_title: string;
  created_at: string;
  embedding_json: string | null;
  id: string;
  key_quotes: string;
  persona_ids: string;
  session_id: string;
  source_url: string;
  topic_summary: string;
}

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

/**
 * テキストから1024次元のEmbeddingベクトルを生成
 * Cloudflare Workers AI (@cf/baai/bge-m3) を最優先で使用
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
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
      console.warn("Workers AI Embedding failed, falling back to local vector generation:", err);
    }
  }

  // ローカル開発やWorkers AI未接続時のフォールバック (1024次元のハッシュ・擬似Embedding)
  return generateDeterministicVector(trimmed, 1024);
}

/**
 * 過去の対談記憶から、記事内容やクエリに類似するチャンクを検索
 */
export async function searchSimilarMemories(
  queryText: string,
  env: Env,
  limit = 3,
  minScore = 0.55
): Promise<MemorySearchResult[]> {
  const queryVector = await generateEmbedding(queryText, env);

  // 1. Cloudflare Vectorize がバインドされている場合はVectorizeを最優先
  if (env.VECTORIZE) {
    try {
      const vecResult = await env.VECTORIZE.query(queryVector, {
        topK: limit,
        returnMetadata: "all",
      });

      if (vecResult.matches && vecResult.matches.length > 0) {
        const matches = vecResult.matches
          .filter((m) => m.score >= minScore)
          .map((m) => ({
            id: m.id,
            sessionId: m.metadata?.sessionId || "",
            articleTitle: m.metadata?.articleTitle || "",
            sourceUrl: m.metadata?.sourceUrl || "",
            topicSummary: m.metadata?.topicSummary || "",
            keyQuotes: m.metadata?.keyQuotes || "",
            personaIds: m.metadata?.personaIds ? (JSON.parse(m.metadata.personaIds) as string[]) : [],
            score: m.score,
            createdAt: m.metadata?.createdAt || "",
          }));

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
      .map((row) => {
        let score = 0;
        if (row.embedding_json) {
          try {
            const vec = JSON.parse(row.embedding_json);
            score = cosineSimilarity(queryVector, vec);
          } catch {
            score = 0;
          }
        }
        return {
          id: row.id,
          sessionId: row.session_id,
          articleTitle: row.article_title,
          sourceUrl: row.source_url,
          topicSummary: row.topic_summary,
          keyQuotes: row.key_quotes,
          personaIds: JSON.parse(row.persona_ids || "[]") as string[],
          score,
          createdAt: row.created_at,
        };
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

  // 1. D1 に保存
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
      JSON.stringify(embedding),
      now
    )
    .run();

  // 2. Vectorize に upsert
  if (env.VECTORIZE) {
    try {
      await env.VECTORIZE.upsert([
        {
          id: chunk.id,
          values: embedding,
          metadata: {
            sessionId: chunk.sessionId,
            articleTitle: chunk.articleTitle,
            sourceUrl: chunk.sourceUrl,
            topicSummary: chunk.topicSummary.slice(0, 400),
            keyQuotes: chunk.keyQuotes.slice(0, 400),
            personaIds: JSON.stringify(chunk.personaIds),
            createdAt: now,
          },
        },
      ]);
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

/**
 * ローカル開発用決定論的ベクトル生成
 */
function generateDeterministicVector(text: string, dimensions: number): number[] {
  const vector = new Array(dimensions).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const index = (code * 31 + i) % dimensions;
    vector[index] += 1;
  }
  // L2正規化
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= norm;
    }
  }
  return vector;
}
