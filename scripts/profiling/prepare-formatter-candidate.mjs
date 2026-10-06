import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";

// An isolated built-artifact experiment. Product src remains byte-for-byte unchanged.
const root = ".wrangler/profile-formatter-build";
await cp("dist", root, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes(".wrangler"),
});
const sourcePath = "src/components/workspace/Workspace.tsx";
const source = await readFile(sourcePath, "utf8");
const needle =
  /new Date\(message.createdAt\)\.toLocaleTimeString\("ko-KR", \{\r?\n\s*hour: "2-digit",\r?\n\s*minute: "2-digit",\r?\n\s*\}\)/;
if (!needle.test(source))
  throw new Error("Source formatter changed; rebase candidate before comparing");
let changed = source.replace(needle, "messageTime(message.createdAt)");
changed = changed.replace(
  "export type WorkspaceTab",
  'const chatClock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });\nfunction messageTime(createdAt: string) {\n  const date = new Date(createdAt);\n  return Number.isNaN(date.getTime())\n    ? date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })\n    : chatClock.format(date);\n}\n\nexport type WorkspaceTab',
);
await mkdir("scripts/profiling/candidates", { recursive: true });
await writeFile(".wrangler/profile-workspace-candidate.tsx", changed);
const diff = spawnSync(
  "git",
  ["diff", "--no-index", "--", sourcePath, ".wrangler/profile-workspace-candidate.tsx"],
  { encoding: "utf8" },
);
if (diff.status !== 1) throw new Error("Candidate diff failed");
const patch = diff.stdout.replaceAll(
  "b/.wrangler/profile-workspace-candidate.tsx",
  `b/${sourcePath}`,
);
await writeFile("scripts/profiling/candidates/shared-chat-formatter.patch", patch);
const files = await readdir(`${root}/client/_astro`);
const name = files.find((n) => /^Workspace\..*\.js$/.test(n));
if (!name) throw new Error("Missing built Workspace chunk");
const path = `${root}/client/_astro/${name}`;
const before = await readFile(path, "utf8");
const builtNeedle =
  /new Date\((\w+)\.createdAt\)\.toLocaleTimeString\(["\x60]ko-KR["\x60],\{hour:["\x60]2-digit["\x60],minute:["\x60]2-digit["\x60]\}\)/g;
const matches = [...before.matchAll(builtNeedle)];
if (matches.length !== 1) throw new Error("Expected exactly one built formatter expression");
const after =
  'const __baroChatClock=new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit"});\nfunction __baroMessageTime(value){const date=new Date(value);return Number.isNaN(date.getTime())?date.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}):__baroChatClock.format(date);}\n' +
  before.replace(builtNeedle, (_, name) => `__baroMessageTime(${name}.createdAt)`);
await writeFile(path, after);
const hash = (s) => createHash("sha256").update(s).digest("hex");
await writeFile(
  `${root}/candidate-manifest.json`,
  JSON.stringify(
    {
      experiment:
        "source-equivalent formatter expression substituted in isolated built artifact; source untouched",
      sourcePath,
      sourceSha256: hash(source),
      patchSha256: hash(patch),
      chunk: name,
      beforeSha256: hash(before),
      afterSha256: hash(after),
      matches: matches.length,
    },
    null,
    2,
  ),
);
console.log(`Prepared ${root} and 1-file candidate patch; product source unchanged`);
