import { expect, test } from "bun:test";
import {
  assertGitCandidate,
  authorizedProbeRequest,
  decideProbeAction,
  handleDurableProbe,
  PROBE_PROTOCOL_VERSION,
  PROBE_REQUEST_ID,
  type ProbeConfiguration,
  ProbeControlError,
  type ProbeOutcome,
  type ProbeProvenance,
  type ProbeReply,
  type ProbeStorage,
  type ProbeTransaction,
  probePostTimeoutMs,
  probeReportFor,
  verifyProbeExchange,
} from "./ai-readiness-control";

const provenance: ProbeProvenance = {
  featureCase: "workspace_questions",
  candidateSha: "a".repeat(40),
  probeSourceSha256: "b".repeat(64),
};
const configuration: ProbeConfiguration = {
  READINESS_CANDIDATE_SHA: provenance.candidateSha,
  READINESS_PROBE_SHA256: provenance.probeSourceSha256,
  READINESS_TOKEN: "synthetic-local-token",
};
test("probe observation waits for existing workspace phase limits within its ten-minute job", () => {
  expect(probePostTimeoutMs("tools_property")).toBe(370_000);
  expect(probePostTimeoutMs("legal_chat")).toBe(490_000);
  expect(probePostTimeoutMs("media")).toBe(190_000);
  expect(probePostTimeoutMs("video_media")).toBe(190_000);
  expect(probePostTimeoutMs("legal_chat")).toBeLessThan(600_000);
});

test("authenticated forwarding binds the selected feature and rejects a cross-feature report", async () => {
  const h = harness();
  const result = await h.send("POST");
  const other = { ...provenance, featureCase: "workspace_summary" as const };
  expect(probeReportFor(other).safeParse(result.body).success).toBe(false);
  const env = { ...configuration, READINESS_FEATURE_CASE: "workspace_summary" };
  const forwarded = request("POST", env);
  expect(forwarded.headers.get("x-baro-probe-feature")).toBe("workspace_summary");
  const state = await h.send("GET");
  expect(decideProbeAction(state.body, other)).toEqual({
    action: "blocked",
    reason: "ACTIVE_PROVENANCE_MISMATCH",
  });
  expect(
    (await reply(await handleDurableProbe(forwarded, configuration, h.storage, h.execute))).status,
  ).toBe(409);
  expect(h.counters.model).toBe(1);
});

test("media reports require both semantic marker checks and model/phase agreement without observed text", async () => {
  const h = harness();
  const original = (await h.send("POST")).body as Record<string, unknown>;
  const scope = { ...provenance, featureCase: "media" as const };
  const metric = {
    requestId: PROBE_REQUEST_ID,
    latencyMs: 1,
    inputTokens: null,
    outputTokens: null,
    status: "success",
  };
  const value = {
    ...original,
    ...scope,
    attempts: 2,
    metrics: [
      { ...metric, phase: "vision", model: "google/gemini-3.8-flash" },
      { ...metric, phase: "asr", model: "@cf/openai/whisper-large-v3-turbo" },
    ],
    mediaChecks: [
      { phase: "vision", quality: "processed", markerMatched: true, segmentCount: null },
      { phase: "asr", quality: "low_quality", markerMatched: true, segmentCount: 0 },
    ],
  };
  const schema = probeReportFor(scope);
  expect(schema.safeParse(value).success).toBe(true);
  expect(schema.safeParse({ ...value, mediaChecks: [] }).success).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      mediaChecks: value.mediaChecks.map((c) => ({ ...c, markerMatched: false })),
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      metrics: value.metrics.map((m) => ({ ...m, model: "google/gemini-3.8-flash" })),
    }).success,
  ).toBe(false);
  expect(schema.safeParse({ ...value, observedText: "private sentinel" }).success).toBe(false);
});
test("legal success requires real source requests, accepted quotation and independent audit evidence", async () => {
  const original = (await harness().send("POST")).body as Record<string, unknown>;
  const scope = { ...provenance, featureCase: "legal_chat" as const };
  const metric = {
    requestId: PROBE_REQUEST_ID,
    model: "google/gemini-3.8-flash",
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    status: "success",
  };
  const value = {
    ...original,
    ...scope,
    attempts: 3,
    metrics: ["workspace_chat", "workspace_chat", "workspace_audit"].map((phase) => ({
      ...metric,
      phase,
    })),
    legalChecks: {
      requests: 2,
      verifiedSourceCount: 1,
      acceptedQuotationCount: 1,
      sourceFailures: [],
    },
  };
  const schema = probeReportFor(scope);
  expect(schema.safeParse(value).success).toBe(true);
  expect(schema.safeParse({ ...value, legalChecks: undefined }).success).toBe(false);
  for (const key of ["requests", "verifiedSourceCount", "acceptedQuotationCount"])
    expect(
      schema.safeParse({ ...value, legalChecks: { ...value.legalChecks, [key]: 0 } }).success,
    ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      legalChecks: { ...value.legalChecks, sourceFailures: ["unavailable"] },
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      metrics: value.metrics.map((m) => ({ ...m, phase: "workspace_chat" })),
    }).success,
  ).toBe(false);
  expect(
    probeReportFor(provenance).safeParse({ ...original, legalChecks: value.legalChecks }).success,
  ).toBe(false);
  expect(schema.safeParse({ ...value, legalText: "private sentinel" }).success).toBe(false);
});
test("video success binds both scene positions and three successful model observations", async () => {
  const original = (await harness().send("POST")).body as Record<string, unknown>;
  const scope = { ...provenance, featureCase: "video_media" as const };
  const value = {
    ...original,
    ...scope,
    attempts: 3,
    metrics: ["vision", "vision", "asr"].map((phase) => ({
      requestId: PROBE_REQUEST_ID,
      phase,
      model: phase === "asr" ? "@cf/openai/whisper-large-v3-turbo" : "google/gemini-3.8-flash",
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      status: "success",
    })),
    mediaChecks: [
      {
        phase: "vision",
        quality: "processed",
        markerMatched: true,
        segmentCount: null,
        videoFrame: { timestampSeconds: 1.4, frameIndex: 14 },
      },
      {
        phase: "vision",
        quality: "processed",
        markerMatched: true,
        segmentCount: null,
        videoFrame: { timestampSeconds: 3.2, frameIndex: 32 },
      },
      { phase: "asr", quality: "processed", markerMatched: true, segmentCount: 1 },
    ],
  };
  const schema = probeReportFor(scope);
  expect(schema.safeParse(value).success).toBe(true);
  expect(
    schema.safeParse({ ...value, mediaChecks: [...value.mediaChecks].reverse() }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...value,
      mediaChecks: value.mediaChecks.map((c) => ({ ...c, markerMatched: false })),
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...value, metrics: value.metrics.map((m) => ({ ...m, status: "failed" })) })
      .success,
  ).toBe(false);
  expect(schema.safeParse({ ...value, attempts: 2 }).success).toBe(false);
  expect(schema.safeParse({ ...value, framePixels: "private sentinel" }).success).toBe(false);
});
class MemoryStorage implements ProbeStorage {
  values = new Map<string, unknown>();
  private queue: Promise<void> = Promise.resolve();
  constructor(initial: Record<string, unknown> = {}) {
    this.values = new Map(Object.entries(structuredClone(initial)));
  }
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async transaction<T>(callback: (txn: ProbeTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const draft = structuredClone(this.values);
    try {
      const result = await callback({
        get: async <V = unknown>(key: string) => structuredClone(draft.get(key)) as V | undefined,
        put: async (key, value) => {
          draft.set(key, structuredClone(value));
        },
      });
      this.values = draft;
      return result;
    } finally {
      release();
    }
  }
}
function request(method: "GET" | "POST", env = configuration) {
  const forwarded = authorizedProbeRequest(
    new Request("https://synthetic.invalid/probe", {
      method,
      headers: { authorization: `Bearer ${env.READINESS_TOKEN}` },
    }),
    env,
  );
  if (!forwarded) throw new Error("Synthetic setup rejected");
  return forwarded;
}
async function reply(response: Response): Promise<ProbeReply> {
  return { status: response.status, body: await response.json() };
}
function harness(initial: Record<string, unknown> = {}, env = configuration) {
  const storage = new MemoryStorage(initial);
  const counters = { model: 0, post: 0 };
  const execute = async (reserve: () => Promise<boolean>): Promise<ProbeOutcome> => {
    if (!(await reserve())) throw new Error("Synthetic reserve rejected");
    counters.model++;
    return {
      status: "passed",
      failure: null,
      metrics: [
        {
          requestId: PROBE_REQUEST_ID,
          phase: "screening",
          model: "google/gemini-3.8-flash",
          latencyMs: 1,
          inputTokens: 2,
          outputTokens: 3,
          status: "success",
        },
      ],
    };
  };
  const send = async (method: "GET" | "POST"): Promise<ProbeReply> => {
    if (method === "POST") counters.post++;
    return reply(await handleDurableProbe(request(method, env), env, storage, execute));
  };
  return { storage, counters, execute, send };
}
async function rejection(
  initial: ProbeReply,
  send: (method: "GET" | "POST") => Promise<ProbeReply>,
  reason: ProbeControlError["code"],
) {
  let observed: unknown;
  try {
    await verifyProbeExchange(initial, provenance, send);
  } catch (error) {
    observed = error;
  }
  expect(observed).toBeInstanceOf(ProbeControlError);
  expect((observed as ProbeControlError).code).toBe(reason);
}
test("candidate provenance rejects another HEAD and dirty/untracked source before operations", () => {
  expect(() => assertGitCandidate("invalid", provenance.candidateSha, "")).toThrow(
    "INVALID_CANDIDATE",
  );
  expect(() => assertGitCandidate(provenance.candidateSha, "c".repeat(40), "")).toThrow(
    "CANDIDATE_HEAD_MISMATCH",
  );
  expect(() =>
    assertGitCandidate(provenance.candidateSha, provenance.candidateSha, " M scripts/probe.ts"),
  ).toThrow("SOURCE_TREE_DIRTY");
  expect(() =>
    assertGitCandidate(provenance.candidateSha, provenance.candidateSha, "?? scripts/untracked.ts"),
  ).toThrow("SOURCE_TREE_DIRTY");
  expect(() =>
    assertGitCandidate(provenance.candidateSha, `${provenance.candidateSha}\n`, ""),
  ).not.toThrow();
});
test("Worker authentication and required deployment hashes fail closed", () => {
  for (const env of [
    { ...configuration, READINESS_TOKEN: undefined },
    { ...configuration, READINESS_CANDIDATE_SHA: "unset" },
    { ...configuration, READINESS_PROBE_SHA256: undefined },
  ]) {
    expect(
      authorizedProbeRequest(
        new Request("https://synthetic.invalid/probe", {
          method: "POST",
          headers: { authorization: "Bearer synthetic-local-token" },
        }),
        env,
      ),
    ).toBeNull();
  }
  expect(
    authorizedProbeRequest(
      new Request("https://synthetic.invalid/probe", { method: "POST" }),
      configuration,
    ),
  ).toBeNull();
});
test("authenticated caller cannot spoof forwarded candidate/hash/protocol", () => {
  const forwarded = authorizedProbeRequest(
    new Request("https://synthetic.invalid/probe", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-local-token",
        "x-baro-probe-candidate": "c".repeat(40),
        "x-baro-probe-source": "d".repeat(64),
        "x-baro-probe-protocol": "1",
      },
    }),
    configuration,
  );
  expect(forwarded?.headers.get("x-baro-probe-candidate")).toBe(provenance.candidateSha);
  expect(forwarded?.headers.get("x-baro-probe-source")).toBe(provenance.probeSourceSha256);
  expect(forwarded?.headers.get("x-baro-probe-protocol")).toBe(String(PROBE_PROTOCOL_VERSION));
});
test("DO refuses mismatched candidate/hash/protocol and missing config before acquire or spend", async () => {
  for (const [header, value] of [
    ["x-baro-probe-candidate", "c".repeat(40)],
    ["x-baro-probe-source", "d".repeat(64)],
    ["x-baro-probe-protocol", "1"],
  ] as const) {
    const h = harness();
    const incoming = request("POST");
    incoming.headers.set(header, value);
    const response = await handleDurableProbe(incoming, configuration, h.storage, h.execute);
    expect(response.status).toBe(409);
    expect(h.counters.model).toBe(0);
    expect(await h.storage.get("started")).toBeUndefined();
    expect(await h.storage.get("calls")).toBeUndefined();
  }
  const h = harness();
  const response = await handleDurableProbe(
    request("POST"),
    { ...configuration, READINESS_PROBE_SHA256: undefined },
    h.storage,
    h.execute,
  );
  expect(response.status).toBe(409);
  expect(h.counters.model).toBe(0);
});
test("HTTP200 with stale active deployment or old bare report never permits POST", async () => {
  const h = harness({}, { ...configuration, READINESS_CANDIDATE_SHA: "c".repeat(40) });
  await rejection(await h.send("GET"), h.send, "ACTIVE_PROVENANCE_MISMATCH");
  expect(h.counters.post).toBe(0);
  expect(h.counters.model).toBe(0);
  await rejection(
    { status: 200, body: { runtimeWorker: true, candidateSha: provenance.candidateSha } },
    h.send,
    "CONTROL_INVALID",
  );
  expect(h.counters.post).toBe(0);
});
test("completed stale/missing provenance remains unchanged across active configuration updates", async () => {
  for (const old of [
    { version: 1, candidateSha: "c".repeat(40), runtimeWorker: true },
    { version: 1, runtimeWorker: true },
  ]) {
    const h = harness({ started: true, calls: 1, report: old });
    const control = await h.send("GET");
    await rejection(control, h.send, "STORED_REPORT_INVALID");
    expect((control.body as { storedReport: unknown }).storedReport).toEqual(old);
    expect(await h.storage.get<typeof old>("report")).toEqual(old);
    expect(h.counters.post).toBe(0);
    expect(h.counters.model).toBe(0);
  }
});
test("started or ambiguous prior outcome cannot automatically consume another attempt", async () => {
  for (const initial of [
    { started: true, calls: 1 },
    {
      started: true,
      calls: 0,
      terminalFailure: { stage: "acquire", category: "probe-runtime-error" },
    },
    { started: false, calls: 1 },
  ]) {
    const h = harness(initial);
    await rejection(await h.send("GET"), h.send, "PREVIOUS_OUTCOME_INCOMPLETE");
    expect(h.counters.post).toBe(0);
    expect(h.counters.model).toBe(0);
    expect((await h.send("POST")).status).toBe(409);
    expect(h.counters.model).toBe(0);
  }
});
test("fresh valid probe runs once; replay and report reuse never run model again", async () => {
  const h = harness();
  const report = await verifyProbeExchange(await h.send("GET"), provenance, h.send);
  expect(report.status).toBe("passed");
  expect(report.version).toBe(PROBE_PROTOCOL_VERSION);
  expect(report.attempts).toBe(1);
  expect(h.counters.model).toBe(1);
  expect(h.counters.post).toBe(2);
  expect(await h.storage.get<ProbeProvenance>("provenance")).toEqual(provenance);
  const reused = await verifyProbeExchange(await h.send("GET"), provenance, h.send);
  expect(reused).toEqual(report);
  expect(h.counters.model).toBe(1);
  expect(h.counters.post).toBe(3);
});
test("concurrent acquisitions cannot create two paid probe operations", async () => {
  const h = harness();
  const responses = await Promise.all([h.send("POST"), h.send("POST")]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(h.counters.model).toBe(1);
  expect(await h.storage.get<number>("calls")).toBe(1);
});
test("durable reservation caps provider attempts and replay cannot reset budget", async () => {
  const h = harness();
  const execute = async (reserve: () => Promise<boolean>): Promise<ProbeOutcome> => {
    const metrics: ProbeOutcome["metrics"] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!(await reserve())) continue;
      h.counters.model++;
      metrics.push({
        requestId: PROBE_REQUEST_ID,
        phase: "screening",
        model: "google/gemini-3.8-flash",
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
        status: "failed",
      });
    }
    return { status: "failed", failure: "MODEL_UNAVAILABLE", metrics };
  };
  expect(
    (await handleDurableProbe(request("POST"), configuration, h.storage, execute)).status,
  ).toBe(502);
  expect(await h.storage.get<number>("calls")).toBe(3);
  expect(h.counters.model).toBe(3);
  expect((await h.send("POST")).status).toBe(409);
  expect(h.counters.model).toBe(3);
});
test("runtime exception persists finite stage/category without message or credentials", async () => {
  const h = harness();
  const response = await handleDurableProbe(
    request("POST"),
    configuration,
    h.storage,
    async (reserve) => {
      await reserve();
      throw new TypeError("private-value SQL https://private.invalid upstream body");
    },
  );
  const body = await response.json();
  expect(body).toEqual({
    status: "probe-runtime-failed",
    failure: { stage: "model", category: "type-error" },
  });
  expect(JSON.stringify(body)).not.toContain("private-value");
  expect(await h.storage.get<{ stage: string; category: string }>("terminalFailure")).toEqual({
    stage: "model",
    category: "type-error",
  });
  expect(await h.storage.get("report")).toBeUndefined();
  await rejection(await h.send("GET"), h.send, "PREVIOUS_OUTCOME_INCOMPLETE");
  expect(h.counters.post).toBe(0);
  expect(await h.storage.get<number>("calls")).toBe(1);
});
test("ambiguous POST transport failure causes no automatic model reissue", async () => {
  const h = harness();
  const initial = await h.send("GET");
  let requests = 0;
  await expect(
    verifyProbeExchange(initial, provenance, async () => {
      requests++;
      throw new TypeError("synthetic transport outcome unknown");
    }),
  ).rejects.toThrow();
  expect(requests).toBe(1);
});
test("409 from provenance mismatch is not accepted as replay guard evidence", async () => {
  const h = harness();
  await h.send("POST");
  await rejection(
    await h.send("GET"),
    async () => ({
      status: 409,
      body: { status: "probe-configuration-mismatch" },
    }),
    "REPLAY_NOT_REJECTED",
  );
  expect(h.counters.model).toBe(1);
});
test("stored outcome/call-counter inconsistency blocks report reuse", async () => {
  const h = harness();
  await h.send("POST");
  await h.storage.put("calls", 2);
  expect(decideProbeAction((await h.send("GET")).body, provenance)).toEqual({
    action: "blocked",
    reason: "STATE_INCONSISTENT",
  });
  expect(h.counters.model).toBe(1);
});

test("schema/refusal outcomes retain reserved cost with explicitly partial observation coverage", async () => {
  for (const failure of ["MODEL_SCHEMA_INVALID", "POLICY_REJECTED"] as const) {
    const h = harness();
    const response = await handleDurableProbe(
      request("POST"),
      configuration,
      h.storage,
      async (reserve) => {
        expect(await reserve()).toBe(true);
        return { status: "failed", failure, metrics: [] };
      },
    );
    expect(response.status).toBe(502);
    const report = probeReportFor(provenance).parse(await response.json());
    expect(report).toMatchObject({
      status: "failed",
      failure,
      attempts: 1,
      metrics: [],
      metricCoverage: "partial",
    });
    expect(await h.storage.get("terminalFailure")).toBeUndefined();
    const decision = decideProbeAction((await h.send("GET")).body, provenance);
    expect(decision.action).toBe("reuse");
    expect((await h.send("POST")).status).toBe(409);
    expect(await h.storage.get<number>("calls")).toBe(1);
    expect(h.counters.model).toBe(0);
  }
});

test("successful schema correction preserves both reservations and only observed final metric", async () => {
  const h = harness();
  const response = await handleDurableProbe(
    request("POST"),
    configuration,
    h.storage,
    async (reserve) => {
      expect(await reserve()).toBe(true);
      return h.execute(reserve);
    },
  );
  expect(response.status).toBe(200);
  const report = probeReportFor(provenance).parse(await response.json());
  expect(report).toMatchObject({
    status: "passed",
    failure: null,
    attempts: 2,
    metricCoverage: "partial",
  });
  expect(report.metrics).toHaveLength(1);
  expect(report.metrics[0]?.status).toBe("success");
  const verified = await verifyProbeExchange(await h.send("GET"), provenance, h.send);
  expect(verified).toEqual(report);
  expect(await h.storage.get<number>("calls")).toBe(2);
  expect(h.counters.model).toBe(1);
});
