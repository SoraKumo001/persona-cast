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
import stanceSystem from "./stance-system.md?raw";
import stanceUser from "./stance-user.md?raw";

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

/** 中盤だけに足す深掘りの指示。既出キーワードの蒸し返しを防ぎつつ、条件・反例・トレードオフで議論を前に進める */
const MID_TURN_INSTRUCTION = [
  "今回は対談の中盤です。直前の発言を受けたうえで、論点を一段深く掘り下げてください。",
  "ここまでの会話で既に出た数字やカギ括弧の引用は繰り返さず、次のうち少なくとも1つを入れて議論を一歩先へ進めてください: (a) 直前の発言や記事の主張が成り立つ条件・前提へのツッコミ (b) 記事の内容が当てはまらない反例・例外・現場での具体例 (c) 対立する視点のトレードオフや、まだ掘り下げていない別の角度の検討。",
  "「賛成です」「なるほど」のような短い相槌だけの発言や、自分の前の発言の焼き直しは禁止です。",
].join("\n");

/**
 * 2巡目以降（各ペルソナの2回目・3回目の発言）に足す進行ガイド。
 * 1巡目と同じ立場・担当論点を毎回注入すると、同じ数字や主張を3回繰り返す原因になるため、
 * 2巡目以降は自己反復・既出キーワードの蒸し返しを禁じて議論の進行を促す。
 */
const FOLLOW_UP_ROUND_NOTE =
  "【2巡目以降の注意】あなたは前のターンですでに自分の最初の立場を述べています。自分がすでに言った主張や、会話に既に出た数字・カギ括弧の引用を繰り返さず、直前の相手の発言への切り返しや新しい具体例・条件の検討に話を進めてください。";

/** そのターンが中盤 (論点を深掘りする区間) かどうか */
function isMidTurn(turnIndex: number, totalTurns: number): boolean {
  if (totalTurns < MID_TURN_MIN_TOTAL_TURNS) {
    return false;
  }
  return turnIndex >= MID_TURN_START_INDEX && turnIndex < totalTurns - MID_TURN_TAIL_MARGIN;
}

/**
 * 論点を配列に正規化する。配列でも、改行や「・」「-」区切りの文字列でも受け取れる。
 * 論点の割当 (keypoint-assignment) とプロンプト組み立ての両方から使う。
 */
export function normalizeKeyPoints(keyPoints: readonly string[] | string | undefined): string[] {
  const raw = keyPoints ?? [];
  return (Array.isArray(raw) ? raw : String(raw).split(/\r?\n|(?=[・\-*]\s)/u))
    .map((p) =>
      String(p)
        .replace(/^[\s・\-*]+/u, "")
        .trim()
    )
    .filter((p) => p.length > 0);
}

/**
 * 論点をプロンプト用の箇条書きにする。
 * 空なら「なし」(テンプレートの変数は必ず差し込む必要があるため)。
 */
function formatKeyPoints(keyPoints: readonly string[] | string | undefined): string {
  const items = normalizeKeyPoints(keyPoints);
  if (items.length === 0) {
    return "なし";
  }
  return items.map((p, i) => `${i + 1}. ${p}`).join("\n");
}

/**
 * 発言者の末尾に足す「担当論点」1行。system (全員共通) ではなく発言者側に置くので、
 * プロンプトキャッシュは壊れない。中盤の深掘り指示 (賛否・反例・数値の再言及) とは
 * 競合しないよう、他者の論点は「結論を奪わず自分の担当への含意として触れる」に留める。
 */
export function formatKeyPointAssignment(assigned: readonly string[]): string {
  return (
    `あなたの担当論点: ${assigned.join(" / ")}。` +
    "この論点を軸に話し、他者の担当論点は結論を奪わず、自分の担当への含意として触れるにとどめてください。"
  );
}

/**
 * 発言者の末尾に足す「立場」。対談前の Phase 1 で決めたもので、台本ではない。
 * 逐語で読み上げさせず、対談の流れで更新してよい出発点として渡す。
 */
function formatStanceBlock(stance: string): string {
  return [
    "【あなたの立場(非公開・逐語反復禁止)】",
    stance,
    "- これは今回の発言の出発点です。対談の流れで考えが変わったら、更新して構いません。",
    "- この文面をそのまま逐語で繰り返さないこと。必ず自分の言葉に言い換えること。",
    "- この立場に含まれる数字・固有名詞・引用であっても、直前までの対談で他の出演者がすでに出していたら繰り返さず、「その数字」「さっきの話」と受けて自分の論点だけを出してください。",
    "- この立場は他の出演者に開示しないこと。",
  ].join("\n");
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
  /** 対談前に生成したこのペルソナの立場 (任意)。未指定・生成失敗なら従来どおり注入しない */
  stance?: string;
  /** このペルソナの担当論点 (任意)。指定時だけ発言者の末尾に1行注入する */
  assignedKeyPoints?: readonly string[];
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

  const speakerBase = renderPrompt(dialogueSpeaker, {
    name: currentPersona.name,
    role: currentPersona.role,
    otherNames,
    personality: currentPersona.personality,
    speakingStyle: currentPersona.speakingStyle,
  });
  const isFirstRound = turnIndex < Math.max(1, allPersonas.length);
  // 立場・担当論点は 1巡目 (各ペルソナの初発言) のみ user の末尾に置く。
  // 2巡目以降も同じ立場・担当論点を渡し続けると、同じ数字・引用・主張を毎巡言い換えて繰り返すため、
  // 2巡目以降は自己反復と既出キーワードの再掲を禁じる注意書きに切り替える。
  // いずれも system ではなく user 側に置くため、プロンプトキャッシュは壊れない。
  const stanceText = params.stance?.trim();
  const assignedKeyPoints = params.assignedKeyPoints ?? [];
  const speaker = [
    speakerBase,
    ...(isFirstRound
      ? [
          stanceText ? formatStanceBlock(stanceText) : null,
          assignedKeyPoints.length > 0 ? formatKeyPointAssignment(assignedKeyPoints) : null,
        ]
      : [FOLLOW_UP_ROUND_NOTE]),
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");

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

/**
 * 対談前の Phase 1: 1ペルソナ分の「立場」をJSONで作らせる。
 * 記事の要約・論点・キー引用と、そのペルソナの役割を与え、他の出演者の役割を見せて差別化を促す。
 */
export function buildStanceMessages(params: {
  currentPersona: { id: string; name: string; role: string; personality: string; speakingStyle: string };
  allPersonas: { id: string; name: string; role: string }[];
  articleTitle: string;
  articleSummary: string;
  articleKeyQuotes?: string;
  keyPoints?: readonly string[] | string;
  /** このペルソナの担当論点 (任意)。指定時だけペルソナ欄の末尾に1行注入する */
  assignedKeyPoints?: readonly string[];
}): ChatMessage[] {
  const { currentPersona } = params;

  const others =
    params.allPersonas
      .filter((p) => p.id !== currentPersona.id)
      .map((p) => `- ${p.name}（${p.role}）`)
      .join("\n") || "なし";

  const assignedKeyPoints = params.assignedKeyPoints ?? [];

  return [
    { role: "system", content: renderPrompt(stanceSystem) },
    {
      role: "user",
      content: renderPrompt(stanceUser, {
        name: currentPersona.name,
        role: currentPersona.role,
        personality: currentPersona.personality,
        speakingStyle: currentPersona.speakingStyle,
        others,
        assignedKeyPoint: assignedKeyPoints.length > 0 ? formatKeyPointAssignment(assignedKeyPoints) : "",
        articleTitle: params.articleTitle,
        articleSummary: params.articleSummary,
        articleKeyQuotes: params.articleKeyQuotes?.trim() ? params.articleKeyQuotes.trim() : "なし",
        keyPoints: formatKeyPoints(params.keyPoints),
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
