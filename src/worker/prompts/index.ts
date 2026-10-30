/**
 * LLMに渡すプロンプトの組み立て。文面は同じディレクトリの *.md にあり、
 * ビルド時に ?raw で文字列として埋め込まれる (Workers にはファイルシステムがないため)。
 * ここには「どのテンプレートに何を差し込むか」という組み立てだけを置く。
 */
import type { ChatMessage } from "../services/llm";
import type { MemorySearchResult } from "../services/memory";
import analyzeSystem from "./analyze-system.md?raw";
import analyzeUser from "./analyze-user.md?raw";
import consolidateSystem from "./consolidate-system.md?raw";
import consolidateUser from "./consolidate-user.md?raw";
import dialogueInstructionFinal from "./dialogue-instruction-final.md?raw";
import dialogueInstructionReply from "./dialogue-instruction-reply.md?raw";
import dialogueMemoryItem from "./dialogue-memory-item.md?raw";
import dialogueOpening from "./dialogue-opening.md?raw";
import dialogueSpeaker from "./dialogue-speaker.md?raw";
import dialogueSystem from "./dialogue-system.md?raw";
import dialogueTurn from "./dialogue-turn.md?raw";
import personaGenerateModify from "./persona-generate-modify.md?raw";
import personaGenerateNew from "./persona-generate-new.md?raw";
import personaGenerateOthers from "./persona-generate-others.md?raw";
import personaGenerateSystem from "./persona-generate-system.md?raw";
import { renderPrompt } from "./render";

// 対談履歴は直近のこの件数だけをプロンプトに載せる (古い発言で文脈とトークンを圧迫しないため)
export const DIALOGUE_HISTORY_LIMIT = 6;

// 発言の長さに落差を付けるため、ターンごとに長さの目安を循環させる (全発言が同じ長さになるのを防ぐ)
const LENGTH_HINTS = [
  "一言〜一文だけ(40文字以内)の短い返し",
  "2〜3文(100文字前後)",
  "短めに1〜2文(60文字前後)",
  "しっかり語る。4〜5文(180文字前後)",
  "一言の相槌や反応のあと、一文だけ付け足す(50文字前後)",
];

/**
 * 中盤の区間。ここが「賛成です」級の短い相槌だけに崩落しやすい。
 * 9ターンなら 4〜7ターン目 (turnIndex 3〜6) が中盤になる。
 * 末尾2ターン (締めの直前と最終ターン) は総括と役割が重なるので中盤扱いしない。
 */
const MID_TURN_START_INDEX = 3;
const MID_TURN_TAIL_MARGIN = 2;
const MID_TURN_MIN_TOTAL_TURNS = 6;

/** 中盤は下限を上げる。短い相槌で流れるのを防ぎつつ、最終ターンの総括と長さがかぶらない範囲に収める */
const MID_TURN_LENGTH_HINT = "3〜5文(80〜180文字)。短い相槌だけで終わらせない";

/** 中盤だけに足す深掘りの指示。賛否・反例・数値の再言及のいずれかを必須にする */
const MID_TURN_INSTRUCTION = [
  "今回は対談の中盤です。直前の発言を受けたうえで、論点を一段深く掘り下げてください。",
  "次のうち少なくとも1つを必ず入れてください: (a) 記事の主張への明確な賛否(どこに同意し、どこに引っかかるのか) (b) 記事の内容が当てはまらない反例・例外・別の見方 (c) 記事の数字やキー引用の再言及(その前提や意味を疑うなど)。",
  "「賛成です」「なるほど」のような短い相槌だけの発言は禁止です。",
].join("\n");

/** そのターンが中盤 (論点を深掘りする区間) かどうか */
function isMidTurn(turnIndex: number, totalTurns: number): boolean {
  if (totalTurns < MID_TURN_MIN_TOTAL_TURNS) {
    return false;
  }
  return turnIndex >= MID_TURN_START_INDEX && turnIndex < totalTurns - MID_TURN_TAIL_MARGIN;
}

/**
 * 論点をプロンプト用の箇条書きにする。配列でも、改行や「・」「-」区切りの文字列でも受け取れる。
 * 空なら「なし」(テンプレートの変数は必ず差し込む必要があるため)。
 */
function formatKeyPoints(keyPoints: readonly string[] | string | undefined): string {
  const raw = keyPoints ?? [];
  const items = (Array.isArray(raw) ? raw : String(raw).split(/\r?\n|(?=[・\-*]\s)/u))
    .map((p) => String(p).replace(/^[\s・\-*]+/u, "").trim())
    .filter((p) => p.length > 0);
  if (items.length === 0) {
    return "なし";
  }
  return items.map((p, i) => `${i + 1}. ${p}`).join("\n");
}

/**
 * 対談: 1ターン分。
 * LLM のプロンプトキャッシュは先頭から一致した部分だけが効くので、全員に共通の内容を前に、
 * 発言者ごとに違う内容 (誰として話すか) を最後に置く。
 *   system = 番組のルール・記事・記憶・出演者 (全ターン共通)
 *   user   = これまでの対談 (ターンごとに末尾へ伸びる) → 発言者の役 → 今回の指示
 * これにより、発言者が変わっても system と履歴の大部分をキャッシュできる。
 */
export function buildTurnMessages(params: {
  currentPersona: { id: string; name: string; role: string; personality: string; speakingStyle: string };
  allPersonas: { id: string; name: string; role: string }[];
  articleTitle: string;
  /**
   * 記事の中身。生の本文をそのまま渡すのではなく、
   * 「分析の要約 + キー引用 + 本文冒頭」を連結したハイブリッドなテキストを渡す想定。
   * (従来どおり本文冒頭だけを渡しても動く)
   */
  articleSummary: string;
  /** 記事本文からのキー引用 (任意)。未指定なら「なし」として扱う */
  articleKeyQuotes?: string;
  /** この記事の論点 (任意)。文字列の配列、または改行/箇条書き区切りの文字列 */
  keyPoints?: readonly string[] | string;
  pastMemories: MemorySearchResult[];
  history: { personaName: string; text: string }[];
  turnIndex: number;
  totalTurns: number;
  isFirstSpeaker: boolean;
  /** 履歴に載せる直近の発言数 (既定: DIALOGUE_HISTORY_LIMIT) */
  historyLimit?: number;
}): ChatMessage[] {
  const { currentPersona, allPersonas, articleTitle, articleSummary, pastMemories, turnIndex, totalTurns } = params;

  const recentHistory = params.history.slice(-(params.historyLimit ?? DIALOGUE_HISTORY_LIMIT));

  const articleKeyQuotesText = params.articleKeyQuotes?.trim() ? params.articleKeyQuotes.trim() : "なし";
  const keyPointsText = formatKeyPoints(params.keyPoints);

  const cast = allPersonas.map((p) => `- ${p.name}（${p.role}）`).join("\n");

  const otherNames = allPersonas
    .filter((p) => p.id !== currentPersona.id)
    .map((p) => `${p.name}（${p.role}）`)
    .join("、");

  const memoryContext =
    pastMemories.length > 0
      ? pastMemories
          .map((m, i) =>
            renderPrompt(dialogueMemoryItem, {
              index: i + 1,
              articleTitle: m.articleTitle,
              topicSummary: m.topicSummary,
              keyQuotes: m.keyQuotes,
            })
          )
          .join("\n\n")
      : "なし";

  const speaker = renderPrompt(dialogueSpeaker, {
    name: currentPersona.name,
    role: currentPersona.role,
    otherNames,
    personality: currentPersona.personality,
    speakingStyle: currentPersona.speakingStyle,
  });

  const system: ChatMessage = {
    role: "system",
    content: renderPrompt(dialogueSystem, {
      cast,
      articleTitle,
      articleSummary,
      articleKeyQuotes: articleKeyQuotesText,
      keyPoints: keyPointsText,
      memoryContext,
    }),
  };

  if (params.isFirstSpeaker) {
    return [system, { role: "user", content: renderPrompt(dialogueOpening, { speaker, articleTitle }) }];
  }

  const isLastTurn = turnIndex === totalTurns - 1;
  const midTurn = isMidTurn(turnIndex, totalTurns);
  const replyInstruction = [
    renderPrompt(dialogueInstructionReply, {
      lengthHint: midTurn ? MID_TURN_LENGTH_HINT : LENGTH_HINTS[turnIndex % LENGTH_HINTS.length],
    }),
    midTurn ? MID_TURN_INSTRUCTION : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return [
    system,
    {
      role: "user",
      content: renderPrompt(dialogueTurn, {
        history: recentHistory.map((h) => `${h.personaName}: 「${h.text}」`).join("\n\n"),
        speaker,
        instruction: isLastTurn ? renderPrompt(dialogueInstructionFinal) : replyInstruction,
      }),
    },
  ];
}

/** 対談終了後の記憶定着: 論点の要約と印象的な発言をJSONで抽出させる */
export function buildConsolidateMessages(
  articleTitle: string,
  history: { personaName: string; text: string }[]
): ChatMessage[] {
  return [
    { role: "system", content: renderPrompt(consolidateSystem) },
    {
      role: "user",
      content: renderPrompt(consolidateUser, {
        articleTitle,
        conversation: history.map((h) => `${h.personaName}: ${h.text}`).join("\n"),
      }),
    },
  ];
}

/** 記事の分析: 要約・ジャンル・参加ペルソナをJSONで決めさせる */
export function buildAnalyzeMessages(params: {
  title: string;
  content: string;
  genres: readonly string[];
  minPersonas: number;
  maxPersonas: number;
  candidates: { id: string; name: string; role: string; personality: string; appearances?: number }[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: renderPrompt(analyzeSystem, {
        genres: params.genres.join(" / "),
        minPersonas: params.minPersonas,
        maxPersonas: params.maxPersonas,
        personaList: params.candidates
          .map(
            (c) => `- id: ${c.id} / ${c.name} (${c.role}) / 出演${c.appearances ?? 0}回 / ${c.personality.slice(0, 80)}`
          )
          .join("\n"),
      }),
    },
    {
      role: "user",
      content: renderPrompt(analyzeUser, { title: params.title, content: params.content.slice(0, 4000) }),
    },
  ];
}

/** 管理画面のAI生成: 新規作成 (base なし) または編集中の内容の修正 (base あり) */
export function buildPersonaGenerateMessages(params: {
  instruction: string;
  base: object | null;
  others: { name: string; role: string; themeColor: string }[];
  example: object;
  limits: { name: number; role: number };
}): ChatMessage[] {
  const { instruction, base, others, example, limits } = params;

  let system = renderPrompt(personaGenerateSystem, {
    nameMax: limits.name,
    roleMax: limits.role,
    example: JSON.stringify(example),
  });
  if (others.length > 0) {
    system +=
      "\n\n" +
      renderPrompt(personaGenerateOthers, {
        others: others.map((o) => `- ${o.name} (${o.role}) 色: ${o.themeColor}`).join("\n"),
      });
  }

  const user = base
    ? renderPrompt(personaGenerateModify, { base: JSON.stringify(base), instruction })
    : renderPrompt(personaGenerateNew, { instruction });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
