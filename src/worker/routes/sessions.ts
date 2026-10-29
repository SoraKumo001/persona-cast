import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Env } from "../types";
import { scrapeUrl, ScrapeError } from "../services/scraper";
import { normalizeUrl } from "../services/url-normalize";
import { analyzeArticle, defaultTurns, PersonaCandidate } from "../services/analyze";
import { DEFAULT_GENRE, isGenre } from "../services/genres";
import { toPersona, PERSONA_COLUMNS } from "../services/persona-store";
import { searchSimilarMemories } from "../services/memory";
import { orchestrateDialogue } from "../services/dialogue";
import { getSessionOgpImage } from "../services/ogp-image";
import { ensureDatabaseTables } from "../presets";

const app = new Hono<{ Bindings: Env }>();

const SESSION_COLUMNS =
  "id, source_url as sourceUrl, normalized_url as normalizedUrl, article_title as articleTitle, article_summary as articleSummary, summary, genre, og_json as ogJson, persona_ids as personaIds, created_at as createdAt";

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

// 対談の一覧。genre で絞り込み、ジャンル別の件数も返す (発言が1件以上ある対談のみ)
const HAS_MESSAGES = "EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id)";

app.get("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  const genre = c.req.query("genre");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "48", 10) || 48, 1), 100);

  try {
    const where = genre && isGenre(genre) ? `WHERE ${HAS_MESSAGES} AND genre = ?` : `WHERE ${HAS_MESSAGES}`;
    const binds = genre && isGenre(genre) ? [genre, limit] : [limit];
    const { results } = await c.env.DB.prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions ${where} ORDER BY created_at DESC LIMIT ?`
    )
      .bind(...binds)
      .all();
    const sessions = results.map(toSession);

    // カードに出す参加ペルソナを、まとめて1回で取得する
    const ids = [...new Set(sessions.flatMap((s: any) => s.personaIds as string[]))];
    const personaMap = new Map<string, any>();
    if (ids.length > 0) {
      const { results: rows } = await c.env.DB.prepare(
        `SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${ids.map(() => "?").join(",")})`
      )
        .bind(...ids)
        .all();
      for (const r of rows) {
        const p = toPersona(r);
        personaMap.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, avatarUrl: p.avatarUrl, themeColor: p.themeColor });
      }
    }

    const { results: genres } = await c.env.DB.prepare(
      `SELECT COALESCE(genre, ?) as genre, COUNT(*) as count FROM sessions WHERE ${HAS_MESSAGES} GROUP BY 1 ORDER BY count DESC, genre ASC`
    )
      .bind(DEFAULT_GENRE)
      .all();

    return c.json({
      sessions: sessions.map((s: any) => ({
        ...s,
        genre: s.genre ?? DEFAULT_GENRE,
        participants: s.personaIds.map((id: string) => personaMap.get(id)).filter(Boolean),
      })),
      genres,
    });
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return c.json({ sessions: [], genres: [] });
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

// 対談ごとのOGP画像 (1200x630 PNG)。SNS/チャットのリンクプレビュー用
app.get("/:id/ogp.png", async (c) => {
  try {
    const png = await getSessionOgpImage(c.env, c.req.param("id"));
    if (!png) return c.json({ error: "セッションが見つかりません" }, 404);
    return new Response(png as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
    });
  } catch (err: any) {
    console.error("OGP image generation failed:", err);
    return c.json({ error: "OGP画像の生成に失敗しました" }, 500);
  }
});

// 新規対談セッション作成: 入力はURLだけ。要約・ジャンル・参加ペルソナ・発言数は自動で決める
app.post("/", async (c) => {
  if (c.env.DB) await ensureDatabaseTables(c.env.DB);
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });

  if (!body.url) {
    return c.json({ error: "URLは必須です" }, 400);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(body.url);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  // 1. 同じページの対談が既にあれば取得せずそれを返す
  const existingResponse = (row: any) => {
    const s = toSession(row);
    return c.json({
      existing: true,
      sessionId: s.id,
      genre: s.genre ?? DEFAULT_GENRE,
      articleTitle: s.articleTitle,
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

  const { results: candidates } = await c.env.DB.prepare(
    "SELECT id, name, role, personality FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC"
  ).all<PersonaCandidate>();
  if (candidates.length === 0) {
    return c.json({ error: "対談に参加できるペルソナがいません。管理画面でペルソナを追加してください" }, 409);
  }

  const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  // 3. 要約・ジャンル・参加ペルソナの決定と、過去の類似対談記憶の検索
  const [analysis, pastMemories] = await Promise.all([
    analyzeArticle(c.env, sessionId, article, candidates),
    searchSimilarMemories(`${article.title}
${article.content.slice(0, 300)}`, c.env, 3, 0.45),
  ]);

  // 4. セッションをD1に保存
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, source_url, normalized_url, article_title, article_summary, summary, genre, og_json, persona_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      article.url,
      article.normalizedUrl,
      article.title,
      article.content.slice(0, 3000), // 長すぎないよう保存
      analysis.summary,
      analysis.genre,
      JSON.stringify(article.ogp),
      JSON.stringify(analysis.personaIds),
      now
    )
    .run();

  return c.json({
    existing: false,
    sessionId,
    genre: analysis.genre,
    articleTitle: article.title,
    totalTurns: defaultTurns(analysis.personaIds.length),
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
      // 一覧のサムネイル用に、対談の完了後にOGP画像を先に生成してキャッシュしておく
      try {
        c.executionCtx.waitUntil(getSessionOgpImage(c.env, sessionId).catch((e) => console.warn("OGP prewarm failed:", e)));
      } catch {
        // executionCtx がない環境では、初回リクエスト時に生成される
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
