/**
 * LLMに渡すプロンプトの組み立て。文面は同じディレクトリの *.md にあり、
 * ビルド時に ?raw で文字列として埋め込まれる (Workers にはファイルシステムがないため)。
 * ここには「どのテンプレートに何を差し込むか」という組み立てだけを置く。
 */
import type { ChatMessage } from "../services/llm";
import type { MemorySearchResult } from "../services/memory";
import { renderPrompt } from "./render";

import dialogueSpeaker from "./dialogue-speaker.md?raw";
import dialogueMemoryItem from "./dialogue-memory-item.md?raw";
import dialogueOpening from "./dialogue-opening.md?raw";
import dialogueTurn from "./dialogue-turn.md?raw";
import dialogueInstructionReply from "./dialogue-instruction-reply.md?raw";
import dialogueInstructionFinal from "./dialogue-instruction-final.md?raw";
import consolidateSystem from "./consolidate-system.md?raw";
import consolidateUser from "./consolidate-user.md?raw";
import analyzeSystem from "./analyze-system.md?raw";
import analyzeUser from "./analyze-user.md?raw";
import personaGenerateSystem from "./persona-generate-system.md?raw";
import personaGenerateOthers from "./persona-generate-others.md?raw";
import personaGenerateNew from "./persona-generate-new.md?raw";
import personaGenerateModify from "./persona-generate-modify.md?raw";

// 発言の長さに落差を付けるため、ターンごとに長さの目安を循環させる (全発言が同じ長さになるのを防ぐ)
const LENGTH_HINTS = [
  "一言〜一文だけ(40文字以内)の短い返し",
  "2〜3文(100文字前後)",
  "短めに1〜2文(60文字前後)",
  "しっかり語る。4〜5文(180文字前後)",
  "一言の相槌や反応のあと、一文だけ付け足す(50文字前後)",
];

/** 対談: 1ターン分 (発言者のペルソナ設定を system、これまでの流れと指示を user にする) */
export function buildTurnMessages(params: {
  currentPersona: { id: string; name: string; role: string; personality: string; speakingStyle: string };
  allPersonas: { id: string; name: string; role: string }[];
  articleTitle: string;
  articleSummary: string;
  pastMemories: MemorySearchResult[];
  history: { personaName: string; text: string }[];
  turnIndex: number;
  totalTurns: number;
  isFirstSpeaker: boolean;
}): ChatMessage[] {
  const { currentPersona, allPersonas, articleTitle, articleSummary, pastMemories, history, turnIndex, totalTurns } =
    params;

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

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: renderPrompt(dialogueSpeaker, {
        name: currentPersona.name,
        role: currentPersona.role,
        otherNames,
        personality: currentPersona.personality,
        speakingStyle: currentPersona.speakingStyle,
        articleTitle,
        articleSummary,
        memoryContext,
      }),
    },
  ];

  if (params.isFirstSpeaker) {
    messages.push({ role: "user", content: renderPrompt(dialogueOpening, { articleTitle }) });
  } else {
    const isLastTurn = turnIndex === totalTurns - 1;
    messages.push({
      role: "user",
      content: renderPrompt(dialogueTurn, {
        history: history.map((h) => `${h.personaName}: 「${h.text}」`).join("\n\n"),
        instruction: isLastTurn
          ? renderPrompt(dialogueInstructionFinal)
          : renderPrompt(dialogueInstructionReply, { lengthHint: LENGTH_HINTS[turnIndex % LENGTH_HINTS.length] }),
      }),
    });
  }
  return messages;
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
          .map((c) => `- id: ${c.id} / ${c.name} (${c.role}) / 出演${c.appearances ?? 0}回 / ${c.personality.slice(0, 80)}`)
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
