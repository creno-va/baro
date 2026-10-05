import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function migrationFiles(directory: string): Promise<string[]> {
  const files = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const file of files) {
    const path = join(directory, file.name);
    if (file.isDirectory()) result.push(...(await migrationFiles(path)));
    else result.push(path);
  }
  return result.sort();
}
async function digest() {
  const files = await migrationFiles("drizzle");
  return JSON.stringify(
    await Promise.all(
      files.map(async (path) => [
        path,
        new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex"),
      ]),
    ),
  );
}
const before = await digest();
const result = Bun.spawn(["bunx", "drizzle-kit", "generate"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await result.exited) !== 0) process.exit(1);
if (before !== (await digest())) {
  console.error(
    "Schema drift: generation changed drizzle/. Review and commit the new migration + snapshots.",
  );
  process.exit(1);
}
const test = Bun.spawn(["bun", "test", "tests/migrations.test.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await test.exited);
