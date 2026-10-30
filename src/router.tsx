import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // 画面遷移で、古いデータを先に見せてから取り直す (既定の background) のではなく、取り直してから表示する。
    // 対談を作ったあとにトップへ戻ったとき、古い一覧が出ないようにする
    defaultStaleReloadMode: "blocking",
    // リンクへのホバーやフォーカス時にローダーを事前取得して遷移遅延を最小化する
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // ブラウザの View Transitions API を使って画面遷移をなめらかにクロスフェードする
    defaultViewTransition: true,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
