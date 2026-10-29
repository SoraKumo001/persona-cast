/**
 * 対談の一覧・詳細の読み取り。HTTP API (routes/sessions.ts) と、SSR の loader から呼ぶ
 * server function (src/server-fns/sessions.ts) の両方で使う。
 */
import { DEFAULT_GENRE, isGenre } from "./genres";
import { PERSONA_COLUMNS, toPersona } from "./persona-store";

export const SESSION_COLUMNS =
  "id, source_url as sourceUrl, normalized_url as normalizedUrl, article_title as articleTitle, article_summary as articleSummary, summary, genre, og_json as ogJson, persona_ids as personaIds, created_at as createdAt";

// 発言が1件以上ある対談のみを一覧に出す
const HAS_MESSAGES = "EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id)";

export function toSession(row: any) {
  const { ogJson, ...rest } = row;
  let ogp = null;
  try {
    ogp = ogJson ? JSON.parse(ogJson) : null;
  } catch {
    // 壊れたJSONは無視
  }
  return { ...rest, ogp, personaIds: JSON.parse(rest.personaIds || "[]") };
}

/** 対談の一覧。genre で絞り込み、ジャンル別の件数も返す */
export async function listSessions(db: D1Database, options: { genre?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 48, 1), 100);
  const genre = options.genre && isGenre(options.genre) ? options.genre : undefined;

  const where = genre ? `WHERE ${HAS_MESSAGES} AND genre = ?` : `WHERE ${HAS_MESSAGES}`;
  const binds = genre ? [genre, limit] : [limit];
  const { results } = await db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds)
    .all();
  const sessions = results.map(toSession);

  // カードに出す参加ペルソナを、まとめて1回で取得する
  const ids = [...new Set(sessions.flatMap((s: any) => s.personaIds as string[]))];
  const personaMap = new Map<string, any>();
  if (ids.length > 0) {
    const { results: rows } = await db
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all();
    for (const r of rows) {
      const p = toPersona(r);
      personaMap.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, avatarUrl: p.avatarUrl, themeColor: p.themeColor });
    }
  }

  const { results: genres } = await db
    .prepare(
      `SELECT COALESCE(genre, ?) as genre, COUNT(*) as count FROM sessions WHERE ${HAS_MESSAGES} GROUP BY 1 ORDER BY count DESC, genre ASC`
    )
    .bind(DEFAULT_GENRE)
    .all();

  return {
    sessions: sessions.map((s: any) => ({
      ...s,
      genre: s.genre ?? DEFAULT_GENRE,
      participants: s.personaIds.map((id: string) => personaMap.get(id)).filter(Boolean),
    })),
    genres: genres as { genre: string; count: number }[],
  };
}

/** 対談の詳細。セッション・発言ログ・参加ペルソナ。無ければ null */
export async function getSessionDetail(db: D1Database, id: string) {
  const row: any = await db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).bind(id).first();
  if (!row) return null;
  const session = toSession(row);

  const { results: messages } = await db
    .prepare(
      `SELECT m.id, m.session_id as sessionId, m.persona_id as personaId, m.turn_index as turnIndex,
              m.content, m.referenced_session_id as referencedSessionId, m.referenced_article_title as referencedArticleTitle,
              m.created_at as createdAt, p.name as personaName, p.role as personaRole, p.avatar as personaAvatar,
              p.avatar_type as personaAvatarType, p.avatar_key as personaAvatarKey, p.theme_color as personaThemeColor
       FROM messages m
       LEFT JOIN personas p ON m.persona_id = p.id
       WHERE m.session_id = ?
       ORDER BY m.turn_index ASC`
    )
    .bind(id)
    .all();

  // 参加者は、アーカイブ済みでも対談には出す
  const personaIds: string[] = session.personaIds;
  let participants: ReturnType<typeof toPersona>[] = [];
  if (personaIds.length > 0) {
    const { results: rows } = await db
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${personaIds.map(() => "?").join(",")})`)
      .bind(...personaIds)
      .all();
    const byId = new Map(rows.map((r) => [toPersona(r).id, toPersona(r)]));
    participants = personaIds.map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
  }

  return {
    session,
    participants,
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
  };
}
