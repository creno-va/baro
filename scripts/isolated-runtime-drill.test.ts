import { expect, test } from "bun:test";
import { basename } from "node:path";
import { DrillCommandError } from "./isolated-drill-process";
import { type RuntimeDrillIo, runRuntimeDrill, runtimeDrillNames } from "./isolated-runtime-drill";

const environment = {
  GITHUB_SHA: "a".repeat(40),
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "creno-va/baro",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ID: "123456789",
  GITHUB_RUN_ATTEMPT: "1",
  DRILL_CONFIRMATION: "isolated-synthetic-only",
  CLOUDFLARE_ACCOUNT_ID: "9e844969d0c44b2449f3951d1f301654",
  CLOUDFLARE_API_TOKEN: "synthetic-platform-token",
};
const names = runtimeDrillNames(environment.GITHUB_RUN_ID, environment.GITHUB_RUN_ATTEMPT);
const baselineVersion = "11111111-1111-4111-8111-111111111111";
type Receipt = Record<string, unknown>;
type Faults = {
  failReceipt?: (receipt: Receipt) => boolean;
  lostBucketResponse?: boolean;
  wrongBucketIdentity?: boolean;
  lostDeployResponse?: boolean;
  failedDeletion?: string;
  failedPrivateRemoval?: string;
};

async function simulate(faults: Faults = {}) {
  const calls: string[] = [],
    files = new Map<string, unknown>(),
    resources = new Set<string>(),
    snapshots: Receipt[] = [],
    removed: string[] = [];
  let phase = "baseline",
    diskFailed = false;
  const success = (result: unknown) => Response.json({ success: true, result });
  const missing = () => new Response(null, { status: 404 });
  // Every external and private-file operation is replaced. Unexpected calls throw;
  // there is no fallback to fetch, Wrangler, credentials or the host filesystem.
  const io: RuntimeDrillIo = {
    request: (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.hostname === `${names.worker}.synthetic.workers.dev`) {
        calls.push(`control ${url.pathname}`);
        expect(method).toBe("POST");
        const provenance = {
          candidateSha: environment.GITHUB_SHA,
          runId: `${environment.GITHUB_RUN_ID}-1`,
          phase,
        };
        const cipher = { recovered: true, rejectedBindings: 3 };
        switch (url.pathname) {
          case "/ready":
            return Response.json(provenance);
          case "/seed":
            return Response.json({ ...provenance, status: "seeded" });
          case "/inspect":
            return Response.json({
              ...provenance,
              ...cipher,
              completed: "complete",
              active: "waiting",
              targetPresent: true,
            });
          case "/recover":
            return phase === "key-lost"
              ? Response.json({ error: "CRYPTO_DECRYPT_FAILED" }, { status: 502 })
              : Response.json({ ...provenance, ...cipher });
          case "/delete":
            return Response.json({
              ...provenance,
              ...cipher,
              completedAbsent: true,
              activeAbsent: true,
              targetAbsent: true,
            });
          case "/late":
            return Response.json({ ...provenance, lateAbsent: true });
          case "/cleanup":
            return Response.json({ ...provenance, remainingObjects: 0 });
        }
        throw new Error("UNEXPECTED_CONTROL_REQUEST");
      }
      expect(url.origin).toBe("https://api.cloudflare.com");
      const prefix = `/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}/`;
      expect(url.pathname.startsWith(prefix)).toBe(true);
      const path = url.pathname.slice(prefix.length);
      calls.push(`${method} ${path}`);
      if (method === "GET" && path === "workers/subdomain")
        return success({ subdomain: "synthetic" });
      if (method === "POST" && path === "r2/buckets") {
        expect(JSON.parse(String(init?.body))).toEqual({ name: names.bucket });
        resources.add("bucket");
        if (faults.lostBucketResponse) throw new Error("sensitive upstream diagnostic");
        return success({ name: faults.wrongBucketIdentity ? "foreign-bucket" : names.bucket });
      }
      const resourcePaths = {
        bucket: `r2/buckets/${names.bucket}`,
        workflow: `workflows/${names.workflow}`,
        worker: `workers/scripts/${names.worker}`,
      };
      for (const [kind, resourcePath] of Object.entries(resourcePaths)) {
        if (method === "DELETE" && path === resourcePath) {
          if (faults.failedDeletion === kind) return new Response(null, { status: 503 });
          resources.delete(kind);
          return success(null);
        }
        if (method === "GET" && path === `${resourcePath}${kind === "worker" ? "/settings" : ""}`)
          return resources.has(kind)
            ? success({
                bindings: [
                  { type: "r2_bucket", name: "DRILL_BUCKET", bucket_name: names.bucket },
                  { type: "workflow", name: "ANALYSIS_WORKFLOW", workflow_name: names.workflow },
                ],
              })
            : missing();
      }
      if (method === "GET" && path === `workers/scripts/${names.worker}/deployments`)
        return success({
          deployments: [{ versions: [{ version_id: baselineVersion, percentage: 100 }] }],
        });
      throw new Error("UNEXPECTED_PLATFORM_REQUEST");
    }) as typeof fetch,
    async runWrangler(args, timeout) {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(90_000);
      calls.push(`wrangler ${args[0]}`);
      if (args[0] === "deploy") {
        const config = files.get("wrangler.json") as {
          name: string;
          vars: { DRILL_PHASE: string };
        };
        expect(config.name).toBe(names.worker);
        resources.add("worker");
        resources.add("workflow");
        if (faults.lostDeployResponse)
          throw new DrillCommandError("WRANGLER_OUTCOME_UNKNOWN", {
            runtime: "node",
            exitCode: null,
            signal: "SIGTERM",
            timedOut: false,
            durationMs: 1,
            stdoutBytes: 100,
            stderrBytes: 50,
          });
        phase = config.vars.DRILL_PHASE;
      } else {
        expect(args[0]).toBe("rollback");
        expect(args[1]).toBe(baselineVersion);
        phase = "baseline";
      }
      return {
        runtime: "node",
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 1,
        stdoutBytes: 0,
        stderrBytes: 0,
      };
    },
    async writePrivateFile(path, value) {
      if (basename(path) === "receipt.json") {
        if (faults.failReceipt?.(value as Receipt)) diskFailed = true;
        if (diskFailed) throw new Error("sensitive filesystem diagnostic");
        snapshots.push(structuredClone(value as Receipt));
      }
      files.set(basename(path), structuredClone(value));
    },
    async readPrivateFile(path) {
      return structuredClone(files.get(basename(path)));
    },
    async removePrivateFile(path) {
      removed.push(basename(path));
      if (faults.failedPrivateRemoval === basename(path)) throw new Error("private removal failed");
      files.delete(basename(path));
    },
  };
  const report = await runRuntimeDrill(environment, "/synthetic-drill", io);
  return { report, calls, resources, snapshots, removed };
}

function checkpoint(stage: string, state: string) {
  return (report: Receipt) => {
    const last = report.lastMutation as { stage?: string; state?: string } | null;
    return last?.stage === stage && last.state === state;
  };
}
const deletions = (calls: string[]) => calls.filter((call) => call.startsWith("DELETE "));

test("the full runner only reports success after observed resource and private-file cleanup", async () => {
  const { report, resources, snapshots, removed } = await simulate();
  expect(report.passed).toBe(true);
  expect(report.evidenceWriteFailed).toBe(false);
  expect(report.observedResources).toEqual({ worker: true, workflow: true });
  expect(report.created).toBeUndefined();
  expect(
    snapshots.some(
      (receipt) =>
        (receipt.lastMutation as { state?: string; stage?: string } | null)?.stage ===
          "wrangler_deploy" &&
        (receipt.lastMutation as { state?: string }).state === "command-completed" &&
        (receipt.observedResources as { worker: boolean }).worker === false,
    ),
  ).toBe(true);
  expect(resources.size).toBe(0);
  expect(removed).toEqual(["secrets.json", "recovery-key.json"]);
  expect(snapshots.filter((r) => r.passed)).toHaveLength(1);
  expect(snapshots.at(-1)).toMatchObject({
    passed: true,
    privateFilesRemoved: true,
    cleanup: { objectsAndInstances: true, workflow: true, worker: true, bucket: true },
  });
});

test("failure to persist pending work prevents the unrecorded creation", async () => {
  const result = await simulate({ failReceipt: checkpoint("CF_POST_r2/buckets", "pending") });
  expect(result.calls).not.toContain("POST r2/buckets");
  expect(result.resources.size).toBe(0);
  expect(result.report.passed).toBe(false);
});

test.each(["bucket", "worker"] as const)(
  "known %s ownership survives a failed success checkpoint and persistent disk failure",
  async (kind) => {
    const result = await simulate({
      failReceipt: checkpoint(
        kind === "bucket" ? "CF_POST_r2/buckets" : "wrangler_deploy",
        kind === "bucket" ? "observed-success" : "command-completed",
      ),
    });
    expect(result.report).toMatchObject({
      passed: false,
      evidenceWriteFailed: true,
      failure: "DRILL_RECEIPT_WRITE_FAILED",
      cleanupEligible: { bucket: true, worker: kind === "worker", workflow: kind === "worker" },
      cleanup: { bucket: true },
      privateFilesRemoved: true,
    });
    expect(result.resources.size).toBe(0);
    expect(deletions(result.calls)).toHaveLength(kind === "bucket" ? 1 : 3);
    expect(result.calls.filter((call) => call.startsWith("wrangler "))).toHaveLength(
      kind === "bucket" ? 0 : 1,
    );
    expect(result.calls).not.toContain("control /seed");
    expect(result.snapshots.every((r) => r.passed === false)).toBe(true);
  },
);

test("cleanup runs despite a failed pending checkpoint and preserves an independent deletion failure", async () => {
  const result = await simulate({
    failReceipt: checkpoint("control_cleanup", "pending"),
    failedDeletion: "workflow",
  });
  expect(result.calls).toContain("control /cleanup");
  expect(deletions(result.calls)).toHaveLength(3);
  expect(result.report).toMatchObject({
    passed: false,
    evidenceWriteFailed: true,
    cleanup: { objectsAndInstances: true, workflow: false, worker: true, bucket: true },
    privateFilesRemoved: true,
  });
  expect([...result.resources]).toEqual(["workflow"]);
});

test.each(["bucket-response", "bucket-identity", "deployment"] as const)(
  "unknown or invalid %s does not grant ownership or trigger a blind mutation retry",
  async (fault) => {
    const result = await simulate({
      lostBucketResponse: fault === "bucket-response",
      wrongBucketIdentity: fault === "bucket-identity",
      lostDeployResponse: fault === "deployment",
    });
    expect(result.report.passed).toBe(false);
    expect(result.report.cleanupEligible).toEqual({
      bucket: fault === "deployment",
      worker: false,
      workflow: false,
    });
    expect(result.calls.filter((call) => call === "POST r2/buckets")).toHaveLength(1);
    expect(result.calls.filter((call) => call === "wrangler deploy")).toHaveLength(
      fault === "deployment" ? 1 : 0,
    );
    expect(deletions(result.calls)).toEqual(
      fault === "deployment" ? [`DELETE r2/buckets/${names.bucket}`] : [],
    );
    expect(result.calls).not.toContain("control /cleanup");
    if (fault === "deployment") {
      expect(result.report.commands).toEqual([
        {
          operation: "deploy",
          runtime: "node",
          exitCode: null,
          signal: "SIGTERM",
          timedOut: false,
          durationMs: 1,
          stdoutBytes: 100,
          stderrBytes: 50,
        },
      ]);
      expect(result.report.observedResources).toEqual({ worker: false, workflow: false });
    }
  },
);

test("a final evidence write failure cannot skip secret removal or become a passing result", async () => {
  const result = await simulate({ failReceipt: (report) => Boolean(report.completedAt) });
  expect(result.report).toMatchObject({
    passed: false,
    evidenceWriteFailed: true,
    privateFilesRemoved: true,
  });
  expect(result.resources.size).toBe(0);
  expect(result.removed).toEqual(["secrets.json", "recovery-key.json"]);
  expect(result.snapshots.every((report) => report.passed === false)).toBe(true);
});

test("private-file removal attempts are independent and a failed removal cannot pass", async () => {
  const result = await simulate({ failedPrivateRemoval: "secrets.json" });
  expect(result.removed).toEqual(["secrets.json", "recovery-key.json"]);
  expect(result.report).toMatchObject({
    passed: false,
    privateFilesRemoved: false,
    failure: "DRILL_PRIVATE_FILE_CLEANUP_FAILED",
  });
});
