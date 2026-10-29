// bun test 用: Vite の `import x from "./file.md?raw"` を、ファイル内容の文字列として読み込む

import { dirname, resolve } from "node:path";
import { plugin } from "bun";

plugin({
  name: "raw-query",
  setup(build) {
    build.onResolve({ filter: /\?raw$/u }, (args) => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/u, "")),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/u, namespace: "raw" }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
      loader: "js",
    }));
  },
});
