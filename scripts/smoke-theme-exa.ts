/**
 * ローカル dev にテーマ論戦を投げ、researched とソース有無を確認する。
 */
const theme = process.argv[2] ?? `Exa検証 ${new Date().toISOString().slice(0, 19)}`;
const base = process.env.BASE_URL ?? "http://localhost:5173";

console.log("POST", `${base}/api/sessions`, { theme });

const res = await fetch(`${base}/api/sessions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson, application/json",
  },
  body: JSON.stringify({ theme }),
});

const ct = res.headers.get("content-type") ?? "";
console.log("status", res.status, "content-type", ct);

if (ct.includes("application/x-ndjson") && res.body) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: { status?: number; body?: Record<string, unknown> } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines.filter((l) => l.trim())) {
      const parsed = JSON.parse(line) as {
        type: string;
        step?: string;
        status?: number;
        body?: Record<string, unknown>;
      };
      if (parsed.type === "progress") {
        console.log("progress", parsed.step);
      } else if (parsed.type === "result") {
        result = { status: parsed.status, body: parsed.body };
      }
    }
    if (done) {
      break;
    }
  }
  if (!result) {
    throw new Error("result 行がありません");
  }
  console.log("result status", result.status);
  console.log(JSON.stringify(result.body, null, 2));
  if (result.status !== 200 || result.body?.researched !== true) {
    process.exit(1);
  }
  const sessionId = result.body.sessionId as string;
  const detail = await fetch(`${base}/api/sessions/${sessionId}`);
  const detailJson = (await detail.json()) as {
    session?: { articleSummary?: string; mode?: string };
  };
  const summary = detailJson.session?.articleSummary ?? "";
  console.log("mode", detailJson.session?.mode);
  console.log("has sources marker", summary.includes("【参考ページ】"));
  const sources = [...summary.matchAll(/^- (.+): (https?:\/\/\S+)/gmu)].map((m) => `${m[1]} ${m[2]}`);
  console.log("sources", sources.length);
  for (const s of sources.slice(0, 6)) {
    console.log("-", s);
  }
  if (!summary.includes("【参考ページ】") || sources.length === 0) {
    process.exit(1);
  }
} else {
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  process.exit(res.ok ? 0 : 1);
}
