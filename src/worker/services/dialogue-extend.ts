/**
 * 対談長さの必要時延長。山場の直前に一度だけ判定し、足りなければ1巡分伸ばす。
 */
import { errorMessage } from "../errors";
import { buildExtendMessages, type DialoguePromptMode } from "../prompts";
import type { Env } from "../types";
import { extractJsonObject } from "./json-object";
import { generateChatCompletion } from "./llm";

export interface ExtendDecision {
  extend: boolean;
  reason?: string;
}

export interface ShouldExtendParams {
  articleTitle: string;
  history: { personaName: string; text: string }[];
  keyPoints?: readonly string[] | string;
  mode?: DialoguePromptMode;
}

export interface ShouldExtendOptions {
  generate?: typeof generateChatCompletion;
  modelName?: string;
}

/** 延長量。出演者全員がもう1回ずつ話す分 */
export function extensionAmount(speakerCount: number): number {
  return Math.max(1, speakerCount);
}

/** 延長後の上限。開始時の長さ + 1巡 */
export function maxTurnsAfterExtend(baseTurns: number, speakerCount: number): number {
  return baseTurns + extensionAmount(speakerCount);
}

/**
 * 山場ターンの直前かどうか。
 * すでに延長済みなら再判定しない。totalTurns が短すぎて山場が無い場合も判定しない。
 */
export function isExtendCheckTurn(turn: number, totalTurns: number, alreadyExtended: boolean): boolean {
  if (alreadyExtended || totalTurns < 4) {
    return false;
  }
  return turn === totalTurns - 2;
}

/** LLM 応答から延長判定を取り出す。読めなければ延長しない (fail-closed) */
export function parseExtendDecision(raw: string): ExtendDecision {
  const cleaned = raw
    .replace(/```json/giu, "")
    .replace(/```/gu, "")
    .trim();
  const parsed = extractJsonObject(cleaned)?.raw;
  if (!parsed) {
    return { extend: false };
  }
  const extend = parsed.extend === true || parsed.extend === "true";
  const reason = typeof parsed.reason === "string" ? parsed.reason.replace(/\s+/gu, " ").trim().slice(0, 40) : undefined;
  return reason ? { extend, reason } : { extend };
}

/**
 * 山場直前の延長判定。失敗・不正応答時は延長しない。
 * 呼び出し側で isExtendCheckTurn / 上限を守ること。
 */
export async function shouldExtendDialogue(
  params: ShouldExtendParams,
  env: Env,
  sessionId: string,
  options: ShouldExtendOptions = {}
): Promise<ExtendDecision> {
  const generate = options.generate ?? generateChatCompletion;
  try {
    const messages = buildExtendMessages({
      articleTitle: params.articleTitle,
      history: params.history,
      keyPoints: params.keyPoints,
      mode: params.mode,
    });
    const raw = await generate(messages, env, sessionId, options.modelName, { maxOutputTokens: 200 });
    return parseExtendDecision(raw);
  } catch (err) {
    console.warn("Dialogue extend check failed; keeping length:", errorMessage(err));
    return { extend: false };
  }
}
