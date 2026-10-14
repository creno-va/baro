import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createNativeTestRegistry } from "./helpers/native-lifetime";

const native = createNativeTestRegistry();
afterEach(() => native.stop());

test("workerd phase scopes observe native D1/R2 awaits without consuming stored bodies", () =>
  native.run(async (lifetime) => {
    const directory = await mkdtemp(join(tmpdir(), "baro-native-file-phase-"));
    let script: string;
    try {
      const entrypoint = join(directory, "fixture.ts"),
        output = join(directory, "fixture.js");
      await writeFile(
        entrypoint,
        `
import {createFilePhaseObservation} from ${JSON.stringify(resolve("src/server/modules/file-processing/phase-observation.ts"))};
export default { async fetch(request, env) {
  let stage = "setup_database";
  try {
  await env.DB.prepare("CREATE TABLE synthetic (value INTEGER)").run();
  await env.DB.prepare("INSERT INTO synthetic VALUES (7)").run();
  stage = "setup_bucket";
  await env.BUCKET.put("synthetic", "bounded synthetic bytes");
  stage = "capture_log";
  const receipts = [], original = console.info;
  console.info = value => receipts.push(JSON.parse(value));
  let preserved = false, body = null;
  try {
    stage = "construct_observation";
    const timing = createFilePhaseObservation(env.DB, env.BUCKET, "preview");
    const statement = timing.database.prepare("SELECT value FROM synthetic");
    stage = "measure";
    await Promise.all([
      timing.measure("prepare_publication", async () => {
        const first = await statement.first("value");
        const object = await timing.bucket.get("synthetic");
        preserved = !object.body.locked && first === 7;
        body = await new Response(object.body).text();
      }),
      timing.measure("stage_result", async () => {
        await timing.database.batch([statement, statement]);
        await timing.bucket.head("synthetic");
        await timing.bucket.put("synthetic-output", "output");
      }),
    ]);
    return Response.json({receipts, preserved, bodyMatches: body === "bounded synthetic bytes", productionDisabled: createFilePhaseObservation(env.DB, env.BUCKET, "production") === null});
  } finally { console.info = original; }
  } catch (error) { return Response.json({stage, name: ["Error", "TypeError", "ReferenceError"].includes(error?.name) ? error.name : "unknown", category: /read.only|readonly|assign/i.test(String(error?.message)) ? "readonly" : /context/i.test(String(error?.message)) ? "context" : /not a function/i.test(String(error?.message)) ? "method" : "unknown"}, {status: 500}); }
}};`,
      );
      const compiler = Bun.spawn(
        [
          process.execPath,
          "build",
          entrypoint,
          // Preserve the real Workers node:async_hooks import. Bun's browser
          // target substitutes an empty object even with an external flag.
          "--target=node",
          `--outfile=${output}`,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      await new Response(compiler.stderr).text();
      expect(await compiler.exited).toBe(0);
      script = await Bun.file(output).text();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    lifetime.check();
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script,
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["BUCKET"],
        cf: false,
        unsafeRegisterWorker: false,
      }),
    );
    lifetime.own(() => mf.dispose());
    const response = await fetch(await mf.ready, { signal: lifetime.signal });
    if (response.status !== 200) throw new Error(JSON.stringify(await response.json()));
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      receipts: Record<string, unknown>[];
      preserved: boolean;
      bodyMatches: boolean;
      productionDisabled: boolean;
    };
    expect(result.preserved).toBe(true);
    expect(result.bodyMatches).toBe(true);
    expect(result.productionDisabled).toBe(true);
    expect(result.receipts).toHaveLength(2);
    for (const receipt of result.receipts) {
      expect(receipt).toMatchObject({
        event: "preview_file_phase_awaits",
        outcome: "success",
        d1Calls: 1,
        d1Failed: 0,
        d1TimedCalls: 1,
        r2Calls: receipt.phase === "stage_result" ? 2 : 1,
        r2Failed: 0,
      });
      for (const key of ["overallMs", "d1AwaitMs", "r2AwaitMs"]) expect(receipt[key]).toBeNumber();
    }
  }));
