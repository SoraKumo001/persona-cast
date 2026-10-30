/**
 * 管理者による対談の再生成。要約・ジャンル・参加ペルソナを取り直し、発言と記憶を消して、
 * 「未生成」の状態に戻す。実際の生成は、そのあと対談ページを開いたときに (新規の対談と同じく) 始まる。
 */
import type { Env } from "../types";
import { ADULT_MESSAGE } from "./adult-filter";
import { analyzeArticle, buildArticleSummary } from "./analyze";
import { listPersonaCandidates } from "./persona-store";
import { type OgpInfo, type ScrapedArticle, scrapeUrl } from "./scraper";

/** 生成中とみなす時間 (routes/sessions.ts の /stream と同じ) */
const GENERATING_MS = 10 * 60 * 1000;

interface SessionForRegenerate {
  article_summary: string;
  article_title: string;
  generating_at: string | null;
  og_json: string | null;
  source_url: string;
}

export interface RegenerateDeps {
  analyze: typeof analyzeArticle;
  scrape: (url: string) => Promise<ScrapedArticle>;
}

export type RegenerateResult =
  | { ok: true; genre: string; personaIds: string[]; scraped: boolean }
  | { ok: false; error: string; status: 400 | 404 | 409 };

const EMPTY_OGP: OgpInfo = { title: null, description: null, image: null, siteName: null, type: null, favicon: null };

function parseOgp(json: string | null): OgpInfo {
  try {
    return json ? { ...EMPTY_OGP, ...(JSON.parse(json) as Partial<OgpInfo>) } : EMPTY_OGP;
  } catch {
    return EMPTY_OGP;
  }
}

export async function regenerateSession(
  env: Env,
  sessionId: string,
  deps: RegenerateDeps = { scrape: scrapeUrl, analyze: analyzeArticle }
): Promise<RegenerateResult> {
  const row = await env.DB.prepare(
    "SELECT source_url, article_title, article_summary, og_json, generating_at FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first<SessionForRegenerate>();
  if (!row) {
    return { ok: false, status: 404, error: "対談が見つかりません" };
  }
  if (row.generating_at && Date.parse(row.generating_at) > Date.now() - GENERATING_MS) {
    return { ok: false, status: 409, error: "この対談は生成中です。終わってから再生成してください" };
  }

  // 記事を取り直す。取れなければ、保存してある本文で分析する
  let article = {
    title: row.article_title,
    content: row.article_summary,
    ogp: parseOgp(row.og_json),
    normalizedUrl: row.source_url,
  };
  let scraped = false;
  try {
    const fresh = await deps.scrape(row.source_url);
    if (fresh.adultRated) {
      return { ok: false, status: 400, error: ADULT_MESSAGE };
    }
    article = { title: fresh.title, content: fresh.content, ogp: fresh.ogp, normalizedUrl: fresh.normalizedUrl };
    scraped = true;
  } catch (err) {
    console.warn(`regenerate: scrape failed, using stored content session=${sessionId}:`, err);
  }

  const candidates = await listPersonaCandidates(env.DB);
  if (candidates.length === 0) {
    return { ok: false, status: 409, error: "対談に参加できるペルソナがいません" };
  }
  const analysis = await deps.analyze(env, sessionId, article, candidates);
  // 分析の結果が成人向けなら、何も消さずに断る (必要なら管理者が非表示にする)
  if (analysis.adult) {
    return { ok: false, status: 400, error: ADULT_MESSAGE };
  }

  // 消す記憶のIDを先に控えておく (検索用の Vectorize からも消すため)
  const { results: memories } = await env.DB.prepare("SELECT id FROM memory_chunks WHERE session_id = ?")
    .bind(sessionId)
    .all<{ id: string }>();

  // 1つのまとまりとして反映する。途中で失敗しても、半端な状態にならない
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET article_title = ?, article_summary = ?, og_json = ?, summary = ?, genre = ?,
              persona_ids = ?, generating_at = NULL WHERE id = ?`
    ).bind(
      article.title,
      buildArticleSummary(analysis, article.content),
      JSON.stringify(article.ogp),
      analysis.summary,
      analysis.genre,
      JSON.stringify(analysis.personaIds),
      sessionId
    ),
    env.DB.prepare("DELETE FROM messages WHERE session_id = ?").bind(sessionId),
    env.DB.prepare("DELETE FROM memory_chunks WHERE session_id = ?").bind(sessionId),
  ]);

  // 検索用の記憶と、対談のOGP画像 (発言数が同じだと古い画像が使われてしまう) も消す。失敗しても再生成は成功とする
  if (env.VECTORIZE && memories.length > 0) {
    await env.VECTORIZE.deleteByIds(memories.map((m) => m.id)).catch((err: unknown) =>
      console.warn("regenerate: Vectorize delete failed:", err)
    );
  }
  if (env.AVATARS) {
    try {
      const listed = await env.AVATARS.list({ prefix: `ogp/${sessionId}/` });
      await Promise.all(listed.objects.map((o) => env.AVATARS?.delete(o.key)));
    } catch (err) {
      console.warn("regenerate: OGP image cleanup failed:", err);
    }
  }

  return { ok: true, genre: analysis.genre, personaIds: analysis.personaIds, scraped };
}
