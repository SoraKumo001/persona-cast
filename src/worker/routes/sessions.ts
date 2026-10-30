import { Hono } from "hono";
import type { Env } from "../types";
import sessionsDetailRouter from "./sessions-detail";
import sessionsListRouter from "./sessions-list";
import sessionsOgpRouter from "./sessions-ogp";
import sessionsStreamRouter from "./sessions-stream";

// 対談APIの集約。実装は責務ごとのルーターに分割し、パスは従来どおり
// /  (一覧・作成), /:id (詳細), /:id/ogp.png (OGP), /:id/stream (生成SSE)
const app = new Hono<{ Bindings: Env }>();

app.route("/", sessionsListRouter);
app.route("/", sessionsOgpRouter);
app.route("/", sessionsStreamRouter);
// /:id は最後に登録し、より具体的なパスを先に解決させる
app.route("/", sessionsDetailRouter);

export default app;
