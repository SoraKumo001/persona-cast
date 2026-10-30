import type { getRelatedSessionsFn, getSessionDetailFn } from "../../server-fns/sessions";

/** loader が返す対談詳細 */
export type SessionDetail = NonNullable<Awaited<ReturnType<typeof getSessionDetailFn>>>;
/** loader が返す関連対談 */
export type RelatedSession = Awaited<ReturnType<typeof getRelatedSessionsFn>>;
export type SavedMessage = SessionDetail["messages"][number];
