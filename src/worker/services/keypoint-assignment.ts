/**
 * 論点割当パイロット (A/B)。
 *
 * 記事の論点 (最大3つ) を出演者へ順番に割り当て、各発言者に「自分の担当論点」を1行だけ渡す。
 * 全員が同じ根拠を並べるのを避け、根拠の重複を減らすのが目的。
 *
 * DB には保存しない (マイグレーション不要)。`KEYPOINT_ASSIGN=off` で割当を止めると
 * パイロット前と同じプロンプトに戻る。stance / temperature のロジックには触れない。
 */
import { normalizeKeyPoints } from "../prompts";
import type { Env } from "../types";

/** 割当を止める env の値 */
export const KEYPOINT_ASSIGN_OFF = "off";

/** 1対談で割り当てる論点の上限 (分析側の keyPoints 上限と揃える) */
export const MAX_ASSIGNED_KEYPOINTS = 3;

export type KeyPointAssignments = ReadonlyMap<string, readonly string[]>;

/**
 * 論点を personas の順に分散所有させる。
 * keyPoints[i] は personas[i % personas.length] の担当になる (3:3 以外は剰余で配る)。
 * 2人に3論点なら、先頭の人が2つ、2人目が1つを持つ。
 */
export function assignKeyPoints(
  personas: readonly { id: string }[],
  keyPoints: readonly string[] | string | undefined,
  env: Pick<Env, "KEYPOINT_ASSIGN">
): KeyPointAssignments {
  const assignments = new Map<string, string[]>();
  if (env.KEYPOINT_ASSIGN === KEYPOINT_ASSIGN_OFF || personas.length === 0) {
    return assignments;
  }

  for (const [index, point] of normalizeKeyPoints(keyPoints).slice(0, MAX_ASSIGNED_KEYPOINTS).entries()) {
    const persona = personas[index % personas.length];
    const owned = assignments.get(persona.id) ?? [];
    if (!owned.includes(point)) {
      owned.push(point);
    }
    assignments.set(persona.id, owned);
  }
  return assignments;
}
