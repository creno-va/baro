import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

// Pinned SDK compatibility only; this is not a Cloudflare remote absence receipt.
test("pinned Workerd Workflow binding returns exact structured deletion and replay absence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-cleanup-native-"));
  let mf: Miniflare | undefined;
  try {
    const entry = join(directory, "fixture.ts");
    await writeFile(
      entry,
      `
import { WorkflowEntrypoint } from "cloudflare:workers";
import { deleteWorkflowInstance } from ${JSON.stringify(resolve("src/server/modules/deletion/workflow-cleanup.ts"))};
export class SyntheticCleanupWorkflow extends WorkflowEntrypoint {
  async run(event, step) { return await step.do("synthetic step", async () => "complete"); }
}
export default {
  async fetch(request, env) {
    const id = "synthetic-cleanup-instance-1";
    const instance = await env.WORKFLOW.create({ id });
    let complete = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await instance.status()).status === "complete") { complete = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!complete) throw new Error("SYNTHETIC_COMPLETION_UNCONFIRMED");
    const deleted = await deleteWorkflowInstance(env.WORKFLOW, id);
    const replay = await deleteWorkflowInstance(env.WORKFLOW, id);
    const absent = await deleteWorkflowInstance(env.WORKFLOW, "synthetic-never-created-1");
    return Response.json({deleted, replay, absent});
  }
};`,
    );
    const built = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      external: ["cloudflare:workers"],
    });
    expect(built.success).toBe(true);
    const output = built.outputs[0];
    if (!output) throw new Error("synthetic bundle missing");
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "baro-cleanup-native-test",
        modules: true,
        script: await output.text(),
        compatibilityDate: "2026-10-04",
        cf: false,
        unsafeRegisterWorker: false,
        workflows: {
          WORKFLOW: { name: "baro-cleanup-native-test", className: "SyntheticCleanupWorkflow" },
        },
        workflowExports: { SyntheticCleanupWorkflow: { name: "baro-cleanup-native-test" } },
      }),
    );
    const response = await fetch(await mf.ready);
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toEqual({
      deleted: true,
      replay: false,
      absent: false,
    });
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
