import { Env } from "../types";

/** テンプレートを変えたらインクリメントし、R2のキャッシュを無効化する */
const TEMPLATE_VERSION = "v2";

export interface OgpPersona {
  id: string;
  name: string;
  avatar: string;
  themeColor: string;
  /** 画像アバターの data URI (なければ絵文字で描く) */
  avatarDataUri?: string | null;
}

export interface OgpQuote {
  persona: OgpPersona;
  text: string;
}

export interface OgpImageData {
  title: string;
  summary: string;
  sourceUrl: string;
  siteName?: string | null;
  genre?: string | null;
  participantCount: number;
  messageCount: number;
  quotes: OgpQuote[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** CSSの色として安全な #RRGGBB だけ通す (テーマ色はDB由来のためHTMLに埋める前に検証) */
function safeColor(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#6366f1";
}

/** 発言を短い引用にする: 空白を詰め、最初の1〜2文を上限文字数で切る */
export function excerpt(text: string, max = 64): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const sentences = flat.match(/[^。！？!?]+[。！？!?]?/g) ?? [flat];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  return (out || flat.slice(0, max - 1)).trim() + (out === flat ? "" : "…");
}

/** 各ペルソナの最初の発言を、先頭から最大 limit 人分ピックアップする */
export function pickQuotes<T extends { personaId: string; content: string }>(messages: T[], limit = 2): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const m of messages) {
    if (!m.content.trim() || seen.has(m.personaId)) continue;
    seen.add(m.personaId);
    picked.push(m);
    if (picked.length >= limit) break;
  }
  return picked;
}

function avatarHtml(p: OgpPersona, size: number): string {
  const color = safeColor(p.themeColor);
  const inner = p.avatarDataUri
    ? `<img src="${p.avatarDataUri}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;" />`
    : `<div style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${color}40;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.5)}px;">${escapeHtml(p.avatar || p.name.slice(0, 1))}</div>`;
  return `<div style="width:${size + 8}px;height:${size + 8}px;border-radius:${(size + 8) / 2}px;border:4px solid ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${inner}</div>`;
}

/** 1200x630 のOGP画像HTML。ユーザー/記事由来のテキストはすべてエスケープする */
export function buildOgpHtml(d: OgpImageData): string {
  const site = escapeHtml(d.siteName || hostOf(d.sourceUrl));
  const quotes = d.quotes
    .map((q) => {
      const color = safeColor(q.persona.themeColor);
      return `<div style="display:flex;align-items:center;gap:20px;">
  ${avatarHtml(q.persona, 64)}
  <div style="flex:1;background:#ffffff14;border-left:6px solid ${color};border-radius:14px;padding:14px 22px;">
    <div style="font-size:20px;font-weight:700;color:${color};margin-bottom:4px;">${escapeHtml(q.persona.name)}</div>
    <div style="font-size:26px;line-height:1.4;color:#f1f5f9;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(excerpt(q.text))}</div>
  </div>
</div>`;
    })
    .join("\n");

  const stats = d.messageCount > 0 ? `${d.participantCount}人が${d.messageCount}発言で対談` : `${d.participantCount}人が対談`;

  return `<div style="width:1200px;height:630px;box-sizing:border-box;padding:44px 56px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#0b1020 0%,#1e1b4b 100%);color:#ffffff;font-family:'Noto Sans JP',sans-serif;">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:22px;color:#a5b4fc;">
    <div style="font-weight:700;">🎙️ Persona-Cast</div>
    <div style="display:flex;align-items:center;gap:16px;color:#94a3b8;">
      ${d.genre ? `<div style="background:#6366f133;color:#c7d2fe;border-radius:999px;padding:4px 18px;font-size:20px;">${escapeHtml(d.genre)}</div>` : ""}
      <div>${site}</div>
    </div>
  </div>
  <div>
    <div style="font-size:46px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(d.title)}</div>
    <div style="margin-top:12px;font-size:23px;line-height:1.5;color:#cbd5e1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(d.summary)}</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:14px;">
${quotes}
  </div>
  <div style="font-size:20px;color:#94a3b8;text-align:right;">${stats}</div>
</div>`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function loadAvatarDataUri(env: Env, key: string | null | undefined): Promise<string | null> {
  if (!key || !env.AVATARS) return null;
  const obj = await env.AVATARS.get(key);
  if (!obj) return null;
  const type = obj.httpMetadata?.contentType || "image/png";
  return `data:${type};base64,${toBase64(new Uint8Array(await obj.arrayBuffer()))}`;
}

/** 対談セッションのOGP画像(PNG)を返す。内容(発言数)ごとにR2へキャッシュする */
export async function getSessionOgpImage(env: Env, sessionId: string): Promise<Uint8Array | null> {
  const session: any = await env.DB.prepare(
    "SELECT id, source_url, article_title, article_summary, summary, genre, og_json, persona_ids FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first();
  if (!session) return null;

  const { results: messages } = await env.DB.prepare(
    "SELECT persona_id as personaId, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC"
  )
    .bind(sessionId)
    .all<{ personaId: string; content: string }>();

  // 発言数が変わればキーも変わるため、対談の途中状態が固定化されることはない
  const cacheKey = `ogp/${sessionId}/${TEMPLATE_VERSION}-${messages.length}.png`;
  const cached = await env.AVATARS?.get(cacheKey);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const personaIds: string[] = JSON.parse(session.persona_ids || "[]");
  const placeholders = personaIds.map(() => "?").join(",") || "''";
  const { results: personaRows } = await env.DB.prepare(
    `SELECT id, name, avatar, avatar_type, avatar_key, theme_color FROM personas WHERE id IN (${placeholders})`
  )
    .bind(...personaIds)
    .all<any>();
  const personas = new Map<string, any>(personaRows.map((p) => [p.id, p]));

  const quotes: OgpQuote[] = [];
  for (const m of pickQuotes(messages)) {
    const p = personas.get(m.personaId);
    if (!p) continue;
    quotes.push({
      text: m.content,
      persona: {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        themeColor: p.theme_color,
        avatarDataUri: p.avatar_type === "image" ? await loadAvatarDataUri(env, p.avatar_key) : null,
      },
    });
  }

  let ogp: { siteName?: string | null } | null = null;
  try {
    ogp = session.og_json ? JSON.parse(session.og_json) : null;
  } catch {
    // 壊れたJSONは無視
  }

  const html = buildOgpHtml({
    title: session.article_title,
    summary: session.summary || session.article_summary.slice(0, 120),
    sourceUrl: session.source_url,
    siteName: ogp?.siteName,
    genre: session.genre,
    participantCount: personaIds.length,
    messageCount: messages.length,
    quotes,
  });

  // WASM (約12MB) は画像生成時にだけ読み込む
  const { render } = await import("wasm-html-to-image");
  const result = await render({ value: html, width: 1200, height: 630, format: "png" });
  const png = result.data as Uint8Array;

  if (env.AVATARS) {
    await env.AVATARS.put(cacheKey, png, { httpMetadata: { contentType: "image/png" } });
  }
  return png;
}

export interface SiteOgpData {
  personas: OgpPersona[];
}

/** トップページ用の 1200x630 OGP画像HTML。サイトの紹介と、出演するペルソナを並べる */
export function buildSiteOgpHtml(d: SiteOgpData): string {
  const cast = d.personas
    .map(
      (p) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;width:180px;">
  ${avatarHtml(p, 112)}
  <div style="font-size:24px;font-weight:700;color:${safeColor(p.themeColor)};text-align:center;max-width:180px;overflow:hidden;white-space:nowrap;">${escapeHtml(p.name.replace(/\s*[(（].*$/, ""))}</div>
</div>`
    )
    .join("\n");

  return `<div style="width:1200px;height:630px;box-sizing:border-box;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#0b1020 0%,#1e1b4b 100%);color:#ffffff;font-family:'Noto Sans JP',sans-serif;">
  <div style="display:flex;align-items:center;gap:20px;">
    <div style="width:72px;height:72px;border-radius:20px;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:42px;">🎙️</div>
    <div style="font-size:52px;font-weight:700;letter-spacing:-1px;">Persona-Cast</div>
  </div>
  <div>
    <div style="font-size:60px;font-weight:700;line-height:1.3;">URLを貼るだけで、<br/>AIたちが記事を語り合う。</div>
    <div style="margin-top:18px;font-size:28px;line-height:1.5;color:#cbd5e1;">個性の違うAIペルソナが、気になる記事を読んで対談します。</div>
  </div>
  <div style="display:flex;justify-content:flex-start;gap:36px;">
${cast}
  </div>
</div>`;
}

/** 出演者の構成が変わったらキーも変わるようにするための短いハッシュ */
function fingerprint(parts: string[]): string {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/** トップページのOGP画像(PNG)。出演者の構成ごとにR2へキャッシュする */
export async function getSiteOgpImage(env: Env): Promise<Uint8Array> {
  const { results: rows } = await env.DB.prepare(
    "SELECT id, name, avatar, avatar_type, avatar_key, theme_color, updated_at FROM personas WHERE archived_at IS NULL ORDER BY created_at ASC LIMIT 5"
  ).all<any>();

  const cacheKey = `ogp/site/${TEMPLATE_VERSION}-${fingerprint(rows.flatMap((r) => [r.id, r.name, r.avatar_key ?? r.avatar, r.theme_color, r.updated_at ?? ""]))}.png`;
  const cached = await env.AVATARS?.get(cacheKey);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const personas: OgpPersona[] = [];
  for (const r of rows) {
    personas.push({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      themeColor: r.theme_color,
      avatarDataUri: r.avatar_type === "image" ? await loadAvatarDataUri(env, r.avatar_key) : null,
    });
  }

  const { render } = await import("wasm-html-to-image");
  const result = await render({ value: buildSiteOgpHtml({ personas }), width: 1200, height: 630, format: "png" });
  const png = result.data as Uint8Array;
  if (env.AVATARS) {
    await env.AVATARS.put(cacheKey, png, { httpMetadata: { contentType: "image/png" } });
  }
  return png;
}
