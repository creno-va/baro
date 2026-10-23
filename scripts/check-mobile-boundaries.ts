import { dirname, relative, resolve } from "node:path";
import { mobileBoundaryFindings, sourceImports } from "./mobile-boundaries";

const root = process.cwd();
const contractsRoot = resolve(root, "src/contracts");
const manifest = (await Bun.file("src/contracts/package.json").json()) as {
  exports: Record<string, string>;
};
const failures: string[] = [];
const visited = new Set<string>();

async function walk(file: string) {
  if (visited.has(file)) return;
  visited.add(file);
  const local = relative(root, file).replaceAll("\\", "/");
  if (
    !file.startsWith(`${contractsRoot}/`) ||
    file === resolve(contractsRoot, "index.ts") ||
    file.endsWith("/pipeline.ts")
  ) {
    failures.push(`${local}: private/outside contract entry`);
    return;
  }
  const source = await Bun.file(file).text();
  failures.push(...mobileBoundaryFindings(local, source).map((message) => `${local}: ${message}`));
  for (const specifier of sourceImports(source)) {
    if (specifier.startsWith(".")) await walk(resolve(dirname(file), `${specifier}.ts`));
  }
}

for (const [key, entry] of Object.entries(manifest.exports)) {
  if (key.includes("*") || entry.includes("*") || !entry.startsWith("./"))
    failures.push(`contract export must be explicit: ${key}`);
  else await walk(resolve(contractsRoot, entry));
}
for await (const file of new Bun.Glob("apps/mobile/{src,config,runtime-probe}/**/*.{ts,tsx}").scan(
  ".",
)) {
  failures.push(
    ...mobileBoundaryFindings(file, await Bun.file(file).text()).map(
      (message) => `${file}: ${message}`,
    ),
  );
}
for await (const file of new Bun.Glob("packages/*/src/**/*.{ts,tsx}").scan(".")) {
  const source = await Bun.file(file).text();
  failures.push(...mobileBoundaryFindings(file, source).map((message) => `${file}: ${message}`));
  for (const specifier of sourceImports(source)) {
    if (specifier.startsWith("@baro/contracts/")) {
      const entry = manifest.exports[`./${specifier.slice("@baro/contracts/".length)}`];
      if (!entry) failures.push(`${file}: nonpublic contract import: ${specifier}`);
    }
    if (file.startsWith("packages/client-core/") && specifier === "@baro/client-core")
      failures.push(`${file}: shared core cannot import itself through a package cycle`);
  }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  `Mobile boundaries passed; ${visited.size} canonical contract modules, no server/DOM/internal pipeline dependencies`,
);
