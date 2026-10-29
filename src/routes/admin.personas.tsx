import { createFileRoute, redirect } from "@tanstack/react-router";

// 旧URL。ブックマークやリンクが切れないよう、管理画面の本体 (/admin) に転送する
export const Route = createFileRoute("/admin/personas")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", statusCode: 301 });
  },
});
