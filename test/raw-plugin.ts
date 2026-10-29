// bun test 用: Vite の `import x from "./file.md?raw"` を、ファイル内容の文字列として読み込む
import { plugin } from "bun";
import { dirname, resolve } from "node:path";

plugin({
  name: "raw-query",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, "")),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
      loader: "js",
    }));
  },
});
