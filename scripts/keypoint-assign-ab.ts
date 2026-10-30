/**
 * 論点割当パイロットの A/B ハーネス。
 *
 * 本番 POST はせず、`orchestrateDialogue` を直接呼ぶ。DB は bun:sqlite の
 * インメモリ DB に migrations/*.sql を流し込んで D1 互換のシムを被せたもの。
 * (マイグレーションファイルは追加しない。既存のものを読むだけ)
 *
 * 実行: bun --preload ./test/raw-plugin.ts scripts/keypoint-assign-ab.ts [--runs=2] [--out=DIR]
 *
 * - ON アーム: KEYPOINT_ASSIGN 未設定 (keyPoints を personas 順に分散所有)
 * - OFF アーム: KEYPOINT_ASSIGN=off (パイロット前と同じ。全員に担当論点を渡さない)
 * - 両アームとも stance / temperature は既定のまま (割当だけを比較する)
 *
 * 指標:
 * - turnJaccard: 別ペルソナ同士の発言の文字4-gram Jaccard (発言レベルの重複)
 * - evidenceJaccard: 記事固有の根拠 (技術名・数値・引用) の集合 Jaccard
 * - evidenceReuse: 2人以上が共有した根拠の割合 (低いほど「根拠の重複が減った」)
 * - ownMarkerHit / otherMarkerHit: 担当論点のマーカーが本人/他人の発言に出た割合
 * - polarity: 3人それぞれの claim 極性 (賛成/条件付き/反対) と、その種類数
 */
import { Database } from "bun:sqlite";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { orchestrateDialogue } from "../src/worker/services/dialogue";
import { extractJsonObject } from "../src/worker/services/json-object";
import { generateChatCompletion } from "../src/worker/services/llm";
import type { Env, Persona } from "../src/worker/types";

const TURNS = 9;
const PERSONA_IDS = ["ken", "yuki", "ren"];

/** 対象記事 (danluu.com)。ハーネス内に固定して両アームで同じ条件にする */
const ARTICLE = {
  title: "“We should be more ambitious with the software we build”",
  sourceUrl: "https://danluu.com/ambitious/",
  normalizedUrl: "https://danluu.com/ambitious",
  summary:
    "AI エージェントの性能向上で、以前なら年単位だったツール開発が数時間で「works for me」水準に届くようになった。Dan Luu は pgrust の作者 Malis の「もっと野心的であるべきだ」という主張を引き、vibeslop の氾濫で評価が難しくなっていること、それでも自分で作る立場なら品質は担保できることを論じる。付録では Yossi Kreinin の反論 (pass/fail が曖昧な領域では agentic loop が破綻し、大半の人は ambition を下げるべき) と、実際に作られた小道具の例が挙げられる。",
  keyQuotes: [
    "[W]e should be more ambitious with the software we build",
    "for most people they should be less ambitious with the software they build with AI or they'll experience abject failure",
    "models are very good at counterfeiting and the level of expertise it takes to distinguish a counterfeit from the real thing has been increasing as models improve",
  ],
  keyPoints: [
    "AI で「以前は実現不可能だった規模」のソフトが数時間で作れるようになり、pgrust は Postgres の実バグを複数発見している",
    "vibeslop の氾濫で、外から見た品質の判別が難しくなっている (ベンチマークの主張と実態の乖離)",
    "Kreinin の反論: pass/fail が明確でない領域では agentic loop が破綻し、大半の人には ambition を下げる方が現実的",
  ],
  /** 各論点を代表するマーカー。担当どおりに掘れているかを測る */
  keyPointMarkers: [
    ["pgrust", "postgres", "sp-gist"],
    ["vibeslop", "ベンチマーク", "品質"],
    ["kreinin", "pass/fail", "agentic", "ambition"],
  ],
  body: "Since early this year, Michael Malis (of pgrust) has been showing me interesting things he's done and saying \"[W]e should be more ambitious with the software we build\". There is, understandably, a lot of skepticism about projects like pgrust because there are so many low-quality AI-generated projects out there. If I didn't know Malis and didn't look into it, I would just assume that pgrust was another vibe slopped project that's never going to work. But I know Malis well enough to trust his work without looking into it, and if you look into it a bit, you'll see that in testing pgrust, he's testing thoroughly enough that he's even uncovering real bugs in Postgres, such as this numerical bug that can cause valid SP-GiST operations to fail. This isn't to say that pgrust is bug free, but it does indicate that there's a substantial amount of testing happening and, even if pgrust itself is never successful, just making the attempt will have improved Postgres in a durable way. For someone like me who doesn't know anything about regexes, string matching algorithms, compilers, interpreters, etc., this set of projects would've taken a year or more to get to \"works for me\" quality. Instead, this was a low single-digit number of hours of my time. My read of Malis's meaning when he says \"we should be more ambitious with the software we build\", is that it doesn't even occur to people to do these things that are now easy. As far as I can tell, these problems are problems because people are implicitly carrying around a pre-agentic cost model. Appendix: we should be less ambitious with the software we build. Here's a comment from Yossi Kreinin: \"for most people they should be less ambitious with the software they build with AI or they'll experience abject failure. I think a lot of the problems don't lend themselves that well to agentic loops since you don't have clear pass/fail criteria.\"",
};

function buildArticleSummary(): string {
  const sections = [
    `【要約】\n${ARTICLE.summary}`,
    `【キー引用】\n${ARTICLE.keyQuotes.map((q) => `「${q}」`).join("\n")}`,
    `【論点】\n${ARTICLE.keyPoints.map((p) => `- ${p}`).join("\n")}`,
    `【本文冒頭】\n${ARTICLE.body}`,
  ];
  return sections.join("\n\n");
}

/** .dev.vars を読む (KEY="value" 形式) */
async function loadDevVars(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const text = await Bun.file(".dev.vars").text();
  for (const line of text.split(/\r?\n/u)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/u);
    if (!m) {
      continue;
    }
    vars[m[1]] = m[2].trim().replace(/^"(.*)"$/u, "$1");
  }
  return vars;
}

/** D1 のうち、このコードベースが使う prepare/bind/first/all/run だけを bun:sqlite で再現する */
function createD1Shim(db: Database): D1Database {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const exec = {
      all: async <T>() => ({ results: db.query(sql).all(...(params as never[])) as T[], success: true, meta: {} }),
      first: async <T>() => (db.query(sql).get(...(params as never[])) as T) ?? null,
      run: () => {
        const info = db.run(sql, ...(params as never[]));
        return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
      },
      bind: (...args: unknown[]) => {
        params = args;
        return exec;
      },
    };
    return exec;
  };
  return { prepare } as unknown as D1Database;
}

async function createDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  const dir = "migrations";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    db.exec(await Bun.file(join(dir, file)).text());
  }
  return db;
}

interface TurnRecord {
  content: string;
  personaId: string;
  turnIndex: number;
}

type Polarity = "賛成" | "条件付き" | "反対" | "不明";

interface RunResult {
  arm: "on" | "off";
  assignments: Record<string, string[]>;
  error: string | null;
  polarity: Record<string, Polarity>;
  runIndex: number;
  sessionId: string;
  turns: TurnRecord[];
}

/** 文字 n-gram の集合 (空白・句読点は落とす) */
function charNgrams(text: string, n: number): Set<string> {
  const normalized = text.replace(/[\s、。,.!?！？「」『』()（）:：;；…—-]/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i + n <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const g of a) {
    if (b.has(g)) {
      inter++;
    }
  }
  return inter / (a.size + b.size - inter);
}

/** 記事固有の根拠として数える語 (技術名・主張のラベル) */
const EVIDENCE_TERMS = [
  "pgrust",
  "postgres",
  "sp-gist",
  "malis",
  "kreinin",
  "vibeslop",
  "agentic",
  "ambition",
  "pass/fail",
  "benchmark",
  "ベンチマーク",
  "lean",
  "kani",
  "cerebras",
];

/** 発言から「根拠」の単位 (技術名・数値・引用) を取り出す */
function evidenceUnits(text: string): Set<string> {
  const units = new Set<string>();
  const lower = text.toLowerCase();
  for (const term of EVIDENCE_TERMS) {
    if (lower.includes(term)) {
      units.add(term);
    }
  }
  for (const m of text.matchAll(/[0-9０-９]+(?:\.[0-9]+)?\s*(?:%|倍|時間|ヶ月|か月|年|万|億|ドル)?/gu)) {
    units.add(m[0].replace(/\s+/gu, ""));
  }
  for (const m of text.matchAll(/[「『]([^」』]{3,40})[」』]/gu)) {
    units.add(m[1].replace(/\s+/gu, " ").trim());
  }
  return units;
}

/** 理論上の担当 (arm に関係なく同じ)。personas[i] が keyPoints[i % 3] を持つ */
function theoreticalAssignments(): Record<string, number[]> {
  const assignments: Record<string, number[]> = {};
  for (const [i] of ARTICLE.keyPoints.entries()) {
    const personaId = PERSONA_IDS[i % PERSONA_IDS.length];
    assignments[personaId] = [...(assignments[personaId] ?? []), i];
  }
  return assignments;
}

function markerHits(text: string, keyPointIndex: number): number {
  const lower = text.toLowerCase();
  return ARTICLE.keyPointMarkers[keyPointIndex].filter((m) => lower.includes(m)).length;
}

/** 発言者1人の極性を分類する。1人分の短いプロンプトなら空応答になりにくい */
async function classifyOne(personaId: string, text: string, env: Env, sessionId: string): Promise<Polarity> {
  if (!text.trim()) {
    return "不明";
  }
  const prompt = [
    {
      role: "system" as const,
      content: "あなたは発言者の立場を分類する評価者です。JSONのみ出力します。",
    },
    {
      role: "user" as const,
      content: [
        "次の人物の発言を読み、記事の主張「AIでもっと野心的にソフトを作るべきか」への立場を「賛成」「条件付き」「反対」のどれか1つに分類してください。",
        "挨拶や相槌ではなく、記事の主張への実質的な立場で判定します。",
        '出力は {"polarity":"..."} のみ。',
        "",
        text,
      ].join("\n"),
    },
  ];

  try {
    const raw = await generateChatCompletion(prompt, env, `${sessionId}_polarity_${personaId}`, undefined, {
      // 推論にトークンを使うモデルがあるため、短い JSON でも余裕を持たせる (300 だと空応答になった)
      maxOutputTokens: 600,
    });
    const value = String(extractJsonObject(raw)?.raw?.polarity ?? "");
    if (value.includes("反対")) {
      return "反対";
    }
    if (value.includes("条件")) {
      return "条件付き";
    }
    if (value.includes("賛成")) {
      return "賛成";
    }
    console.warn(`polarity classification returned no polarity head=${JSON.stringify(raw.slice(0, 200))}`);
    return "不明";
  } catch (err) {
    console.warn(`polarity classification failed for ${personaId}:`, err);
    return "不明";
  }
}

/** 3人分を並列で分類する (逐次ループにしない) */
async function classifyPolarity(turns: TurnRecord[], env: Env, sessionId: string): Promise<Record<string, Polarity>> {
  const entries = await Promise.all(
    PERSONA_IDS.map(async (personaId) => {
      const text = turns
        .filter((t) => t.personaId === personaId)
        .map((t) => t.content)
        .join("\n");
      return [personaId, await classifyOne(personaId, text, env, sessionId)] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function runOne(
  arm: "on" | "off",
  runIndex: number,
  db: Database,
  baseEnv: Env,
  outDir: string
): Promise<RunResult> {
  const sessionId = `kp_${arm}_${runIndex}_${Date.now()}`;
  const createdAt = new Date().toISOString();
  await db
    .query(
      "INSERT INTO sessions (id, source_url, article_title, article_summary, persona_ids, created_at, normalized_url, summary, genre, og_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      sessionId,
      ARTICLE.sourceUrl,
      ARTICLE.title,
      buildArticleSummary(),
      JSON.stringify(PERSONA_IDS),
      createdAt,
      ARTICLE.normalizedUrl,
      ARTICLE.summary,
      "プログラミング・開発",
      JSON.stringify({ title: ARTICLE.title, description: ARTICLE.summary, url: ARTICLE.sourceUrl })
    );

  const env: Env = {
    ...baseEnv,
    KEYPOINT_ASSIGN: arm === "off" ? "off" : undefined,
  };

  const assignments =
    arm === "off"
      ? {}
      : Object.fromEntries(
          Object.entries(theoreticalAssignments()).map(([id, indexes]) => [
            id,
            indexes.map((i) => ARTICLE.keyPoints[i]),
          ])
        );

  const turns: TurnRecord[] = [];
  let error: string | null = null;
  const [firstPersonaId] = PERSONA_IDS;
  let currentPersonaId = firstPersonaId;

  for await (const event of orchestrateDialogue(sessionId, env, TURNS)) {
    if (event.type === "turn_start") {
      currentPersonaId = (event.data.persona as Persona).id;
    } else if (event.type === "turn_end") {
      turns.push({
        turnIndex: Number(event.data.turnIndex),
        personaId: currentPersonaId,
        content: String(event.data.content ?? ""),
      });
      process.stdout.write(`  turn ${Number(event.data.turnIndex) + 1}/${TURNS} (${currentPersonaId})\n`);
    } else if (event.type === "error") {
      error = String(event.data.message ?? "unknown error");
      break;
    }
  }

  const polarity = await classifyPolarity(turns, env, sessionId);
  const result: RunResult = { arm, runIndex, sessionId, assignments, turns, polarity, error };
  await Bun.write(join(outDir, `${sessionId}.json`), JSON.stringify(result, null, 2));
  return result;
}

/** 発言レベルの重複: 別ペルソナ同士の文字4-gram Jaccard (平均) */
function turnPairJaccard(turns: TurnRecord[]): number {
  const similarities: number[] = [];
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[i].personaId === turns[j].personaId) {
        continue;
      }
      similarities.push(jaccard(charNgrams(turns[i].content, 4), charNgrams(turns[j].content, 4)));
    }
  }
  return similarities.reduce((a, b) => a + b, 0) / Math.max(similarities.length, 1);
}

/** 根拠の重複: ペルソナごとの根拠集合のペア Jaccard と、2人以上が共有した根拠の割合 */
function evidenceStats(turns: TurnRecord[]): {
  pairJaccard: number;
  reuse: number;
  shared: number;
  distinct: number;
} {
  const byPersona = new Map<string, Set<string>>();
  for (const personaId of PERSONA_IDS) {
    const units = new Set<string>();
    for (const turn of turns.filter((t) => t.personaId === personaId)) {
      for (const unit of evidenceUnits(turn.content)) {
        units.add(unit);
      }
    }
    byPersona.set(personaId, units);
  }

  const similarities: number[] = [];
  for (let i = 0; i < PERSONA_IDS.length; i++) {
    for (let j = i + 1; j < PERSONA_IDS.length; j++) {
      const a = byPersona.get(PERSONA_IDS[i]) ?? new Set<string>();
      const b = byPersona.get(PERSONA_IDS[j]) ?? new Set<string>();
      similarities.push(jaccard(a, b));
    }
  }

  const owners = new Map<string, Set<string>>();
  for (const personaId of PERSONA_IDS) {
    for (const unit of byPersona.get(personaId) ?? []) {
      const set = owners.get(unit) ?? new Set<string>();
      set.add(personaId);
      owners.set(unit, set);
    }
  }
  const shared = [...owners.values()].filter((set) => set.size >= 2).length;
  return {
    pairJaccard: similarities.reduce((a, b) => a + b, 0) / Math.max(similarities.length, 1),
    reuse: shared / Math.max(owners.size, 1),
    shared,
    distinct: owners.size,
  };
}

/** 担当どおりに掘れているか (理論上の担当を両アーム共通の基準に使う) */
function markerStats(turns: TurnRecord[]): {
  ownHitRate: number;
  otherHitRate: number;
  perPersona: Record<string, { own: number; other: number; chars: number }>;
} {
  const theoretical = theoreticalAssignments();
  let ownHit = 0;
  let ownTotal = 0;
  let otherHit = 0;
  let otherTotal = 0;
  const perPersona: Record<string, { own: number; other: number; chars: number }> = {};
  for (const personaId of PERSONA_IDS) {
    const text = turns
      .filter((t) => t.personaId === personaId)
      .map((t) => t.content)
      .join("\n");
    const ownIndexes = theoretical[personaId] ?? [];
    const otherIndexes = ARTICLE.keyPoints.map((_, i) => i).filter((i) => !ownIndexes.includes(i));
    const own = ownIndexes.reduce((sum, i) => sum + markerHits(text, i), 0);
    const ownMax = ownIndexes.reduce((sum, i) => sum + ARTICLE.keyPointMarkers[i].length, 0);
    const other = otherIndexes.reduce((sum, i) => sum + markerHits(text, i), 0);
    const otherMax = otherIndexes.reduce((sum, i) => sum + ARTICLE.keyPointMarkers[i].length, 0);
    ownHit += own;
    ownTotal += ownMax;
    otherHit += other;
    otherTotal += otherMax;
    perPersona[personaId] = { own, other, chars: text.length };
  }
  return {
    ownHitRate: ownHit / Math.max(ownTotal, 1),
    otherHitRate: otherHit / Math.max(otherTotal, 1),
    perPersona,
  };
}

function summarize(result: RunResult) {
  const { turns } = result;
  const evidence = evidenceStats(turns);
  const markers = markerStats(turns);
  const distinctPolarities = new Set(Object.values(result.polarity).filter((p) => p !== "不明")).size;

  return {
    arm: result.arm,
    runIndex: result.runIndex,
    completed: turns.length === TURNS,
    error: result.error,
    turnJaccard: turnPairJaccard(turns),
    evidenceJaccard: evidence.pairJaccard,
    evidenceReuse: evidence.reuse,
    sharedEvidenceUnits: evidence.shared,
    distinctEvidenceUnits: evidence.distinct,
    ownMarkerHitRate: markers.ownHitRate,
    otherMarkerHitRate: markers.otherHitRate,
    perPersona: markers.perPersona,
    polarity: result.polarity,
    distinctPolarities,
    assignments: result.assignments,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 2);
  const analyzeDir = args.find((a) => a.startsWith("--analyze="))?.split("=")[1];
  const outDir =
    analyzeDir ??
    args.find((a) => a.startsWith("--out="))?.split("=")[1] ??
    join(process.env.TEMP ?? ".", "opencode", "persona-cast-keypoint-ab");

  await mkdir(outDir, { recursive: true });

  // 既存の結果を集計し直すだけのモード (LLM を呼ばない)
  if (analyzeDir) {
    const results: RunResult[] = [];
    for (const name of [...new Bun.Glob("kp_*.json").scanSync(outDir)].sort()) {
      results.push((await Bun.file(join(outDir, name)).json()) as RunResult);
    }
    printSummary(results.map(summarize), outDir);
    return;
  }

  const vars = await loadDevVars();
  if (!vars.OPENCODE_API_KEY || vars.OPENCODE_API_KEY === "your-opencode-api-key-here") {
    throw new Error(".dev.vars に OPENCODE_API_KEY がありません (実 LLM での A/B ができません)");
  }

  const db = await createDatabase();
  const baseEnv = {
    DB: createD1Shim(db),
    OPENCODE_API_KEY: vars.OPENCODE_API_KEY,
    OPENCODE_BASE_URL: vars.OPENCODE_BASE_URL,
    OPENCODE_DEFAULT_MODEL: vars.OPENCODE_DEFAULT_MODEL,
    EMBEDDING_MODEL: vars.EMBEDDING_MODEL,
  } as unknown as Env;

  // 保存済みの対談を読み直し、claim 極性だけを再分類するモード (対談は再生成しない)
  const reclassifyDir = args.find((a) => a.startsWith("--reclassify="))?.split("=")[1];
  if (reclassifyDir) {
    const results: RunResult[] = [];
    for (const name of [...new Bun.Glob("kp_*.json").scanSync(reclassifyDir)].sort()) {
      const result = (await Bun.file(join(reclassifyDir, name)).json()) as RunResult;
      result.polarity = await classifyPolarity(result.turns, baseEnv, result.sessionId);
      await Bun.write(join(reclassifyDir, name), JSON.stringify(result, null, 2));
      results.push(result);
    }
    await writeSummary(results, reclassifyDir);
    return;
  }

  const results: RunResult[] = [];
  for (const arm of ["on", "off"] as const) {
    for (let i = 0; i < runs; i++) {
      console.log(`\n=== arm=${arm} run=${i} ===`);
      const result = await runOne(arm, i, db, baseEnv, outDir);
      if (result.error) {
        console.log(`error: ${result.error}`);
      }
      results.push(result);
    }
  }

  await writeSummary(results, outDir);
}

async function writeSummary(results: RunResult[], outDir: string): Promise<void> {
  const summaries = results.map(summarize);
  await Bun.write(
    join(outDir, "summary.json"),
    JSON.stringify(
      {
        article: ARTICLE.title,
        turns: TURNS,
        generatedAt: new Date().toISOString(),
        keyPoints: ARTICLE.keyPoints,
        summaries,
      },
      null,
      2
    )
  );
  printSummary(summaries, outDir);
}

function printSummary(summaries: ReturnType<typeof summarize>[], outDir: string) {
  console.log(`\n--- summary (${outDir}) ---`);
  const byArm = { on: [] as typeof summaries, off: [] as typeof summaries };
  for (const s of summaries) {
    byArm[s.arm].push(s);
    console.log(
      `${s.arm}#${s.runIndex} completed=${s.completed} error=${s.error ?? "-"} ` +
        `turnJ=${s.turnJaccard.toFixed(3)} evidenceJ=${s.evidenceJaccard.toFixed(3)} ` +
        `reuse=${(s.evidenceReuse * 100).toFixed(0)}% shared=${s.sharedEvidenceUnits}/${s.distinctEvidenceUnits} ` +
        `own=${(s.ownMarkerHitRate * 100).toFixed(0)}% other=${(s.otherMarkerHitRate * 100).toFixed(0)}% ` +
        `polarity=${JSON.stringify(s.polarity)} distinct=${s.distinctPolarities}`
    );
  }
  const armStats = (arm: "on" | "off") => {
    const items = byArm[arm];
    const avg = (pick: (s: (typeof items)[number]) => number) =>
      items.reduce((a, s) => a + pick(s), 0) / Math.max(items.length, 1);
    return {
      runs: items.length,
      completed: items.filter((s) => s.completed).length,
      turnJaccard: avg((s) => s.turnJaccard),
      evidenceJaccard: avg((s) => s.evidenceJaccard),
      evidenceReuse: avg((s) => s.evidenceReuse),
      sharedEvidenceUnits: avg((s) => s.sharedEvidenceUnits),
      ownMarkerHitRate: avg((s) => s.ownMarkerHitRate),
      otherMarkerHitRate: avg((s) => s.otherMarkerHitRate),
      distinctPolarities: avg((s) => s.distinctPolarities),
      polarityCounts: Object.fromEntries(
        ["賛成", "条件付き", "反対", "不明"].map((p) => [
          p,
          items.reduce((sum, s) => sum + Object.values(s.polarity).filter((v) => v === p).length, 0),
        ])
      ),
    };
  };
  console.log("\n=== arm aggregate ===");
  console.log(JSON.stringify({ on: armStats("on"), off: armStats("off") }, null, 2));
}

await main();
