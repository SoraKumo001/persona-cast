/**
 * .dev.vars の EXA_API_KEY で Exa Lite を1回叩き、URLが取れるか確認する。
 */
import { searchExaLite } from "../src/worker/services/exa-search";

async function loadDevVars(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const text = await Bun.file(".dev.vars").text();
  for (const line of text.split(/\r?\n/u)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/u.exec(line);
    if (!m || m[1].startsWith("#")) {
      continue;
    }
    vars[m[1]] = m[2].trim().replace(/^"(.*)"$/u, "$1");
  }
  return vars;
}

const vars = await loadDevVars();
const key = vars.EXA_API_KEY;
if (!key) {
  throw new Error(".dev.vars に EXA_API_KEY がありません");
}

const query = process.argv[2] ?? "React Server Components";
console.log("query:", query);
const urls = await searchExaLite(query, key, 5);
console.log("count:", urls.length);
for (const u of urls) {
  console.log("-", u);
}
if (urls.length === 0) {
  process.exit(1);
}
