/**
 * D1 のマイグレーションを適用する。データベースIDは cloudflare.config.ts の DB.id から読むので、
 * ID を package.json に重ねて書かなくてよい。
 * 使い方: bun scripts/d1-migrate.ts [--local] [cf の追加オプション (--dry-run など)]
 */
import config from "../cloudflare.config";

const database = (config as { worker?: { env?: { DB?: { id?: string } } } }).worker?.env?.DB;
const id = database?.id;
if (!id) {
  console.error("cloudflare.config.ts の DB.id が設定されていません。`cf d1 list` で ID を確認して設定してください。");
  process.exit(1);
}

const proc = Bun.spawn(["bun", "x", "cf", "d1", "migrations", "apply", id, ...Bun.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await proc.exited);
