import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PersonaAvatar } from "../client/components/PersonaAvatar";
import { SessionCard } from "../client/components/SessionCard";
import type { SessionListItem } from "../client/lib/api";
import { getPersonaPageFn } from "../server-fns/sessions";
import { getSiteOrigin } from "../server-fns/site-meta";

export const Route = createFileRoute("/persona/$id")({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = Number(search.page);
    return Number.isInteger(page) && page > 1 ? { page } : {};
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ params, deps }) => {
    const [data, origin] = await Promise.all([
      getPersonaPageFn({ data: { id: params.id, page: deps.page } }),
      getSiteOrigin(),
    ]);
    return { data, origin };
  },
  head: ({ loaderData }) => {
    const persona = loaderData?.data?.persona;
    if (!persona) {
      return { meta: [{ name: "robots", content: "noindex" }] };
    }
    const title = `${persona.name}｜${persona.role} | Persona-Cast`;
    const description = persona.personality.slice(0, 120);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:site_name", content: "Persona-Cast" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: `${loaderData.origin}/api/ogp.png` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: `${loaderData.origin}/api/ogp.png` },
      ],
      links: [{ rel: "canonical", href: `${loaderData.origin}/persona/${encodeURIComponent(persona.id)}` }],
    };
  },
  component: PersonaPage,
});

function PersonaPage() {
  const { data } = Route.useLoaderData();
  const { id } = Route.useParams();

  if (!data) {
    return (
      <div className="space-y-3 py-24 text-center">
        <p className="text-zinc-300">ペルソナが見つかりません</p>
        <Link className="text-sm text-indigo-300 hover:text-indigo-200" to="/">
          対談一覧へ
        </Link>
      </div>
    );
  }

  const { persona, list } = data;
  const sessions = list.sessions as SessionListItem[];

  return (
    <div className="space-y-8">
      <nav aria-label="パンくず" className="text-xs text-zinc-400">
        <Link className="hover:text-zinc-200" to="/">
          対談一覧
        </Link>
        <span aria-hidden> / </span>
        <span>{persona.name}</span>
      </nav>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <PersonaAvatar {...persona} size={96} />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{persona.name}</h1>
            <p className="text-sm" style={{ color: persona.themeColor }}>
              {persona.role}
            </p>
          </div>
          <dl className="space-y-2 text-sm leading-relaxed">
            <div>
              <dt className="text-xs text-zinc-500">性格・価値観</dt>
              <dd className="text-zinc-200">{persona.personality}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">口調・話し方</dt>
              <dd className="text-zinc-200">{persona.speakingStyle}</dd>
            </div>
          </dl>
          {persona.archivedAt ? (
            <p className="text-xs text-zinc-500">このペルソナは、新しい対談には参加しません。</p>
          ) : null}
        </div>
      </header>

      <section aria-labelledby="persona-sessions" className="space-y-4">
        <h2 className="text-lg font-semibold" id="persona-sessions">
          参加した対談 <span className="text-sm font-normal text-zinc-500">{list.total}</span>
        </h2>
        {sessions.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">まだ参加した対談がありません。</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionCard session={s} />
              </li>
            ))}
          </ul>
        )}
        {list.totalPages > 1 && <PageLinks id={id} page={list.page} totalPages={list.totalPages} />}
      </section>
    </div>
  );
}

/** 前へ・次へ。各ページは ?page=N のリンクにして、URLで共有できSSRもキャッシュも効くようにする */
function PageLinks({ id, page, totalPages }: { id: string; page: number; totalPages: number }) {
  const cell = "inline-flex h-9 items-center justify-center gap-1 rounded-lg border px-3 text-sm transition-colors";
  const idle = "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600";
  const off = "border-zinc-900 text-zinc-600";
  const searchFor = (p: number) => (p > 1 ? { page: p } : {});

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-3 pt-2">
      {page > 1 ? (
        <Link className={`${cell} ${idle}`} params={{ id }} rel="prev" search={searchFor(page - 1)} to="/persona/$id">
          <ChevronLeft className="h-4 w-4" /> 前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={`${cell} ${off}`}>
          <ChevronLeft className="h-4 w-4" /> 前へ
        </span>
      )}
      <span className="text-sm text-zinc-400">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link className={`${cell} ${idle}`} params={{ id }} rel="next" search={searchFor(page + 1)} to="/persona/$id">
          次へ <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-disabled="true" className={`${cell} ${off}`}>
          次へ <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
