import { createFileRoute } from "@tanstack/react-router";
import { SessionView } from "../client/components/SessionView";
import { getSessionMeta } from "../server-fns/session-meta";
import { getRelatedSessionsFn, getSessionDetailFn } from "../server-fns/sessions";

export const Route = createFileRoute("/s/$id")({
  loader: async ({ params }) => {
    const [meta, detail] = await Promise.all([
      getSessionMeta({ data: params.id }),
      getSessionDetailFn({ data: params.id }),
    ]);
    // 生成済みの対談だけ、近い過去の対談を添える
    const related = detail && detail.messages.length > 0 ? await getRelatedSessionsFn({ data: params.id }) : [];
    return { meta, detail, related };
  },
  head: ({ loaderData }) =>
    loaderData?.meta
      ? {
          meta: [
            { title: loaderData.meta.title },
            { name: "description", content: loaderData.meta.description },
            { property: "og:type", content: "article" },
            { property: "og:site_name", content: "Persona-Cast" },
            { property: "og:title", content: loaderData.meta.title },
            { property: "og:description", content: loaderData.meta.description },
            { property: "og:url", content: loaderData.meta.pageUrl },
            { property: "og:image", content: loaderData.meta.imageUrl },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
            { name: "twitter:card", content: "summary_large_image" },
            { name: "twitter:image", content: loaderData.meta.imageUrl },
          ],
          links: [{ rel: "canonical", href: loaderData.meta.pageUrl }],
          scripts: loaderData.detail
            ? [
                {
                  type: "application/ld+json",
                  children: JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "Article",
                    headline: loaderData.detail.session.articleTitle,
                    description: loaderData.meta.description,
                    datePublished: loaderData.detail.session.createdAt,
                    inLanguage: "ja",
                    image: loaderData.meta.imageUrl,
                    mainEntityOfPage: loaderData.meta.pageUrl,
                    publisher: { "@type": "Organization", name: "Persona-Cast" },
                  }).replace(/</gu, "\\u003c"),
                },
              ]
            : [],
        }
      : // 存在しない・非表示の対談は、検索結果に残さない
        { meta: [{ name: "robots", content: "noindex" }] },
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const { detail, meta, related } = Route.useLoaderData();
  // 別の対談に移ったら状態ごと作り直す
  return <SessionView detail={detail} id={id} key={id} pageUrl={meta?.pageUrl ?? null} related={related} />;
}
