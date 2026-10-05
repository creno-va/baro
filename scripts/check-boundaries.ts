import { productBoundaryFindings } from "./product-boundaries";

const errors: string[] = [];

for await (const file of new Bun.Glob("src/**/*.{ts,tsx,astro}").scan(".")) {
  if (file.endsWith(".test.ts")) continue;
  const content = await Bun.file(file).text();
  for (const finding of productBoundaryFindings(file, content)) errors.push(`${file}: ${finding}`);
  if (
    /\bBun\./.test(content) ||
    /from\s+["'](?:node:)?(?:fs|child_process|bun:sqlite)[/"']/.test(content)
  ) {
    errors.push(`${file}: development runtime API in product code`);
  }
  if (/from\s+["'][^"']*(?:tests\/|fixtures\/)/.test(content))
    errors.push(`${file}: test/fixture import in product code`);
  if (/\b(?:MOCK_AUTH|TEST_USER_ID)\b/.test(content))
    errors.push(`${file}: production auth bypass switch`);
  if (/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/.test(content))
    errors.push(`${file}: provider credential outside Unified Billing contract`);
}
const scanProcess = Bun.spawn(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
const tracked = (await new Response(scanProcess.stdout).text()).split("\0").filter(Boolean);
if ((await scanProcess.exited) !== 0) throw new Error("Cannot inspect tracked files");
for (const file of tracked) {
  if (/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/.test(file) && !file.endsWith(".example")) {
    errors.push(`${file}: local secrets tracked`);
  }
  if (!/\.(?:ts|tsx|astro|json|jsonc|yml|sql|md|example)$/.test(file)) continue;
  const content = await Bun.file(file).text();
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/.test(content)
  ) {
    errors.push(`${file}: possible credential material`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  throw new Error("Boundary checks failed");
}
console.log(
  "Runtime/fixture/auth-boundary and basic tracked-secret checks passed (not a full SAST)",
);
