/**
 * 対談の一覧・詳細の読み取り。HTTP API (routes/sessions.ts) と、SSR の loader から呼ぶ
 * server function (src/server-fns/sessions.ts) の両方で使う。
 */
import type { MessageRow, PersonaRow, SessionRow } from "../db-types";
import { DEFAULT_GENRE, isGenre } from "./genres";
import { PERSONA_COLUMNS, toPersona } from "./persona-store";
import type { OgpInfo } from "./scraper";

export const SESSION_COLUMNS =
  "id, source_url as sourceUrl, normalized_url as normalizedUrl, article_title as articleTitle, article_summary as articleSummary, summary, genre, og_json as ogJson, persona_ids as personaIds, created_at as createdAt";

// 発言が1件以上ある対談のみを一覧に出す
const HAS_MESSAGES = "EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id)";

export function toSession(row: SessionRow) {
  const { ogJson, personaIds, ...rest } = row;
  let ogp: OgpInfo | null = null;
  try {
    ogp = ogJson ? (JSON.parse(ogJson) as OgpInfo) : null;
  } catch {
    // 壊れたJSONは無視
  }
  return { ...rest, ogp, personaIds: JSON.parse(personaIds || "[]") as string[] };
}

/** 一覧のカードに出す、参加ペルソナの要約 */
export interface ParticipantSummary {
  avatar: string;
  avatarUrl: string | null | undefined;
  id: string;
  name: string;
  themeColor: string;
}

export const PAGE_SIZE = 24;

/** 対談の一覧。genre で絞り込み、ジャンル別の件数と、ページ送りの情報も返す */
export async function listSessions(db: D1Database, options: { genre?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(options.pageSize ?? PAGE_SIZE, 1), 100);
  const genre = options.genre && isGenre(options.genre) ? options.genre : undefined;

  const where = genre ? `WHERE ${HAS_MESSAGES} AND genre = ?` : `WHERE ${HAS_MESSAGES}`;
  const filterBinds = genre ? [genre] : [];

  const countRow = await db
    .prepare(`SELECT COUNT(*) as count FROM sessions ${where}`)
    .bind(...filterBinds)
    .first<{ count: number }>();
  const total = countRow?.count ?? 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  // 範囲外のページは端に寄せる (対談が減った後に古いURLを開いても空にならない)
  const page = Math.min(Math.max(Math.trunc(options.page ?? 1) || 1, 1), totalPages);

  const { results } = await db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...filterBinds, pageSize, (page - 1) * pageSize)
    .all<SessionRow>();
  const sessions = results.map(toSession);

  // カードに出す参加ペルソナを、まとめて1回で取得する
  const ids = [...new Set(sessions.flatMap((s) => s.personaIds))];
  const personaMap = new Map<string, ParticipantSummary>();
  if (ids.length > 0) {
    const { results: rows } = await db
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<PersonaRow>();
    for (const r of rows) {
      const p = toPersona(r);
      personaMap.set(p.id, {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        avatarUrl: p.avatarUrl,
        themeColor: p.themeColor,
      });
    }
  }

  const { results: genres } = await db
    .prepare(
      `SELECT COALESCE(genre, ?) as genre, COUNT(*) as count FROM sessions WHERE ${HAS_MESSAGES} GROUP BY 1 ORDER BY count DESC, genre ASC`
    )
    .bind(DEFAULT_GENRE)
    .all<{ genre: string; count: number }>();

  return {
    sessions: sessions.map((s) => ({
      ...s,
      genre: s.genre ?? DEFAULT_GENRE,
      participants: s.personaIds
        .map((id) => personaMap.get(id))
        .filter((p): p is ParticipantSummary => p !== undefined),
    })),
    genres,
    page,
    pageSize,
    total,
    totalPages,
  };
}

/** 対談の詳細。セッション・発言ログ・参加ペルソナ。無ければ null */
export async function getSessionDetail(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).bind(id).first<SessionRow>();
  if (!row) {
    return null;
  }
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
    .all<MessageRow>();

  // 参加者は、アーカイブ済みでも対談には出す
  const personaIds: string[] = session.personaIds;
  let participants: ReturnType<typeof toPersona>[] = [];
  if (personaIds.length > 0) {
    const { results: rows } = await db
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id IN (${personaIds.map(() => "?").join(",")})`)
      .bind(...personaIds)
      .all<PersonaRow>();
    const byId = new Map(rows.map((r) => [toPersona(r).id, toPersona(r)]));
    participants = personaIds.map((pid) => byId.get(pid)).filter((p): p is NonNullable<typeof p> => !!p);
  }

  return {
    session,
    participants,
    messages: messages.map((m) => {
      const { personaAvatarKey, personaAvatarType, ...rest } = m;
      return {
        ...rest,
        personaAvatarUrl:
          personaAvatarType === "image" && personaAvatarKey
            ? `/api/personas/${m.personaId}/avatar?v=${encodeURIComponent(personaAvatarKey.split("/").pop() ?? "")}`
            : null,
      };
    }),
  };
}
