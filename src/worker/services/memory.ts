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

/** 埋め込みに渡す本文。保存時とバックフィルで同じ形にしないとベクトルが揃わない */
function memoryChunkEmbeddingText(chunk: { articleTitle: string; keyQuotes: string; topicSummary: string }): string {
  return `${chunk.articleTitle}\n${chunk.topicSummary}\n${chunk.keyQuotes}`;
}

/** バックフィルの既定ページ幅 (1回のAI呼び出しとD1更新をこの件数ずつに区切る) */
const BACKFILL_PAGE_SIZE = 20;
/** 1回の実行で処理する上限。呼び出し側が繰り返しても無限に走らないようにする */
const BACKFILL_MAX_ROWS = 200;
export interface MemoryEmbeddingBackfillOptions {
  /** この id より大きい行から始める (前回の next を渡して続きから) */
  after?: string;
  /** 1ページの件数 */
  batchSize?: number;
  /** 1回の実行で処理する最大件数 */
  maxRows?: number;
}

export interface MemoryEmbeddingBackfillResult {
  /** Workers AI が使えず中断した */
  aborted: boolean;
  /** 失敗した件数 (埋め込み生成・D1更新・Vectorize登録) */
  failed: number;
  /** 続きの開始位置。null なら全件処理済み */
  next: string | null;
  /** 今回処理した件数 */
  processed: number;
  /** memory_chunks の総件数 (進捗表示用) */
  total: number;
  /** embedding_json を更新できた件数 */
  updated: number;
}

/** 1行分の再生成結果。unavailable は AI 側の異常で、以降も続かないと判断する */
type RowRegenResult = { status: "updated"; embedding: number[] } | { status: "failed" } | { status: "unavailable" };

/** 1行分の埋め込みを作り直して D1 に書き戻す。DB の失敗は failed として返し、呼び出し側を止めない */
async function regenerateRowEmbedding(env: Env, row: MemoryChunkDbRow): Promise<RowRegenResult> {
  const embedding = await generateEmbedding(
    memoryChunkEmbeddingText({
      articleTitle: row.article_title,
      topicSummary: row.topic_summary,
      keyQuotes: row.key_quotes,
    }),
    env
  );
  if (!embedding) {
    return { status: "unavailable" };
  }
  try {
    await env.DB.prepare("UPDATE memory_chunks SET embedding_json = ? WHERE id = ?")
      .bind(JSON.stringify(embedding), row.id)
      .run();
  } catch (err) {
    console.warn(`[memory-backfill] failed to update ${row.id}:`, err);
    return { status: "failed" };
  }
  return { status: "updated", embedding };
}

/** 1ページ分の結果 */
interface PageBackfillResult {
  aborted: boolean;
  /** ページを最後まで読んだ (続きが無い) */
  exhausted: boolean;
  failed: number;
  lastId: string | null;
  processed: number;
  updated: number;
}

/** 1ページ分を処理する。埋め込みの生成と D1 更新をしたうえで Vectorize へまとめて登録する */
async function backfillPage(env: Env, after: string, pageSize: number): Promise<PageBackfillResult> {
  const { results } = await env.DB.prepare(
    `SELECT id, session_id, article_title, source_url, topic_summary, key_quotes, persona_ids, embedding_json, created_at
     FROM memory_chunks WHERE id > ? ORDER BY id ASC LIMIT ?`
  )
    .bind(after, pageSize)
    .all<MemoryChunkDbRow>();

  const rows = results ?? [];
  const page: PageBackfillResult = {
    aborted: false,
    exhausted: rows.length < pageSize,
    failed: 0,
    lastId: null,
    processed: 0,
    updated: 0,
  };
  const records: ReturnType<typeof toVectorRecord>[] = [];

  for (const row of rows) {
    const regenerated = await regenerateRowEmbedding(env, row);
    if (regenerated.status === "unavailable") {
      // ここに来るのは AI 側の異常。以降も失敗する可能性が高いので中断する
      console.warn(`[memory-backfill] embedding unavailable at ${row.id}; aborting`);
      page.aborted = true;
      break;
    }
    if (regenerated.status === "failed") {
      page.failed++;
    } else {
      page.updated++;
      if (env.VECTORIZE) {
        records.push(
          toVectorRecord(
            {
              id: row.id,
              sessionId: row.session_id,
              articleTitle: row.article_title,
              sourceUrl: row.source_url,
              topicSummary: row.topic_summary,
              keyQuotes: row.key_quotes,
              personaIds: parsePersonaIds(row.persona_ids),
            },
            regenerated.embedding,
            row.created_at
          )
        );
      }
    }
    page.processed++;
    page.lastId = row.id;
  }

  if (records.length > 0 && env.VECTORIZE) {
    try {
      await env.VECTORIZE.upsert(records);
    } catch (err) {
      page.failed += records.length;
      console.warn("[memory-backfill] Vectorize upsert failed:", err);
    }
  }

  return page;
}

/**
 * 既存の memory_chunks 全件の埋め込みを作り直す。
 * 旧ダミーベクトルは本物と区別できないため、embedding_json の有無に関わらず再生成する。
 * - AI 未接続・生成不能になった時点で中断する (ダミーは保存しない)
 * - 1件の失敗では止めず、失敗件数を数えて続行する
 * - id のキーセットページング + maxRows の上限で無限ループを防ぐ
 */
export async function backfillAllMemoryEmbeddings(
  env: Env,
  options: MemoryEmbeddingBackfillOptions = {}
): Promise<MemoryEmbeddingBackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? BACKFILL_PAGE_SIZE);
  const maxRows = Math.max(1, options.maxRows ?? BACKFILL_MAX_ROWS);
  let after = options.after ?? "";

  const totalRow = await env.DB.prepare("SELECT COUNT(*) as total FROM memory_chunks").first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  const result: MemoryEmbeddingBackfillResult = {
    processed: 0,
    updated: 0,
    failed: 0,
    total,
    next: null,
    aborted: false,
  };

  if (!env.AI) {
    // AI が無い環境で走らせても全部失敗するだけなので、最初に止める
    console.warn("[memory-backfill] AI binding unavailable; aborting");
    result.aborted = true;
    return result;
  }

  if (total === 0) {
    return result;
  }

  console.log(`[memory-backfill] start: ${total} 件 (after=${after || "-"})`);

  while (result.processed < maxRows) {
    const pageSize = Math.min(batchSize, maxRows - result.processed);
    const page = await backfillPage(env, after, pageSize);

    result.processed += page.processed;
    result.updated += page.updated;
    result.failed += page.failed;
    console.log(`[memory-backfill] ${result.processed}/${total} 件 (更新 ${result.updated} / 失敗 ${result.failed})`);

    if (page.aborted) {
      result.aborted = true;
      break;
    }
    if (page.exhausted) {
      break;
    }
    if (page.lastId) {
      after = page.lastId;
      result.next = page.lastId;
    }
  }

  // 中断したときに next を返すと、呼び出し側が同じ範囲を無限にリトライしてしまう
  result.next = result.aborted ? null : result.next;
  console.log(
    `[memory-backfill] done: 処理 ${result.processed}/${total} 件 / 更新 ${result.updated} / 失敗 ${result.failed}${result.aborted ? " (中断)" : ""}`
  );
  return result;
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
  const embedding = await generateEmbedding(memoryChunkEmbeddingText(chunk), env);
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
