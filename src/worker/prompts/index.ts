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

// 発言の長さに落差を付けるため、ターンごとに長さの目安を循環させる (全発言が同じ長さになるのを防ぐ)。
// short は「一言だけ」「短め」の指示で、中盤の深掘り(a)(b)(c)と正面から競合する。
// 中盤では short を一切使わない (pickLengthHint が中盤用の目安に差し替える)。
const LENGTH_HINTS: readonly { text: string; short: boolean }[] = [
  { text: "一言〜一文だけ(40文字以内)の短い返し", short: true },
  { text: "2〜3文(100文字前後)", short: false },
  { text: "短めに1〜2文(60文字前後)", short: true },
  { text: "しっかり語る。4〜5文(180文字前後)", short: false },
  { text: "一言の相槌や反応のあと、一文だけ付け足す(50文字前後)", short: true },
];

/**
 * 中盤の区間。ここが「賛成です」級の短い相槌だけに崩落しやすい。
 * 9ターンなら 4〜7ターン目 (turnIndex 3〜6) が中盤になる。
 * 末尾2ターン (締めの直前と最終ターン) は総括と役割が重なるので中盤扱いしない。
 */
const MID_TURN_START_INDEX = 3;
const MID_TURN_TAIL_MARGIN = 2;
const MID_TURN_MIN_TOTAL_TURNS = 6;

/**
 * 中盤の「手」。ターンごとに違う手を割り当てる。
 * 全ターン同じ「条件・反例を挙げる」指示だと「一部賛成＋ただし」の連鎖になり、検討会の議事録のように単調になるため。
 * 手の性質に合わせて長さも変え、中盤の長さが揃うのを防ぐ (どの手も内容を要求するので相槌には崩れない)。
 */
const MID_TURN_MOVES: readonly { instruction: string; lengthHint: string }[] = [
  {
    instruction:
      "【ひっくり返す】相手の理屈をそのまま使って、相手と逆の結論まで持っていってください。「その理屈なら、むしろ〜じゃない？」のように、部分修正ではなく話の向きを変える一撃にしてください。",
    lengthHint: "2〜3文(60〜120文字)",
  },
  {
    instruction:
      "【場面にする】ここまでの話を、聴き手が自分の身に置き換えられる一つの具体的な場面(誰が・いつ・何に困る/得するか)で描いてください。「たとえば」で始める架空の場面で構いません。",
    lengthHint: "3〜5文(120〜200文字)",
  },
  {
    instruction:
      "【意外なものに例える】この話と同じ構造を持つ、まったく別の分野のもの(日常生活・スポーツ・料理など)に例えて、話の正体を言い当ててください。例えだけで終わらせず、その例えだから見える、まだ誰も言っていない点を1つ出してください。",
    lengthHint: "3〜4文(90〜170文字)",
  },
  {
    instruction:
      "【本音を漏らす】役割の建前を一度外し、自分の立場の痛いところや実は揺らいでいる点を、自分の性格らしい感情を込めて認めてください。そのうえで「それでも〜」と踏みとどまるか、「だから考えを変える」と動くか、どちらかに着地してください。",
    lengthHint: "2〜4文(70〜140文字)",
  },
];

function pickMidTurnMove(turnIndex: number): { instruction: string; lengthHint: string } {
  return MID_TURN_MOVES[(turnIndex - MID_TURN_START_INDEX) % MID_TURN_MOVES.length];
}

/** 中盤だけに足す指示。ターンごとの「手」で話を動かし、既出キーワードの蒸し返しと相槌への崩落を防ぐ */
function buildMidTurnInstruction(turnIndex: number): string {
  return [
    "今回は対談の中盤、番組の見せ場です。直前の発言を受けて、話を別の景色へ動かしてください。",
    `今回の手: ${pickMidTurnMove(turnIndex).instruction}`,
    "ここまでの会話で既に出た数字やカギ括弧の引用は繰り返さないでください。担当論点が指定されている場合は、その範囲でこの手を使ってください。",
    "「賛成です」「なるほど」のような短い相槌だけの発言や、自分の前の発言の焼き直しは禁止です。",
  ].join("\n");
}

/** 1巡目の返し。各自の立場を早い段階でぶつけ、序盤から対立の構図を見せる */
const FIRST_ROUND_INSTRUCTION =
  "今回は番組の序盤です。さっきの第一声に乗っかって解説するのではなく、あなたならではの切り口を旗揚げして、聴き手に「この人はそっちの立場か」と分からせてください。";

/** 締めの直前の山場。最終ターンの結論に向けて、話の核心を一度言葉にさせる */
const CLIMAX_LENGTH_HINT = "2〜4文(70〜160文字)";
const CLIMAX_INSTRUCTION =
  "今回は番組の山場です。ここまで誰も言葉にしていない、この話の核心を言い切ってください。「正体」という語や「〜の話じゃなくて〜の話だ」という型は使わず、具体的な言葉で言ってください。新しい対策の提案はしないでください。";

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

/** 最終ターンの1つ前 (山場) かどうか。短い対談では序盤と重なるので中盤と同じ最小ターン数を要求する */
function isClimaxTurn(turnIndex: number, totalTurns: number): boolean {
  return totalTurns >= MID_TURN_MIN_TOTAL_TURNS && turnIndex === totalTurns - 2;
}

/**
 * そのターンの「長さの目安」。
 * - 中盤は短文HINT (LENGTH_HINTS の short) を排除し、その回の手に合った目安を使う。
 * - 山場は結論を言い切れる長さに固定する。
 * - それ以外は turnIndex % 5 ではなく「その話者が何回目の発言か + 話者の並び順」で回す。
 *   ターン番号基準のままだと、話者ごとに当たる目安の位置が固定され、
 *   特定の話者だけ毎回短い/長いという偏りが構造化されるため。
 */
function pickLengthHint(turnIndex: number, totalTurns: number, speakerIndex: number, speakerCount: number): string {
  if (isMidTurn(turnIndex, totalTurns)) {
    return pickMidTurnMove(turnIndex).lengthHint;
  }
  if (isClimaxTurn(turnIndex, totalTurns)) {
    return CLIMAX_LENGTH_HINT;
  }
  const speakerTurn = Math.floor(turnIndex / Math.max(1, speakerCount));
  const index = (speakerTurn + Math.max(0, speakerIndex)) % LENGTH_HINTS.length;
  return LENGTH_HINTS[index].text;
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
 * 反論・批判系の論点かどうか。論点そのものにメタデータはないので、
 * 見出しの語彙で判定する (取りこぼすより、反論担当を明示できる側に倒す)。
 */
const COUNTER_ARGUMENT_PATTERN =
  /反論|反対|批判|異論|課題|問題点|リスク|懸念|不安|デメリット|弱点|欠点|限界|障壁|ハードル|負担|失敗|反例|例外|慎重|コスト|費用/u;

function findCounterArgumentPoints(points: readonly string[]): string[] {
  return points.filter((p) => COUNTER_ARGUMENT_PATTERN.test(p));
}

/**
 * 発言者の末尾に足す「担当論点」1行。system (全員共通) ではなく発言者側に置くので、
 * プロンプトキャッシュは壊れない。中盤の深掘り指示 (賛否・反例・数値の再言及) とは
 * 競合しないよう、他者の論点は「結論を奪わず自分の担当への含意として触れる」に留める。
 * 反論系の論点は「軸に話す」では賛成で流されるため、その話者の反論担当として明示的に紐付ける。
 */
export function formatKeyPointAssignment(assigned: readonly string[]): string {
  const counterPoints = findCounterArgumentPoints(assigned);
  const counterDuty =
    counterPoints.length > 0
      ? `このうち${counterPoints.map((p) => `「${p}」`).join("")}はあなたが反論担当です。賛成や要約で流さず、条件の穴・反例・見落とされたコストのいずれかを挙げて、必ず具体的な異論として述べてください。`
      : "この論点については、相槌や要約ではなく自分の結論を必ず述べてください。";
  return (
    `あなたの担当論点: ${assigned.join(" / ")}。` +
    counterDuty +
    "この論点を軸に話し、他者の担当論点は結論を奪わず、自分の担当への含意として触れるにとどめてください。"
  );
}

/**
 * 2巡目以降に足す「反論担当」1行。担当論点は自己反復を避けるため再注入しないが、
 * 反論系だけは「誰が言うか」を固定しないと誰も拾わなくなる。
 * 反論系の担当がなければ何も足さない (プロンプトを太らせない)。
 */
function formatCounterArgumentDuty(assigned: readonly string[]): string | null {
  const counterPoints = findCounterArgumentPoints(assigned);
  if (counterPoints.length === 0) {
    return null;
  }
  return `【反論担当】${counterPoints.map((p) => `「${p}」`).join("")}への反論はあなたの担当です。賛成や相槌で流さず、条件の穴・反例・見落とされたコストのいずれかを必ず出してください。`;
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
      : [FOLLOW_UP_ROUND_NOTE, formatCounterArgumentDuty(assignedKeyPoints)]),
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
  const speakerCount = Math.max(1, allPersonas.length);
  const foundSpeakerIndex = allPersonas.findIndex((p) => p.id === currentPersona.id);
  const speakerIndex = foundSpeakerIndex >= 0 ? foundSpeakerIndex : turnIndex % speakerCount;
  const replyInstruction = [
    renderPrompt(dialogueInstructionReply, {
      lengthHint: pickLengthHint(turnIndex, totalTurns, speakerIndex, speakerCount),
    }),
    midTurn ? buildMidTurnInstruction(turnIndex) : null,
    isFirstRound && !midTurn ? FIRST_ROUND_INSTRUCTION : null,
    isClimaxTurn(turnIndex, totalTurns) ? CLIMAX_INSTRUCTION : null,
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
        // 冒頭の発言は履歴の上限で落ちるので、締めで立ち返れるよう全履歴の先頭から渡す
        instruction: isLastTurn
          ? renderPrompt(dialogueInstructionFinal, {
              openingSpeaker: params.history[0]?.personaName ?? "不明",
              openingLine: params.history[0]?.text ?? "なし",
            })
          : replyInstruction,
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
