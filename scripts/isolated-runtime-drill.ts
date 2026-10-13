import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const account = "9e844969d0c44b2449f3951d1f301654";
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const versionId = z.uuid();
export function runtimeDrillNames(runId: string, attempt: string) {
  if (!/^\d{1,20}$/.test(runId) || !/^\d{1,3}$/.test(attempt))
    throw new Error("INVALID_DRILL_IDENTITY");
  const name = `baro-drill-runtime-${runId}-${attempt}`;
  return { worker: name, workflow: name, bucket: name };
}
const observed = z.object({
  candidateSha: sha,
  runId: z.string(),
  phase: z.enum(["baseline", "key-lost", "key-restored"]),
});
export function drillRequestBudget(
  deadline: number,
  cleanup: boolean,
  now = Date.now(),
  maximum = 15_000,
) {
  const remaining = cleanup ? maximum : deadline - now;
  if (remaining <= 0) throw new Error("DRILL_TIME_BUDGET_EXHAUSTED");
  return Math.min(maximum, remaining);
}

async function run() {
  const candidate = sha.parse(process.env.GITHUB_SHA);
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "creno-va/baro" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.DRILL_CONFIRMATION !== "isolated-synthetic-only" ||
    process.env.CLOUDFLARE_ACCOUNT_ID !== account ||
    !process.env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("INVALID_EXECUTION_SCOPE");
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  const names = runtimeDrillNames(runId, attempt);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const dir = resolve(".wrangler/isolated-runtime");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const receipt: Record<string, unknown> = {
    candidateSha: candidate,
    runId,
    attempt,
    environment: "isolated-test",
    resources: names,
    scope:
      "synthetic Workflow deletion, private R2, key recovery and same-code configuration rollback",
    productRestoreVerified: false,
    containerVerified: false,
    onCallAlertVerified: false,
    checks: {},
    cleanup: {},
    passed: false,
    lastMutation: null,
    mutations: [],
  };
  const checks = receipt.checks as Record<string, boolean>;
  const cleanup = receipt.cleanup as Record<string, boolean>;
  let bucketCreated = false;
  let workerCreated = false;
  let workflowCreated = false;
  let origin: string | undefined;
  let failed = false;
  let cleaning = false;
  const deadline = Date.now() + 12 * 60_000;
  const controlToken = crypto.getRandomValues(new Uint8Array(32)).toHex();
  const recoveryKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const secretFile = resolve(dir, "secrets.json");
  const recoveryFile = resolve(dir, "recovery-key.json");
  const configPath = resolve(dir, "wrangler.json");
  const expiresAt = new Date(Date.now() + 40 * 60_000).toISOString();
  const secrets = { DRILL_TOKEN: controlToken, CASE_DATA_KEY_V1: recoveryKey };
  async function privateFile(path: string, value: unknown) {
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await chmod(path, 0o600);
  }
  async function mutationCheckpoint(stage: string, state: "pending" | "observed-success") {
    const mutations = receipt.mutations as { stage: string; state: string; observedAt: string }[];
    const last = mutations.at(-1);
    if (state === "observed-success" && last?.stage === stage && last.state === "pending") {
      last.state = state;
      last.observedAt = new Date().toISOString();
    } else {
      mutations.push({ stage, state, observedAt: new Date().toISOString() });
    }
    receipt.lastMutation = mutations.at(-1);
    receipt.created = { bucket: bucketCreated, worker: workerCreated, workflow: workflowCreated };
    await privateFile(resolve(dir, "receipt.json"), receipt);
  }
  async function api(path: string, method = "GET", body?: unknown, missing = false) {
    const timeout = drillRequestBudget(deadline, cleaning);
    if (method !== "GET") await mutationCheckpoint(`CF_${method}_${path}`, "pending");
    let response: Response;
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error(`CF_${method}_OUTCOME_UNKNOWN`);
    }
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`CF_${method}_HTTP_${response.status}`);
    const parsed = z
      .object({ success: z.literal(true), result: z.unknown() })
      .safeParse(await response.json());
    if (!parsed.success) throw new Error(`CF_${method}_INVALID_RESPONSE`);
    if (method !== "GET") await mutationCheckpoint(`CF_${method}_${path}`, "observed-success");
    return parsed.data.result;
  }
  async function wrangler(args: string[]) {
    // Wrangler 4.147 may retry an identical Worker PUT up to three times internally.
    // Bound the entire subprocess; never repeat a failed/unknown command in this runner.
    const timeout = drillRequestBudget(deadline, cleaning, Date.now(), 90_000);
    await mutationCheckpoint(`wrangler_${args[0]}`, "pending");
    const result = Bun.spawn([process.execPath, "node_modules/wrangler/bin/wrangler.js", ...args], {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      result.kill("SIGKILL");
    }, timeout);
    // Never forward Wrangler logs; platform diagnostics may contain identifiers or config.
    try {
      await Promise.all([
        new Response(result.stdout).arrayBuffer(),
        new Response(result.stderr).arrayBuffer(),
      ]);
      const status = await result.exited;
      if (timedOut) throw new Error("WRANGLER_OUTCOME_UNKNOWN");
      if (status !== 0) throw new Error("WRANGLER_COMMAND_FAILED");
      await mutationCheckpoint(`wrangler_${args[0]}`, "observed-success");
    } finally {
      clearTimeout(timer);
    }
  }
  async function deploy(phase: "baseline" | "key-lost" | "key-restored") {
    await privateFile(configPath, {
      name: names.worker,
      account_id: account,
      main: resolve("scripts/isolated-runtime-worker.ts"),
      compatibility_date: "2026-10-04",
      workers_dev: true,
      preview_urls: false,
      observability: { enabled: false },
      vars: {
        DRILL_ENVIRONMENT: "isolated-test",
        DRILL_RUN_ID: `${runId}-${attempt}`,
        RELEASE_SHA: candidate,
        DRILL_EXPIRES_AT: expiresAt,
        DRILL_PHASE: phase,
      },
      r2_buckets: [{ binding: "DRILL_BUCKET", bucket_name: names.bucket }],
      workflows: [
        {
          binding: "ANALYSIS_WORKFLOW",
          name: names.workflow,
          class_name: "IsolatedRecoveryWorkflow",
        },
      ],
    });
    await wrangler(["deploy", "--config", configPath, "--secrets-file", secretFile]);
  }
  async function waitForPhase(phase: "baseline" | "key-lost" | "key-restored") {
    for (let i = 0; i < 20; i++) {
      drillRequestBudget(deadline, cleaning);
      try {
        if (observed.parse(await control("ready")).phase === phase) return;
      } catch {
        // Read-only readiness may lag deployment; never retry a mutating control action.
      }
      await Bun.sleep(3000);
    }
    throw new Error("DEPLOYMENT_NOT_OBSERVED");
  }
  async function activeVersion() {
    const result = z
      .object({
        deployments: z.array(
          z.object({
            versions: z.array(z.object({ version_id: versionId, percentage: z.number() })),
          }),
        ),
      })
      .parse(await api(`workers/scripts/${names.worker}/deployments`));
    const current = result.deployments[0]?.versions;
    if (current?.length !== 1 || current[0]?.percentage !== 100)
      throw new Error("AMBIGUOUS_DEPLOYMENT");
    return current[0].version_id;
  }
  async function control(path: string, expectedStatus = 200) {
    if (!origin) throw new Error("ORIGIN_UNAVAILABLE");
    const timeout = drillRequestBudget(deadline, cleaning);
    const mutating = ["seed", "delete", "late", "cleanup"].includes(path);
    if (mutating) await mutationCheckpoint(`control_${path}`, "pending");
    const response = await fetch(`${origin}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status !== expectedStatus)
      throw new Error(`CONTROL_${path.toUpperCase()}_HTTP_${response.status}`);
    const value: unknown = await response.json();
    if (expectedStatus !== 200) return value;
    const scope = observed.parse(value);
    if (scope.candidateSha !== candidate || scope.runId !== `${runId}-${attempt}`)
      throw new Error("CONTROL_PROVENANCE_MISMATCH");
    if (mutating) await mutationCheckpoint(`control_${path}`, "observed-success");
    return value;
  }
  function requireCheck(name: string, value: boolean) {
    checks[name] = value;
    if (!value) throw new Error(`CHECK_${name.toUpperCase()}_FAILED`);
  }
  try {
    await privateFile(resolve(dir, "receipt.json"), receipt);
    // Never reuse existing resources, even those that happen to have a drill-looking name.
    for (const path of [
      `r2/buckets/${names.bucket}`,
      `workers/scripts/${names.worker}/settings`,
      `workflows/${names.workflow}`,
    ])
      if ((await api(path, "GET", undefined, true)) !== null)
        throw new Error("RESOURCE_ALREADY_EXISTS");
    const subdomain = z
      .object({ subdomain: z.string().regex(/^[a-z0-9-]+$/) })
      .parse(await api("workers/subdomain"));
    origin = `https://${names.worker}.${subdomain.subdomain}.workers.dev`;
    await privateFile(recoveryFile, secrets);
    await privateFile(secretFile, secrets);
    const created = z
      .object({ name: z.literal(names.bucket) })
      .parse(await api("r2/buckets", "POST", { name: names.bucket }));
    bucketCreated = created.name === names.bucket;
    await deploy("baseline");
    workerCreated = true;
    workflowCreated = true;
    await waitForPhase("baseline");
    const settings = z
      .object({ bindings: z.array(z.record(z.string(), z.unknown())) })
      .parse(await api(`workers/scripts/${names.worker}/settings`));
    requireCheck(
      "isolated_bindings",
      settings.bindings.every((b) =>
        ["plain_text", "secret_text", "r2_bucket", "workflow"].includes(String(b.type)),
      ) &&
        settings.bindings.some(
          (b) => b.name === "DRILL_BUCKET" && b.bucket_name === names.bucket,
        ) &&
        settings.bindings.some(
          (b) => b.name === "ANALYSIS_WORKFLOW" && b.workflow_name === names.workflow,
        ),
    );
    const baselineVersion = await activeVersion();
    receipt.baselineVersion = baselineVersion;
    await control("seed");
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const state = z
        .object({
          completed: z.string(),
          active: z.string(),
          recovered: z.boolean(),
          rejectedBindings: z.number(),
          targetPresent: z.boolean(),
        })
        .parse(await control("inspect"));
      if (state.completed === "complete" && ["waiting", "running"].includes(state.active)) {
        ready = state.recovered && state.rejectedBindings === 3 && state.targetPresent;
        break;
      }
      await Bun.sleep(2000);
    }
    requireCheck("platform_instances_and_encrypted_r2", ready);
    await privateFile(secretFile, {
      ...secrets,
      CASE_DATA_KEY_V1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
      ),
    });
    await deploy("key-lost");
    await waitForPhase("key-lost");
    requireCheck(
      "wrong_key_rejected",
      z
        .object({ error: z.literal("CRYPTO_DECRYPT_FAILED") })
        .safeParse(await control("recover", 502)).success,
    );
    const saved: unknown = await Bun.file(recoveryFile).json();
    await privateFile(secretFile, saved);
    await deploy("key-restored");
    await waitForPhase("key-restored");
    requireCheck(
      "external_key_copy_recovered",
      z
        .object({
          recovered: z.literal(true),
          rejectedBindings: z.literal(3),
          phase: z.literal("key-restored"),
        })
        .safeParse(await control("recover")).success,
    );
    await wrangler([
      "rollback",
      baselineVersion,
      "--config",
      configPath,
      "--name",
      names.worker,
      "--message",
      "isolated-synthetic-configuration-rollback",
      "--yes",
    ]);
    await waitForPhase("baseline");
    requireCheck(
      "configuration_rollback",
      (await activeVersion()) === baselineVersion &&
        z
          .object({ recovered: z.literal(true), phase: z.literal("baseline") })
          .safeParse(await control("recover")).success,
    );
    requireCheck(
      "remote_deletion",
      z
        .object({
          completedAbsent: z.literal(true),
          activeAbsent: z.literal(true),
          targetAbsent: z.literal(true),
          recovered: z.literal(true),
          rejectedBindings: z.literal(3),
        })
        .safeParse(await control("delete")).success,
    );
    requireCheck(
      "late_instance_cleanup",
      z.object({ lateAbsent: z.literal(true) }).safeParse(await control("late")).success,
    );
  } catch (error) {
    failed = true;
    receipt.failure =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "DRILL_FAILED";
  } finally {
    cleaning = true;
    // Only resources whose creation returned success are eligible for automatic destruction.
    // Unknown mutation outcomes are reported for operator reconciliation, never blindly retried.
    if (workerCreated) {
      try {
        cleanup.objectsAndInstances = z
          .object({ remainingObjects: z.literal(0) })
          .safeParse(await control("cleanup")).success;
      } catch {
        cleanup.objectsAndInstances = false;
      }
    }
    for (const [kind, path, owned] of [
      ["workflow", `workflows/${names.workflow}`, workflowCreated],
      ["worker", `workers/scripts/${names.worker}`, workerCreated],
      ["bucket", `r2/buckets/${names.bucket}`, bucketCreated],
    ] as const) {
      if (!owned) continue;
      try {
        await api(path, "DELETE");
        const readPath = kind === "worker" ? `${path}/settings` : path;
        cleanup[kind] = (await api(readPath, "GET", undefined, true)) === null;
      } catch {
        cleanup[kind] = false;
      }
    }
    receipt.completedAt = new Date().toISOString();
    receipt.passed =
      !failed && Object.values(cleanup).every(Boolean) && Object.keys(cleanup).length === 4;
    await privateFile(resolve(dir, "receipt.json"), receipt);
    await rm(secretFile, { force: true });
    await rm(recoveryFile, { force: true });
    console.log(
      JSON.stringify({ passed: receipt.passed, checks, cleanup, failure: receipt.failure ?? null }),
    );
    if (!receipt.passed) process.exitCode = 1;
  }
}

if (import.meta.main) await run();
