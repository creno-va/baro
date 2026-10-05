import { resolve } from "node:path";
import {
  assertGitCandidate,
  controlSchema,
  PROBE_PROTOCOL_VERSION,
  ProbeControlError,
  type ProbeReply,
  verifyProbeExchange,
} from "./ai-readiness-control";

async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exit !== 0) throw new Error("Local source verification unavailable");
  return stdout;
}
let stage = "source-verification";
try {
  const candidate = process.env.READINESS_CANDIDATE_SHA ?? "";
  assertGitCandidate(
    candidate,
    await git(["rev-parse", "HEAD"]),
    await git(["status", "--porcelain", "--untracked-files=normal"]),
  );
  // Bind the probe entry/control/config and its complete application import closure
  // to the exact clean commit, rather than labelling a dirty probe as another SHA.
  const sourcePaths = (
    await git([
      "ls-files",
      "scripts/ai-readiness-worker.ts",
      "scripts/ai-readiness-control.ts",
      "scripts/ai-readiness.wrangler.jsonc",
      "src/server/modules/llm-gateway",
      "src/contracts",
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  for (const required of [
    "scripts/ai-readiness-worker.ts",
    "scripts/ai-readiness-control.ts",
    "scripts/ai-readiness.wrangler.jsonc",
    "src/server/modules/llm-gateway/service.ts",
  ]) {
    if (!sourcePaths.includes(required)) throw new Error("Tracked probe source unavailable");
  }
  const sourceManifest = await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(path).arrayBuffer())
        .digest("hex"),
    })),
  );
  const probeHash = new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        candidateSha: candidate,
        protocolVersion: PROBE_PROTOCOL_VERSION,
        sourceManifest,
      }),
    )
    .digest("hex");
  const provenance = { candidateSha: candidate, probeSourceSha256: probeHash };
  const config = ".wrangler/goal/ai-readiness.config.json";
  const definition = await Bun.file("scripts/ai-readiness.wrangler.jsonc").json();
  definition.main = resolve("scripts/ai-readiness-worker.ts");
  definition.$schema = resolve("node_modules/wrangler/config-schema.json");
  definition.vars.READINESS_CANDIDATE_SHA = candidate;
  definition.vars.READINESS_PROBE_SHA256 = probeHash;
  definition.durable_objects.code_update_strategy = { mode: "immediate" };
  await Bun.write(config, `${JSON.stringify(definition, null, 2)}\n`);
  async function wrangler(args: string[], input?: string) {
    const child = Bun.spawn(
      ["bun", "node_modules/wrangler/bin/wrangler.js", ...args, "--config", config],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CI: "true" },
      },
    );
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
  stage = "deploy";
  const deployment = await wrangler(["deploy", "--durable-objects-code-update-mode", "immediate"]);
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
  const unauthenticated = await fetch(`${origin}/probe`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (unauthenticated.status !== 403) throw new Error("Probe authentication failed");
  const send = async (method: "GET" | "POST"): Promise<ProbeReply> => {
    const response = await fetch(`${origin}/probe`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(method === "POST" ? 190_000 : 10_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  stage = "active-provenance-check";
  let previous: ProbeReply | undefined;
  // Poll only a read: secret/DO propagation can lag deployment. Never retry a POST.
  for (const delay of [0, 1000, 2000, 4000, 8000, 16000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    previous = await send("GET");
    if (previous.status === 403) continue;
    const state = controlSchema.safeParse(previous.body);
    if (
      previous.status === 200 &&
      state.success &&
      (state.data.activeCandidateSha !== candidate ||
        state.data.activeProbeSourceSha256 !== probeHash)
    )
      continue;
    // A legacy response, non-200, persisted report or started state is not
    // permission to run again. The exchange validator decides fail-closed.
    break;
  }
  if (!previous) throw new ProbeControlError("STATUS_UNAVAILABLE");
  const report = await verifyProbeExchange(previous, provenance, send, (next) => {
    stage = next;
  });
  await Bun.write(
    ".wrangler/readiness/ai.json",
    `${JSON.stringify({ ...report, authenticationChecked: true, replayRejected: true, sourceManifest }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      check: "live-synthetic-worker-screening",
      status: report.status,
      failure: report.failure,
      attempts: report.attempts,
      candidateMatches: true,
      probeHashMatches: true,
      replayRejected: true,
    }),
  );
  if (report.status !== "passed") process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      check: "isolated-ai-readiness",
      status: "failed",
      stage,
      ...(error instanceof ProbeControlError ? { reason: error.code } : {}),
    }),
  );
  process.exitCode = 1;
}
