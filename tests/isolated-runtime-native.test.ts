import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { runDrillWrangler } from "../scripts/isolated-drill-process";

test("the deployed runtime drill bundle routes control POSTs with native R2 and Workflows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-runtime-native-"));
  let mf: Miniflare | undefined;
  try {
    const config = join(directory, "wrangler.json");
    const outdir = join(directory, "bundle");
    const bindings = {
      DRILL_ENVIRONMENT: "isolated-test",
      DRILL_RUN_ID: "123-1",
      RELEASE_SHA: "a".repeat(40),
      DRILL_TOKEN: "b".repeat(64),
      CASE_DATA_KEY_V1: Buffer.from("k".repeat(32)).toString("base64url"),
      DRILL_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
      DRILL_PHASE: "baseline",
    };
    await writeFile(
      config,
      JSON.stringify({
        name: "baro-runtime-native-test",
        main: resolve("scripts/isolated-runtime-worker.ts"),
        compatibility_date: "2026-10-04",
        vars: bindings,
        r2_buckets: [{ binding: "DRILL_BUCKET", bucket_name: "baro-runtime-native-test" }],
        workflows: [
          {
            binding: "ANALYSIS_WORKFLOW",
            name: "baro-runtime-native-test",
            class_name: "IsolatedRecoveryWorkflow",
          },
        ],
      }),
      { mode: 0o600 },
    );
    const built = await runDrillWrangler(
      ["deploy", "--dry-run", "--config", config, "--outdir", outdir],
      20_000,
    );
    expect(built.exitCode).toBe(0);
    const files = await readdir(outdir);
    const entry = files.find((file) => file === "isolated-runtime-worker.js");
    expect(entry).toBeDefined();
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "baro-runtime-native-test",
        modules: true,
        script: await Bun.file(join(outdir, entry ?? "missing.js")).text(),
        compatibilityDate: "2026-10-04",
        bindings,
        r2Buckets: ["DRILL_BUCKET"],
        workflows: {
          ANALYSIS_WORKFLOW: {
            name: "baro-runtime-native-test",
            className: "IsolatedRecoveryWorkflow",
          },
        },
        workflowExports: { IsolatedRecoveryWorkflow: { name: "baro-runtime-native-test" } },
        cf: false,
        unsafeRegisterWorker: false,
      }),
    );
    const origin = await mf.ready;
    const call = async (path: string) => {
      const response = await fetch(new URL(path, origin), {
        method: "POST",
        headers: { authorization: `Bearer ${bindings.DRILL_TOKEN}` },
        redirect: "error",
      });
      return {
        status: response.status,
        body: await response.json(),
        marker: response.headers.get("x-baro-drill-control"),
        candidate: response.headers.get("x-baro-drill-release"),
        run: response.headers.get("x-baro-drill-run"),
      };
    };
    expect(await call("/ready")).toMatchObject({ status: 200, body: { phase: "baseline" } });
    expect(await call("/seed")).toMatchObject({ status: 200, body: { status: "seeded" } });
    expect(await call("/inspect")).toMatchObject({
      status: 200,
      body: { recovered: true, targetPresent: true },
    });
    expect(await call("/cleanup")).toMatchObject({ status: 200, body: { remainingObjects: 0 } });
    expect(await call("/unknown")).toMatchObject({
      status: 404,
      body: { error: "NOT_FOUND" },
      marker: "runtime-v1",
      candidate: bindings.RELEASE_SHA,
      run: bindings.DRILL_RUN_ID,
    });
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
