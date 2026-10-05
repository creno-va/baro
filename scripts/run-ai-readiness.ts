import { resolve } from "node:path";
import { z } from "zod";

const candidate = process.env.READINESS_CANDIDATE_SHA ?? "";
if (!/^[a-f0-9]{40}$/.test(candidate)) throw new Error("Full candidate SHA required");
const config = ".wrangler/goal/ai-readiness.config.json";
const definition = await Bun.file("scripts/ai-readiness.wrangler.jsonc").json();
definition.main = resolve("scripts/ai-readiness-worker.ts");
definition.$schema = resolve("node_modules/wrangler/config-schema.json");
definition.vars.READINESS_CANDIDATE_SHA = candidate;
await Bun.write(config, `${JSON.stringify(definition, null, 2)}\n`);
async function wrangler(args: string[], input?: string) {
  const child = Bun.spawn(["bunx", "wrangler", ...args, "--config", config], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "true" },
  });
  if (input) child.stdin.write(`${input}\n`);
  await child.stdin.end();
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) {
    const codes = [...`${stdout}\n${stderr}`.matchAll(/\[code:\s*(\d+)\]/g)].map((m) => m[1]);
    console.error(
      JSON.stringify({ operation: args[0], platformExitCode: exit, errorCodes: codes }),
    );
    throw new Error("Isolated probe platform operation failed");
  }
  return stdout;
}
let stage = "deploy";
try {
  const deployment = await wrangler(["deploy", "--var", `READINESS_CANDIDATE_SHA:${candidate}`]);
  const origin = deployment.match(
    /https:\/\/baro-synthetic-ai-readiness\.[a-z0-9-]+\.workers\.dev/,
  )?.[0];
  if (!origin) throw new Error("Isolated probe origin unavailable");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  stage = "token-registration";
  await wrangler(["secret", "put", "READINESS_TOKEN"], token);
  stage = "authentication-check";
  const unauthenticated = await fetch(`${origin}/probe`, { method: "POST" });
  if (unauthenticated.status !== 403) throw new Error("Probe authentication failed");
  stage = "model-and-schema-check";
  let previous: Response | undefined;
  // Secret deployments can propagate after the CLI returns. GET never spends model quota.
  for (const delay of [0, 1000, 2000, 4000, 8000, 16000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    previous = await fetch(`${origin}/probe`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (previous.status !== 403) break;
  }
  if (!previous) throw new Error("Probe status unavailable");
  const previousBody = z
    .record(z.string(), z.unknown())
    .nullable()
    .parse(await previous.json().catch(() => null));
  if (previous.status === 403) {
    console.error(
      JSON.stringify({
        check: "probe-authentication",
        probeVersion: previousBody?.probeVersion === 1 ? 1 : null,
        configurationReady: previousBody?.configurationReady === true,
      }),
    );
    throw new Error("Authenticated probe rejected");
  }
  if (previous.status !== 200) {
    console.error(
      JSON.stringify({
        check: "probe-durable-state",
        httpStatus: previous.status,
        transportStage: ["binding", "dispatch"].includes(String(previousBody?.transportStage))
          ? previousBody?.transportStage
          : null,
      }),
    );
    throw new Error("Durable probe state unavailable");
  }
  if (previousBody?.status === "no-completed-report" && previousBody.started) {
    console.error(
      JSON.stringify({
        check: "probe-state",
        started: true,
        attempts: typeof previousBody.attempts === "number" ? previousBody.attempts : null,
        completedReport: false,
      }),
    );
    throw new Error("Previous probe outcome is incomplete");
  }
  const response =
    previousBody?.runtimeWorker === true
      ? previous
      : await fetch(`${origin}/probe`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(190_000),
        });
  const responseBody: Record<string, unknown> | null =
    previousBody?.runtimeWorker === true
      ? previousBody
      : z
          .record(z.string(), z.unknown())
          .nullable()
          .parse(await response.json().catch(() => null));
  console.log(
    JSON.stringify({
      check: "probe-response",
      httpStatus: response.status,
      reportPresent: responseBody?.runtimeWorker === true,
      transportFailed: responseBody?.status === "probe-transport-failed",
    }),
  );
  const report = z
    .object({
      version: z.literal(1),
      candidateSha: z.literal(candidate),
      environment: z.literal("isolated-synthetic-worker"),
      checkedAt: z.string(),
      status: z.enum(["passed", "failed"]),
      failure: z.enum(["MODEL_UNAVAILABLE", "MODEL_SCHEMA_INVALID", "POLICY_REJECTED"]).nullable(),
      runtimeWorker: z.literal(true),
      attempts: z.number().int().min(1).max(3),
      metrics: z.array(
        z.strictObject({
          requestId: z.literal("00000000-0000-4000-8000-000000000027"),
          phase: z.literal("screening"),
          model: z.literal("openai/gpt-6-sol"),
          latencyMs: z.number(),
          inputTokens: z.number().nullable(),
          outputTokens: z.number().nullable(),
          status: z.enum(["success", "failed"]),
        }),
      ),
      unverified: z.array(z.string()),
    })
    .strict()
    .parse(responseBody);
  stage = "durable-replay-check";
  const replay = await fetch(`${origin}/probe`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (replay.status !== 409) throw new Error("Probe durable replay guard failed");
  await Bun.write(
    ".wrangler/readiness/ai.json",
    `${JSON.stringify({ ...report, authenticationChecked: true, replayRejected: true }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      check: "live-synthetic-worker-screening",
      status: report.status,
      failure: report.failure,
      attempts: report.attempts,
      replayRejected: true,
    }),
  );
  if (report.status !== "passed") process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ check: "isolated-ai-readiness", status: "failed", stage }));
  process.exitCode = 1;
}
