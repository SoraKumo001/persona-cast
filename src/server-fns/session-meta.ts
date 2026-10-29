import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

export interface SessionMeta {
  description: string;
  imageUrl: string;
  pageUrl: string;
  title: string;
}

/** SSR時にリンクプレビュー用の <meta> に使うセッション情報を、D1から直接取得する */
export const getSessionMeta = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }): Promise<SessionMeta | null> => {
    const { env } = await import("cloudflare:workers");
    const row = await (env as { DB: D1Database }).DB.prepare(
      "SELECT article_title, summary, article_summary, persona_ids FROM sessions WHERE id = ?"
    )
      .bind(id)
      .first<{ article_summary: string; article_title: string; persona_ids: string; summary: string | null }>();
    if (!row) {
      return null;
    }

    const { origin } = getRequestUrl();
    const { length: personas } = JSON.parse(row.persona_ids || "[]");
    const summary: string = row.summary || row.article_summary.slice(0, 120);
    return {
      title: `${row.article_title} | Persona-Cast`,
      description: `${personas}人のAIペルソナの対談: ${summary}`.slice(0, 200),
      imageUrl: `${origin}/api/sessions/${encodeURIComponent(id)}/ogp.png`,
      pageUrl: `${origin}/s/${encodeURIComponent(id)}`,
    };
  });
