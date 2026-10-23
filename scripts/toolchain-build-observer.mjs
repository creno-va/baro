import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import original from "../astro.config.ts";

// Explicit manual provenance build; the product config and emitted code are preserved.
if (process.env.CLOUDFLARE_ENV !== "production")
  throw new Error("EXPOSURE_PRODUCTION_BUILD_REQUIRED");
const root = process.cwd();
let sequence = 0;
original.vite.plugins.push({
  name: "baro-observe-emitted-module-identities",
  generateBundle(_options, bundle) {
    const directory = resolve(root, ".wrangler/toolchain-exposure");
    mkdirSync(directory, { recursive: true });
    const chunks = Object.values(bundle)
      .filter((value) => value.type === "chunk")
      .map((value) => ({
        file: value.fileName,
        imports: [...value.imports, ...value.dynamicImports].sort(),
        sha256: createHash("sha256").update(value.code).digest("hex"),
        modules: Object.keys(value.modules)
          .map((id) =>
            id.startsWith(root) ? relative(root, id) : id.replaceAll(root, "<project>"),
          )
          .sort(),
      }));
    writeFileSync(
      resolve(directory, `vite-module-graph-${++sequence}.json`),
      `${JSON.stringify({ version: 1, kind: "observed-emitted-module-identities", chunks }, null, 2)}\n`,
    );
  },
});
export default original;
