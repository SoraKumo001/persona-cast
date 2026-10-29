import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Env } from "../types";
import { scrapeUrl, ScrapeError } from "../services/scraper";
import { normalizeUrl } from "../services/url-normalize";
import { extractiveSummary, summarizeArticle } from "../services/summary";
import { searchSimilarMemories } from "../services/memory";
import { orchestrateDialogue } from "../services/dialogue";
import { ensureDatabaseTables } from "../presets";

const app = new Hono<{ Bindings: Env }>();

const SESSION_COLUMNS =
  "id, source_url as sourceUrl, normalized_url as normalizedUrl, article_title as articleTitle, article_summary as articleSummary, summary, og_json as ogJson, persona_ids as personaIds, created_at as createdAt";

function toSession(row: any) {
  const { ogJson, ...rest } = row;
  let ogp = null;
  try {
    ogp = ogJson ? JSON.parse(ogJson) : null;
  } catch {
    // 壊れたJSONは無視
  }
  return { ...rest, ogp, personaIds: JSON.parse(rest.personaIds || "[]") };
}

async function findSessionByNormalizedUrl(db: D1Database, normalizedUrl: string) {
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE normalized_url = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(normalizedUrl)
    .first();
}

// URLプレビュー: OGP・短い要約・既存対談の有無 (LLMは呼ばない)
app.post("/preview", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  const { url } = await c.req.json<{ url?: string }>();
  if (!url) return c.json({ error: "URLは必須です" }, 400);

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(url);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  const existing: any = await findSessionByNormalizedUrl(c.env.DB, normalizedUrl);
  if (existing) {
    const s = toSession(existing);
    return c.json({
      normalizedUrl,
      existingSessionId: s.id,
      title: s.articleTitle,
      summary: s.summary || extractiveSummary(s.articleSummary, s.ogp ?? emptyOgp()),
      ogp: s.ogp,
    });
  }

  try {
    const article = await scrapeUrl(url);
    const dup: any = article.normalizedUrl !== normalizedUrl
      ? await findSessionByNormalizedUrl(c.env.DB, article.normalizedUrl)
      : null;
    return c.json({
      normalizedUrl: article.normalizedUrl,
      existingSessionId: dup?.id ?? null,
      title: article.title,
      summary: extractiveSummary(article.content, article.ogp),
      ogp: article.ogp,
    });
  } catch (err: any) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return c.json({ error: `記事の取得に失敗しました: ${err.message}` }, status);
  }
});

function emptyOgp() {
  return { title: null, description: null, image: null, siteName: null, favicon: null, type: null };
}

// セッション一覧取得
app.get("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY created_at DESC LIMIT 30`
    ).all();
    return c.json({ sessions: results.map(toSession) });
  } catch (err) {
    return c.json({ sessions: [] });
  }
});

// セッション詳細と発言ログの取得
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const session: any = await c.env.DB.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`)
    .bind(id)
    .first();

  if (!session) {
    return c.json({ error: "セッションが見つかりません" }, 404);
  }

  const { results: messages } = await c.env.DB.prepare(
    `SELECT m.id, m.session_id as sessionId, m.persona_id as personaId, m.turn_index as turnIndex,
            m.content, m.referenced_session_id as referencedSessionId, m.referenced_article_title as referencedArticleTitle,
            m.created_at as createdAt, p.name as personaName, p.avatar as personaAvatar, p.avatar_type as personaAvatarType,
            p.avatar_key as personaAvatarKey, p.theme_color as personaThemeColor
     FROM messages m
     LEFT JOIN personas p ON m.persona_id = p.id
     WHERE m.session_id = ?
     ORDER BY m.turn_index ASC`
  )
    .bind(id)
    .all();

  return c.json({
    session: toSession(session),
    messages: messages.map((m: any) => {
      const { personaAvatarKey, personaAvatarType, ...rest } = m;
      return {
        ...rest,
        personaAvatarUrl:
          personaAvatarType === "image" && personaAvatarKey
            ? `/api/personas/${m.personaId}/avatar?v=${encodeURIComponent(personaAvatarKey.split("/").pop())}`
            : null,
      };
    }),
  });
});

// 新規対談セッション作成 (URL正規化・既存対談の再利用・URL抽出・記憶照会)
app.post("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  const body = await c.req.json<{
    url: string;
    personaIds: string[];
    totalTurns?: number;
    modelName?: string;
  }>();

  if (!body.url) {
    return c.json({ error: "URLは必須です" }, 400);
  }
  if (!body.personaIds || body.personaIds.length === 0) {
    return c.json({ error: "少なくとも1人以上のペルソナを選択してください" }, 400);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(body.url);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  // 1. 同じページの対談が既にあれば取得せずそれを返す
  const existingResponse = async (row: any) => {
    const s = toSession(row);
    return c.json({
      existing: true,
      sessionId: s.id,
      articleTitle: s.articleTitle,
      articleSummary: s.summary ?? s.articleSummary.slice(0, 200),
      sourceUrl: s.sourceUrl,
      ogp: s.ogp,
      personaIds: s.personaIds,
      pastMemories: [],
    });
  };
  const existing = await findSessionByNormalizedUrl(c.env.DB, normalizedUrl);
  if (existing) return existingResponse(existing);

  // 2. URLから記事内容・OGPを抽出
  let article;
  try {
    article = await scrapeUrl(body.url);
  } catch (err: any) {
    const status = err instanceof ScrapeError ? 400 : 502;
    return c.json({ error: `記事の取得に失敗しました: ${err.message}` }, status);
  }

  // canonical / リダイレクト後のURLで一致する既存対談があればそれを返す
  if (article.normalizedUrl !== normalizedUrl) {
    const dup = await findSessionByNormalizedUrl(c.env.DB, article.normalizedUrl);
    if (dup) return existingResponse(dup);
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  // 3. 短い要約の生成と、過去の類似対談記憶の検索 (Workers AI Embedding + Vectorize/D1)
  const [summary, pastMemories] = await Promise.all([
    summarizeArticle(c.env, sessionId, article),
    searchSimilarMemories(`${article.title}\n${article.content.slice(0, 300)}`, c.env, 3, 0.45),
  ]);

  // 4. セッションをD1に保存
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, source_url, normalized_url, article_title, article_summary, summary, og_json, persona_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      article.url,
      article.normalizedUrl,
      article.title,
      article.content.slice(0, 3000), // 長すぎないよう保存
      summary,
      JSON.stringify(article.ogp),
      JSON.stringify(body.personaIds),
      now
    )
    .run();

  return c.json({
    existing: false,
    sessionId,
    articleTitle: article.title,
    articleSummary: summary,
    sourceUrl: article.url,
    ogp: article.ogp,
    personaIds: body.personaIds,
    pastMemories: pastMemories.map((m) => ({
      sessionId: m.sessionId,
      articleTitle: m.articleTitle,
      topicSummary: m.topicSummary,
      score: Math.round(m.score * 100) / 100,
    })),
  });
});

// SSEによるリアルタイム対談ストリーミング
app.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const totalTurns = parseInt(c.req.query("turns") || "6", 10);
  const modelName = c.req.query("model") || undefined;

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of orchestrateDialogue(sessionId, c.env, totalTurns, modelName)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      }
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err.message || "Unknown error" }),
      });
    }
  });
});

export default app;
