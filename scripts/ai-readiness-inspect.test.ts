import { expect, test } from "bun:test";
import { inspectSyntheticProbe } from "./ai-readiness-inspect";

const input = {
  accountId: "a".repeat(32),
  token: "admin-local-sentinel",
  candidateSha: "b".repeat(40),
  featureCase: "video_media",
};
const credential = "c".repeat(64);
const state = {
  protocolVersion: 3,
  activeCandidateSha: input.candidateSha,
  activeFeatureCase: input.featureCase,
  activeProbeSourceSha256: "d".repeat(64),
  configurationReady: true,
  started: true,
  attempts: 1,
  storedReport: null,
  terminalFailure: { stage: "write-report", category: "probe-runtime-error" } as const,
};
function harness(
  options: {
    control?: unknown;
    denied?: number;
    status?: number;
    cleanupFails?: boolean;
    rotationFails?: boolean;
    raw?: string;
  } = {},
) {
  const calls: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
  const delays: number[] = [];
  let reads = 0;
  const network = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: init?.body,
    });
    if (url.endsWith("/subdomain"))
      return Response.json({ success: true, result: { subdomain: "synthetic-local" } });
    if (method === "PUT") {
      if (options.rotationFails) throw new Error("private upstream sentinel");
      return Response.json({ success: true });
    }
    if (method === "DELETE")
      return options.cleanupFails
        ? Response.json({ success: false, error: "private upstream sentinel" }, { status: 500 })
        : new Response(null, { status: 204 });
    reads++;
    if (reads <= (options.denied ?? 0)) return new Response(null, { status: 403 });
    return options.raw === undefined
      ? Response.json(options.control ?? state, { status: options.status ?? 200 })
      : new Response(options.raw, { status: options.status ?? 200 });
  }) as typeof fetch;
  const run = (value = input) =>
    inspectSyntheticProbe(value, {
      fetch: network,
      pause: async (ms) => {
        delays.push(ms);
      },
      newToken: () => credential,
      clock: () => "2026-10-24T16:00:00.000Z",
    });
  return { run, calls, delays };
}

test("inspection reads retained permits and terminal failure with no model POST or state reset", async () => {
  const h = harness();
  const before = JSON.stringify(state);
  const result = await h.run();
  expect(result.status).toBe("observed");
  expect(result.modelPostAttempts).toBe(0);
  expect(result.credentialCleanup).toBe(true);
  expect(result.snapshot).toEqual({
    started: true,
    reservedAttempts: 1,
    reportPresent: false,
    reportValid: null,
    activeProbeSourceSha256: state.activeProbeSourceSha256,
    terminalFailure: state.terminalFailure,
    report: null,
  });
  expect(JSON.stringify(state)).toBe(before);
  expect(h.calls.map((call) => call.method)).toEqual(["GET", "PUT", "GET", "DELETE"]);
  for (const call of h.calls) {
    const url = new URL(call.url);
    expect(call.authorization).toBe(
      `Bearer ${url.hostname === "api.cloudflare.com" ? input.token : credential}`,
    );
    expect(call.url).not.toContain("/run");
    if (call.method === "PUT") {
      expect(url.pathname.endsWith("/scripts/baro-synthetic-ai-readiness/secrets")).toBe(true);
      expect(JSON.parse(String(call.body))).toEqual({
        name: "READINESS_TOKEN",
        type: "secret_text",
        text: credential,
      });
    }
    if (call.method === "DELETE")
      expect(url.pathname.endsWith("/secrets/READINESS_TOKEN")).toBe(true);
    if (url.hostname !== "api.cloudflare.com") expect(url.pathname).toBe("/probe");
  }
  expect(JSON.stringify(result)).not.toContain(input.token);
  expect(JSON.stringify(result)).not.toContain(credential);
});

test("credential propagation only retries bounded GETs and cleans up after exhaustion", async () => {
  const h = harness({ denied: 2 });
  expect((await h.run()).status).toBe("observed");
  expect(h.delays).toEqual([1000, 2000]);
  const blocked = harness({ denied: 99 });
  const result = await blocked.run();
  expect(result.failure).toBe("STATUS_UNAVAILABLE");
  expect(result.credentialCleanup).toBe(true);
  expect(blocked.calls.filter((call) => call.url.endsWith("/probe"))).toHaveLength(6);
  expect(blocked.calls.every((call) => call.method !== "POST")).toBe(true);
});

test.each([
  { control: { ...state, activeCandidateSha: "e".repeat(40) }, failure: "PROVENANCE_MISMATCH" },
  { control: { ...state, activeFeatureCase: "media" }, failure: "PROVENANCE_MISMATCH" },
  { control: { ...state, activeProbeSourceSha256: null }, failure: "PROVENANCE_MISMATCH" },
  { control: { ...state, attempts: 4 }, failure: "CONTROL_INVALID" },
  { raw: "not-json private upstream sentinel", failure: "CONTROL_INVALID" },
  { raw: "x".repeat(262145), failure: "CONTROL_INVALID" },
  { status: 500, failure: "STATUS_UNAVAILABLE" },
])("failed status inspection remains finite and cleans credentials: $failure", async (options) => {
  const result = await harness(options).run();
  expect(result.failure).toBe(options.failure);
  expect(result.snapshot).toBeNull();
  expect(result.credentialCleanup).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private upstream sentinel");
});

test("unvalidated stored reports are not copied into an artifact", async () => {
  const result = await harness({
    control: { ...state, storedReport: { observedText: "private report sentinel" } },
  }).run();
  expect(result.snapshot?.reportPresent).toBe(true);
  expect(result.snapshot?.reportValid).toBe(false);
  expect(result.snapshot?.report).toBeNull();
  expect(JSON.stringify(result)).not.toContain("private report sentinel");
});

test("a strictly validated finite failed report is retained with its original provenance", async () => {
  const report = {
    version: 3,
    checkedAt: "2026-10-24T15:52:00.000Z",
    candidateSha: input.candidateSha,
    featureCase: input.featureCase,
    probeSourceSha256: state.activeProbeSourceSha256,
    environment: "isolated-synthetic-worker",
    status: "failed",
    failure: "MODEL_UNAVAILABLE",
    runtimeWorker: true,
    attempts: 1,
    metricCoverage: "partial",
    metrics: [],
    unverified: ["full-product-smoke", "live-corpus-eval", "oauth", "legal", "public-policy"],
  };
  const result = await harness({
    control: { ...state, terminalFailure: null, storedReport: report },
  }).run();
  expect(result.snapshot?.reportValid).toBe(true);
  expect(JSON.stringify(result.snapshot?.report)).toBe(JSON.stringify(report));
});

test("inspection workflow is manual, serialized with probes and never deploys or starts paid checks", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/ai-synthetic-inspection.yml").text(),
  ) as {
    on: Record<string, unknown>;
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: {
      inspect: {
        if: string;
        environment: { name: string; deployment: boolean };
        steps: {
          uses?: string;
          run?: string;
          if?: string;
          with?: { name?: string; path?: string; "if-no-files-found"?: string };
        }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.concurrency).toEqual({
    group: "baro-synthetic-ai-readiness",
    "cancel-in-progress": false,
  });
  expect(workflow.jobs.inspect.if).toBe("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.inspect.environment).toEqual({ name: "preview", deployment: false });
  const steps = workflow.jobs.inspect.steps;
  for (const step of steps) {
    if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
    if (step.run)
      expect(step.run).not.toMatch(
        /wrangler.*deploy|run-ai-readiness|ai-readiness-worker|provision-ai-budget/,
      );
  }
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(upload?.if).toBe("always()");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression is deliberately literal.
  expect(upload?.with?.name).toBe("retained-synthetic-probe-${{ github.run_id }}");
  expect(upload?.with?.["if-no-files-found"]).toBe("error");
});

test("cleanup failure preserves the observed status and an ambiguous secret PUT is still cleaned up", async () => {
  const result = await harness({ cleanupFails: true }).run();
  expect(result.failure).toBe("SECRET_CLEANUP_FAILED");
  expect(result.credentialCleanup).toBe(false);
  expect(result.snapshot?.reservedAttempts).toBe(1);
  const h = harness({ rotationFails: true });
  const ambiguous = await h.run();
  expect(ambiguous.failure).toBe("PLATFORM_UNAVAILABLE");
  expect(ambiguous.credentialCleanup).toBe(true);
  expect(h.calls.map((call) => call.method)).toEqual(["GET", "PUT", "DELETE"]);
  expect(JSON.stringify(ambiguous)).not.toContain("private upstream sentinel");
});

test.each([
  { ...input, accountId: "../other" },
  { ...input, candidateSha: "main" },
  { ...input, featureCase: "other" },
  { ...input, token: "" },
])("unvalidated inputs never reach the network", async (value) => {
  const h = harness();
  await expect(h.run(value)).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
