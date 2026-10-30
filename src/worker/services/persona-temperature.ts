/**
 * ペルソナ別 temperature のパイロット (A/B) 用マップ。
 *
 * DB には持たせず (マイグレーション不要)、ここにハードコードする。
 * `PERSONA_TEMP_PILOT=off` を渡すと全員が既定値 0.75 に戻り、パイロット前の挙動と一致する。
 *
 * 設計意図:
 *   レン (慎重派・論理派) は低め (0.3) で再現性と論理の一貫性を優先。
 *   ケン (辛口エンジニア) は 0.4 で具体性と辛口の切れ味を保つ。
 *   ユキ (楽観派 PM) は 0.6 で発想のばらつきを残しつつ暴走は抑える。
 *   マップに無いペルソナ (管理画面で追加されたもの) は既定 0.75。
 */
import type { Env } from "../types";
import { DEFAULT_STREAM_TEMPERATURE } from "./llm";

/** パイロット対象のペルソナID → temperature。ここを変えるだけで配分を調整できる */
export const PERSONA_TEMPERATURE_PILOT: Readonly<Record<string, number>> = {
  yuki: 0.6,
  ken: 0.4,
  ren: 0.3,
};

/** パイロットを止める env の値 */
export const PERSONA_TEMP_PILOT_OFF = "off";

/** temperature として妥当な範囲 (ai-sdk / OpenAI 互換 API の許容範囲) */
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

/**
 * 発言者1人分の temperature を返す。
 * パイロットが off、マップに無い、値が不正、のいずれでも既定値 0.75 にフォールバックする。
 */
export function personaTemperature(personaId: string, env: Pick<Env, "PERSONA_TEMP_PILOT">): number {
  if (env.PERSONA_TEMP_PILOT === PERSONA_TEMP_PILOT_OFF) {
    return DEFAULT_STREAM_TEMPERATURE;
  }
  const value = PERSONA_TEMPERATURE_PILOT[personaId];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STREAM_TEMPERATURE;
  }
  return Math.min(Math.max(value, MIN_TEMPERATURE), MAX_TEMPERATURE);
}
