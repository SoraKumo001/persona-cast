/**
 * ペルソナ別 temperature のパイロット A/B ハーネス。
 *
 * 本番 POST はせず、`orchestrateDialogue` を直接呼ぶ。DB は bun:sqlite の
 * インメモリ DB に migrations/*.sql を流し込んで D1 互換のシムを被せたもの。
 * (マイグレーションファイルは追加しない。既存のものを読むだけ)
 *
 * 実行: bun --preload ./test/raw-plugin.ts scripts/persona-temp-ab.ts [--runs=2] [--out=DIR]
 *
 * - ON アーム: PERSONA_TEMP_PILOT 未設定 (yuki 0.6 / ken 0.4 / ren 0.3)
 * - OFF アーム: PERSONA_TEMP_PILOT=off (全員 0.75)
 */
import { Database } from "bun:sqlite";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { orchestrateDialogue } from "../src/worker/services/dialogue";
import { personaTemperature } from "../src/worker/services/persona-temperature";
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
  personaName: string;
  temperature: number;
  turnIndex: number;
}

interface RunResult {
  arm: "on" | "off";
  error: string | null;
  personaTemperatures: Record<string, number>;
  runIndex: number;
  sessionId: string;
  turns: TurnRecord[];
}

const ACK_ONLY = /^(なるほど|そうですね|確かに|賛成です|いいですね|興味深いですね|はい)[。！!、\s]*$/u;

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

/** 具体性: 数字・単位・記事固有の技術名・直接引用の数 */
const TECHNICAL_TERMS = [
  "pgrust",
  "Postgres",
  "Cerebras",
  "Lean",
  "Kani",
  "Rust",
  "regex",
  "zstd",
  "Pandoc",
  "IMAP",
  "benchmark",
  "ベンチマーク",
  "agentic",
  "vibeslop",
  "Kreinin",
  "Malis",
  "Claude",
  "OpenAI",
  "Anthropic",
];

function specificityScore(text: string): { numbers: number; quotes: number; terms: number; total: number } {
  const numbers = (text.match(/[0-9０-９]+(?:\.[0-9]+)?\s*(?:%|倍|時間|ヶ月|か月|年|万|億|ドル|\$)?/gu) ?? []).length;
  const quotes = (text.match(/[「『][^」』]{2,}[」』]/gu) ?? []).length;
  const lower = text.toLowerCase();
  const terms = TECHNICAL_TERMS.filter((t) => lower.includes(t.toLowerCase())).length;
  return { numbers, quotes, terms, total: numbers + quotes + terms };
}

/** 破綻シグナル: 同一文の反復、文末が助詞で切れている、極端に長い一文 */
function breakdownSignals(text: string): string[] {
  const signals: string[] = [];
  const sentences = text
    .split(/(?<=[。．！？!?])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  const seen = new Map<string, number>();
  for (const s of sentences) {
    seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  if ([...seen.values()].some((c) => c > 1)) {
    signals.push("同一文の反復");
  }
  // 助詞・読点で終わる (言い切れていない) 文
  if (/[、,]$/u.test(text.trim()) || /(?:が|を|に|で|は|て|と|も|から|ので)$/u.test(text.trim())) {
    signals.push("文末が未完了");
  }
  if (sentences.some((s) => s.length > 220)) {
    signals.push("長すぎる一文");
  }
  if ((text.match(/[a-zA-Z]{4,}/gu) ?? []).length > 30) {
    signals.push("英単語の混入過多");
  }
  return signals;
}

function midTurnCollapse(turns: TurnRecord[], turn: number): string | null {
  const current = turns[turn];
  if (!current) {
    return "発言なし";
  }
  const text = current.content.trim();
  if (text.length < 70) {
    return `中盤が短い(${text.length}字)`;
  }
  if (ACK_ONLY.test(text)) {
    return "相槌のみ";
  }
  // 直前の発言 (別ペルソナ) とほぼ同じ内容を繰り返している
  const prev = turns[turn - 1];
  if (prev) {
    const sim = jaccard(charNgrams(text, 4), charNgrams(prev.content, 4));
    if (sim >= 0.5) {
      return `直前の発言と酷似(${sim.toFixed(2)})`;
    }
  }
  return null;
}

async function runOne(
  arm: "on" | "off",
  runIndex: number,
  db: Database,
  baseEnv: Env,
  outDir: string
): Promise<RunResult> {
  const sessionId = `ab_${arm}_${runIndex}_${Date.now()}`;
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
    PERSONA_TEMP_PILOT: arm === "off" ? "off" : undefined,
  };

  const personaTemperatures: Record<string, number> = {};
  for (const id of PERSONA_IDS) {
    personaTemperatures[id] = personaTemperature(id, env);
  }

  const turns: TurnRecord[] = [];
  let error: string | null = null;
  let currentPersonaId: string | null = null;

  for await (const event of orchestrateDialogue(sessionId, env, TURNS)) {
    if (event.type === "turn_start") {
      const persona = event.data.persona as Persona;
      currentPersonaId = persona.id;
    } else if (event.type === "turn_end") {
      const persona = PERSONA_IDS[Number(event.data.turnIndex) % PERSONA_IDS.length];
      turns.push({
        turnIndex: Number(event.data.turnIndex),
        personaId: persona,
        personaName: String(currentPersonaId ?? persona),
        temperature: personaTemperatures[persona] ?? 0.75,
        content: String(event.data.content ?? ""),
      });
    } else if (event.type === "error") {
      error = String(event.data.message ?? "unknown error");
      break;
    }
  }

  const result: RunResult = { arm, runIndex, sessionId, personaTemperatures, turns, error };
  await Bun.write(join(outDir, `${sessionId}.json`), JSON.stringify(result, null, 2));
  return result;
}

function summarize(result: RunResult) {
  const { turns } = result;
  const midTurns = [3, 4, 5, 6].filter((i) => i < turns.length);
  const collapsed = midTurns.map((i) => ({ reason: midTurnCollapse(turns, i), turn: i })).filter((c) => c.reason);
  /** 中盤で 100 字未満 (「短い相槌ではないが薄い」も拾う緩めの基準) */
  const thinMidTurns = midTurns.filter((i) => (turns[i]?.content.trim().length ?? 0) < 100);
  const lengths = turns.map((t) => t.content.trim().length);
  const specific = turns.map((t) => specificityScore(t.content));
  const signals = turns.flatMap((t) => breakdownSignals(t.content).map((s) => `${t.turnIndex}:${s}`));
  // ペルソナ間の類似度 (視点のばらつき): 同セッション内の異なるペルソナ同士
  const similarities: number[] = [];
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[i].personaId === turns[j].personaId) {
        continue;
      }
      similarities.push(jaccard(charNgrams(turns[i].content, 4), charNgrams(turns[j].content, 4)));
    }
  }
  // 直前の発言の焼き直し率 (異なるペルソナ間のみ)
  let echo = 0;
  let echoDenom = 0;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].personaId === turns[i - 1].personaId) {
      continue;
    }
    echoDenom++;
    if (jaccard(charNgrams(turns[i].content, 4), charNgrams(turns[i - 1].content, 4)) >= 0.35) {
      echo++;
    }
  }
  // ペルソナごとの語彙多様性 (異なり4-gram / 総4-gram) と平均文字数
  const diversity: Record<string, number> = {};
  const personaAvgChars: Record<string, number> = {};
  for (const id of PERSONA_IDS) {
    const texts = turns.filter((t) => t.personaId === id).map((t) => t.content);
    if (texts.length === 0) {
      continue;
    }
    const all: string[] = [];
    for (const t of texts) {
      const g = charNgrams(t, 4);
      all.push(...g);
    }
    diversity[id] = new Set(all).size / all.length;
    personaAvgChars[id] = texts.reduce((a, b) => a + b.length, 0) / texts.length;
  }
  return {
    arm: result.arm,
    runIndex: result.runIndex,
    completed: turns.length === TURNS,
    collapsedMidTurns: collapsed,
    midCollapseRate: collapsed.length / Math.max(midTurns.length, 1),
    thinMidRate: thinMidTurns.length / Math.max(midTurns.length, 1),
    avgChars: lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1),
    minChars: Math.min(...lengths),
    similarity: similarities.reduce((a, b) => a + b, 0) / Math.max(similarities.length, 1),
    echoRate: echo / Math.max(echoDenom, 1),
    specificityAvg: specific.reduce((a, b) => a + b.total, 0) / Math.max(specific.length, 1),
    breakdownSignals: signals,
    personaDiversity: diversity,
    personaAvgChars,
    lengths,
    temperatures: result.personaTemperatures,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 2);
  const analyzeDir = args.find((a) => a.startsWith("--analyze="))?.split("=")[1];
  const outDir =
    analyzeDir ??
    args.find((a) => a.startsWith("--out="))?.split("=")[1] ??
    join(process.env.TEMP ?? ".", "opencode", "persona-cast-ab");

  await mkdir(outDir, { recursive: true });

  // 既存の結果を集計し直すだけのモード (LLM を呼ばない)
  if (analyzeDir) {
    const results: RunResult[] = [];
    for (const name of [...new Bun.Glob("ab_*.json").scanSync(outDir)].sort()) {
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

  const results: RunResult[] = [];
  for (const arm of ["on", "off"] as const) {
    for (let i = 0; i < runs; i++) {
      console.log(`\n=== arm=${arm} run=${i} ===`);
      const result = await runOne(arm, i, db, baseEnv, outDir);
      if (result.error) {
        console.log(`error: ${result.error}`);
      }
      console.log(`turns=${result.turns.length}/${TURNS} temps=${JSON.stringify(result.personaTemperatures)}`);
      results.push(result);
    }
  }

  const summaries = results.map(summarize);
  const report = {
    article: ARTICLE.title,
    turns: TURNS,
    generatedAt: new Date().toISOString(),
    map: { yuki: 0.6, ken: 0.4, ren: 0.3, default: 0.75 },
    summaries,
  };
  await Bun.write(join(outDir, "summary.json"), JSON.stringify(report, null, 2));
  printSummary(summaries, outDir);
}

function printSummary(summaries: ReturnType<typeof summarize>[], outDir: string) {
  console.log(`\n--- summary (${outDir}) ---`);
  const byArm = { on: [] as typeof summaries, off: [] as typeof summaries };
  for (const s of summaries) {
    byArm[s.arm].push(s);
    console.log(
      `${s.arm}#${s.runIndex} completed=${s.completed} midCollapse=${(s.midCollapseRate * 100).toFixed(0)}% ` +
        `thinMid=${(s.thinMidRate * 100).toFixed(0)}% avgChars=${s.avgChars.toFixed(0)} sim=${s.similarity.toFixed(3)} ` +
        `echo=${s.echoRate.toFixed(2)} spec=${s.specificityAvg.toFixed(1)} breakdown=${s.breakdownSignals.length} ` +
        `diversity=${JSON.stringify(
          Object.fromEntries(Object.entries(s.personaDiversity).map(([k, v]) => [k, Number(v.toFixed(3))]))
        )}`
    );
  }
  const armStats = (arm: "on" | "off") => {
    const items = byArm[arm];
    const avg = (pick: (s: (typeof items)[number]) => number) =>
      items.reduce((a, s) => a + pick(s), 0) / Math.max(items.length, 1);
    return {
      runs: items.length,
      completed: items.filter((s) => s.completed).length,
      midCollapse: avg((s) => s.midCollapseRate),
      thinMid: avg((s) => s.thinMidRate),
      avgChars: avg((s) => s.avgChars),
      similarity: avg((s) => s.similarity),
      echo: avg((s) => s.echoRate),
      specificity: avg((s) => s.specificityAvg),
      breakdown: items.reduce((a, s) => a + s.breakdownSignals.length, 0),
      diversity: Object.fromEntries(PERSONA_IDS.map((id) => [id, avg((s) => s.personaDiversity[id] ?? 0)])),
    };
  };
  const on = armStats("on");
  const off = armStats("off");
  console.log("\n=== arm aggregate ===");
  console.log(JSON.stringify({ on, off }, null, 2));
}

await main();
