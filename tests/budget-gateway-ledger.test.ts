import { afterEach, expect, spyOn, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import type { PricingProof, RuntimeProofVerifier } from "../src/server/db/v2-paid-contracts";
import { pricingProofSchema } from "../src/server/db/v2-paid-contracts";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { createPaidAvailability } from "../src/server/modules/budget/availability";
import {
  createExecutionPlanner,
  createGatewayExecutionPlanner,
  type ExecutionDescriptor,
} from "../src/server/modules/budget/execution-plan";
import {
  createGatewayBudgetService,
  type GatewayExecutionBinding,
} from "../src/server/modules/budget/gateway-ledger";
import type { GatewayAttemptRequest } from "../src/server/modules/llm-gateway/attempts";
import {
  createLlmGateway,
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { createUsageService } from "../src/server/modules/usage/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z",
  EXP = "2026-11-01T00:00:00.000Z";
const HASH = "a".repeat(64),
  PRIVATE_INPUT = { narrative: "합성 자료 확인" };
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
// Synthetic authenticated public evidence only, never actual funding/FX/model proof.
const verifier: RuntimeProofVerifier = async (kind, _payload, digest) => ({
  digest,
  evidenceHash: "e".repeat(64),
  verifiedAt: NOW,
  method:
    kind === "pricing"
      ? "official_document"
      : kind === "funding"
        ? "authenticated_console"
        : "authenticated_coordinator",
});
const response = () => ({
  id: "chatcmpl-synthetic",
  service_tier: "default",
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 3 },
  },
  choices: [
    {
      message: {
        content: JSON.stringify({
          output: {
            schemaVersion: "1",
            inScope: true,
            urgency: "none",
            reasonCode: "IN_SCOPE",
          },
        }),
      },
      finish_reason: "stop",
    },
  ],
});
function pricing(): PricingProof {
  return {
    id: crypto.randomUUID(),
    version: 1,
    environment: "preview",
    modelBillingPolicy: {
      contextThresholdTokens: 272000,
      serviceTier: "default",
      processingRegion: "global",
      regionMultiplier: "1",
    },
    prices: ["model_input_tokens", "model_output_tokens"].map((sku) => ({
      sku: sku as "model_input_tokens" | "model_output_tokens",
      provider: "openai",
      model: "openai/gpt-6-sol",
      region: "global",
      plan: "synthetic",
      billingMode: "metered",
      unit: "tokens",
      unitSize: "1000000",
      usdPerUnit: "1",
      billingQuantum: "1",
      officialUrl: "https://developers.cloudflare.com/ai-gateway/",
      checkedAt: NOW,
      validUntil: EXP,
      modelRates: ["short", "long"].flatMap((contextTier) =>
        (sku === "model_input_tokens"
          ? ["ordinary", "cached_read", "cache_write"]
          : ["not_applicable"]
        ).map((cacheClass) => ({
          contextTier: contextTier as "short" | "long",
          cacheClass: cacheClass as "ordinary" | "cached_read" | "cache_write" | "not_applicable",
          usdPerUnit: "1",
        })),
      ),
    })),
    fx: {
      krwPerUsd: "1000",
      authority: "synthetic",
      referenceUrl: "https://example.test/fx",
      asOf: NOW,
      checkedAt: NOW,
      validUntil: EXP,
    },
    taxRatio: "0",
    feeRatio: "0",
    safetyMarginRatio: "0",
    hiddenAttemptMultiplier: 1,
    hiddenRetryReference: "synthetic",
    checkedAt: NOW,
    validUntil: EXP,
  };
}
async function capture(invocationId: string): Promise<GatewayAttemptRequest> {
  const wire = prepareGatewayWireInput("screening", PRIVATE_INPUT);
  return {
    invocationId,
    requestId: "synthetic-request",
    phase: "screening",
    model: "openai/gpt-6-sol",
    attemptOrdinal: 1,
    correction: false,
    ...(await gatewayWireIdentity(wire)),
    outputTokenUpperBound: wire.max_completion_tokens,
  };
}
function descriptor(r: GatewayAttemptRequest): ExecutionDescriptor {
  return {
    model: r.model,
    phase: r.phase,
    correction: r.correction,
    wireInputSha256: r.wireInputSha256,
    inputBytes: r.inputBytes,
    outputTokenUpperBound: r.outputTokenUpperBound,
    basis: "verified_tokenizer_and_framing",
    tokenizerRevision: "synthetic-only",
    textTokensUpperBound: 15,
    framingTokensUpperBound: 5,
    vision: null,
    modelInputTokenLimit: 10000,
    modelContextTokenLimit: 20000,
    modelOutputTokenLimit: 10000,
    checkedAt: NOW,
    validUntil: EXP,
  };
}
async function fixture(
  limit = 100,
  configure?: (d: ExecutionDescriptor) => void,
  applicationCostLimitsEnabled = true,
  metadata: "full" | "none" | "missing_sku" = "full",
) {
  const db = await createTestDatabase();
  dbs.push(db);
  const session = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("g".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher, { applicationCostLimitsEnabled }),
    ownerId = session.userId;
  let current = NOW;
  const actor = { ownerId, now: NOW },
    accounting = createV2AccountingRepository(core, "preview"),
    jobs = createV2JobsRepository(core);
  await accounting.ensurePrincipal(actor);
  const invocationId = crypto.randomUUID(),
    request = await capture(invocationId);
  const d = descriptor(request);
  configure?.(d);
  const planner = createGatewayExecutionPlanner({
    applicationCostLimitsEnabled,
    input: async () => PRIVATE_INPUT,
    bounds: async () => d,
    verifyBounds: async (_d, digest) => ({ digest, evidenceHash: HASH, verifiedAt: NOW }),
  });
  const service = createGatewayBudgetService({
    core,
    environment: "preview",
    ownerId,
    clock: () => current,
    verifyEvidence: verifier,
    execution: planner.verify,
  });
  const allocation = {
    month: "2026-10",
    version: 1,
    previewKrw: limit,
    productionKrw: 100,
    sharedFixedKrw: 0,
    maintenanceReserveKrw: 0,
    pricingProvenance: "synthetic",
    fxProvenance: "synthetic",
    fundingProvenance: "synthetic",
    reviewedAt: NOW,
    validUntil: EXP,
    fundingState: "trial_credit" as const,
    fundingValidUntil: EXP,
    manifestHash: HASH,
  };
  const runtime = service.runtime;
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation };
  const pp = pricing(),
    fp = {
      id: crypto.randomUUID(),
      environment: "preview" as const,
      state: "trial_credit" as const,
      existingPaymentPath: true as const,
      autoRecharge: false as const,
      spendAllowanceKrw: limit,
      reference: "synthetic",
      observedAt: NOW,
      validUntil: EXP,
    };
  if (metadata === "missing_sku")
    pp.prices = pp.prices.filter((p) => p.sku !== "model_output_tokens");
  if (metadata !== "none") {
    expect(await accounting.recordAllocation(allocation)).toBe(true);
    for (const environment of ["preview", "production"] as const)
      expect(
        await accounting.recordAllocationAcknowledgment({
          month: allocation.month,
          version: 1,
          environment,
          manifestHash: HASH,
          drainReceiptId: crypto.randomUUID(),
          now: NOW,
        }),
      ).toBe(true);
    expect(await accounting.activateAllocation(allocation.month, 1, NOW)).toBe(true);
    expect(await runtime.initializeControl(allocation.month, NOW)).toBe(true);
    expect(await runtime.putAllocationProof(ap, NOW)).toBe(true);
    const drain = await runtime.drain(allocation.month, 1, ap.id, NOW);
    if (!drain) throw new Error("synthetic drain");
    expect(await runtime.putRemoteDrainProof(drain, NOW)).toBe(true);
    const remote = {
      ...drain,
      id: crypto.randomUUID(),
      environment: "production" as const,
      limitKrw: 100,
    };
    expect(await runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
    expect(await runtime.activate(allocation.month, 2, ap.id, drain.id, remote.id, NOW)).toBe(true);
    expect(await runtime.putPricingProof(pp, NOW)).toBe(true);
    expect(await runtime.putFundingProof(fp, NOW)).toBe(true);
  }
  const workspaceId = crypto.randomUUID();
  const envelope = await core.encrypt("v2_workspaces", workspaceId, ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, ownerId, envelope, NOW, NOW);
  const binding: GatewayExecutionBinding = {
    operationId: crypto.randomUUID(),
    operationRevision: 2,
    requestHash: HASH,
    jobId: crypto.randomUUID(),
    targetKind: "workspace",
    targetId: workspaceId,
    targetRevision: 2,
    invocationId,
    maximumAttempts: 3,
    deadlineAt: "2026-10-06T00:01:00.000Z",
    pricingProofId: metadata === "none" ? null : pp.id,
    fundingProofId: metadata === "none" ? null : fp.id,
    allocationProofId: metadata === "none" ? null : ap.id,
  };
  async function admit(b = binding, r = request) {
    const admission = await service.prepareAdmission(b, r);
    if (!admission) throw new Error("synthetic admission");
    const ok = await jobs.admitWorkspace(
      { ...admission.actor, workspaceId: b.targetId, expectedRevision: 1 },
      { operationId: b.operationId, key: crypto.randomUUID(), requestHash: b.requestHash },
      b.jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: { expectedRevision: 1, text: "합성 사건", selectedFileIds: [] },
      },
      admission.paid,
    );
    expect(ok).toBe(true);
    const acquired = await jobs.acquire(
      actor,
      b.jobId,
      crypto.randomUUID(),
      "2026-10-06T00:02:00.000Z",
      admission.request.attemptId,
    );
    if (!acquired) throw new Error("synthetic lease");
    const background: Promise<void>[] = [];
    const ledger = service.createLedger({
      binding: b,
      initial: admission,
      lease: async () => ({ lease: acquired.lease, expiresAt: "2026-10-06T00:02:00.000Z" }),
      waitUntil: (promise) => {
        background.push(promise);
        void promise.catch(() => {});
      },
    });
    // Explicit synthetic clock adapter for Gateway's real Date.now metadata.
    // Production composition uses the Worker clock; no provider evidence is forged.
    const afterTransport = ledger.afterTransport;
    ledger.afterTransport = (handle, receipt) =>
      afterTransport(handle, { ...receipt, observedAt: current });
    return { admission, ledger, background, acquired };
  }
  return {
    db,
    core,
    service,
    runtime,
    actor,
    jobs,
    binding,
    request,
    d,
    pp,
    fp,
    ap,
    accounting,
    admit,
    setNow: (now: string) => {
      current = now;
    },
  };
}

test("real migrated SQL + AES atomic admission settles sanitized Gateway usage before publishing", async () => {
  const f = await fixture(),
    a = await f.admit();
  let runs = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          runs++;
          return response();
        },
      },
    },
    { attemptLedger: a.ledger },
  );
  expect(
    await gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).toMatchObject({ inScope: true });
  expect(runs).toBe(1);
  await Promise.all(a.background);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(1);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(1);
  const row = f.db.sqlite.query("SELECT payload_json FROM v2_runtime_usage").get() as {
    payload_json: string;
  };
  expect(row.payload_json).not.toContain("합성");
  expect(row.payload_json).not.toContain("choices");
  const saved = JSON.parse(row.payload_json);
  expect(saved.modelTokenDetails).toEqual({
    cachedInputTokens: 2,
    cacheWriteInputTokens: 3,
    serviceTier: "default",
  });
  expect(saved.chargedUsd).toBeNull();
  expect(saved.dispatchToken).toBeString();
});

test("byte identity cannot authorize same-length replacement or missing tokenizer/vision bounds", async () => {
  const f = await fixture();
  expect(
    await f.service.prepareAdmission(f.binding, { ...f.request, wireInputSha256: "c".repeat(64) }),
  ).toBeNull();
  expect(
    await f.service.prepareAdmission(f.binding, {
      ...f.request,
      inputBytes: f.request.inputBytes + 1,
    }),
  ).toBeNull();
  const planner = createExecutionPlanner({ expected: async () => f.d });
  expect(await planner.verify(f.request, NOW)).toBeNull();
  const bad = await fixture(100, (d) => {
    d.vision = {
      imageCount: 1,
      maximumTokens: 20001,
      capabilityEvidenceHash: HASH,
      dimensionsAndDetailHash: HASH,
    };
  });
  expect(await bad.service.prepareAdmission(bad.binding, bad.request)).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
});

test("registration and quota cancellation release only prepared tokenless holds; replays cannot refund dispatched work", async () => {
  for (const mode of ["registration", "quota"] as const) {
    const f = await fixture(),
      a = await f.admit();
    let runs = 0;
    if (mode === "registration")
      a.ledger.waitUntil = () => {
        throw new Error("synthetic");
      };
    const gateway = createLlmGateway(
      {
        APP_ENV: "preview",
        AI_GATEWAY_ID: "synthetic",
        AI: {
          run: async () => {
            runs++;
            return response();
          },
        },
      },
      { attemptLedger: a.ledger },
    );
    await expect(
      gateway.call(
        "screening",
        PRIVATE_INPUT,
        "synthetic-request",
        async () => false,
        undefined,
        f.binding.invocationId,
      ),
    ).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(runs).toBe(0);
    expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(0);
    expect(f.db.sqlite.query("SELECT state FROM v2_cost_attempts").get()).toEqual({
      state: "released",
    });
  }
  const f = await fixture(),
    a = await f.admit(),
    handle = await a.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("synthetic handle");
  expect(await a.ledger.confirmDispatch(handle)).toBe(true);
  await expect(
    a.ledger.afterTransport(handle, {
      transport: "not_sent",
      definitiveNoCharge: true,
      providerRequestId: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      serviceTier: null,
      meteringStatus: "incomplete",
      observedAt: NOW,
    }),
  ).rejects.toThrow("BUDGET_UNAVAILABLE");
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
  expect(await a.ledger.confirmDispatch(handle)).toBe(false);
});

test("timeout durable ambiguity blocks overlap; late usage settles original attempt even after deletion/month boundary", async () => {
  const f = await fixture(),
    a = await f.admit();
  let resolve: (v: unknown) => void = () => {},
    runs = 0;
  const remote = new Promise((r) => {
    resolve = r;
  });
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          runs++;
          return remote;
        },
      },
    },
    { attemptLedger: a.ledger, timeoutMs: 5 },
  );
  await expect(
    gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).rejects.toThrow("MODEL_UNAVAILABLE");
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(1);
  expect(await a.ledger.beforeDispatch({ ...f.request, attemptOrdinal: 2 })).toBeNull();
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  f.setNow("2026-10-31T15:00:00.000Z");
  resolve(response());
  await Promise.all(a.background);
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(0);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(1);
  expect(runs).toBe(1);
});

test("receipt SQL rollback preserves valid output only in observation mode and keeps the dispatched hold", async () => {
  const diagnostics = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const applicationCostLimitsEnabled of [true, false]) {
      const f = await fixture(100, undefined, applicationCostLimitsEnabled),
        a = await f.admit();
      let runs = 0;
      f.db.sqlite.exec(
        "CREATE TRIGGER fail_gateway_receipt BEFORE INSERT ON v2_cost_receipts BEGIN SELECT RAISE(ABORT,'private SQL sentinel'); END",
      );
      const gateway = createLlmGateway(
        {
          APP_ENV: "preview",
          AI_GATEWAY_ID: "synthetic",
          AI: {
            run: async () => {
              runs++;
              return response();
            },
          },
        },
        { attemptLedger: a.ledger },
      );
      const result = gateway.call(
        "screening",
        PRIVATE_INPUT,
        "synthetic-request",
        async () => true,
        undefined,
        f.binding.invocationId,
      );
      if (applicationCostLimitsEnabled) await expect(result).rejects.toThrow("MODEL_UNAVAILABLE");
      else expect(await result).toMatchObject({ inScope: true });
      await Promise.all(a.background);
      expect(runs).toBe(1);
      expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
      expect(f.db.sqlite.query("SELECT state,charged_krw FROM v2_cost_attempts").get()).toEqual({
        state: "reserved",
        charged_krw: null,
      });
      expect(
        f.db.sqlite.query("SELECT state,dispatch_token FROM v2_paid_holds").get(),
      ).toMatchObject({ state: "dispatched", dispatch_token: expect.any(String) });
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_receipts").get()).toEqual({ n: 0 });
      // Receipt identity/CAS refusal is not a persistence outage. Observation
      // mode cannot refund a dispatched call by presenting an unsent receipt.
      await expect(
        a.ledger.afterTransport(
          { invocationId: f.binding.invocationId, attemptId: a.admission.request.attemptId },
          {
            transport: "not_sent",
            definitiveNoCharge: true,
            providerRequestId: null,
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            cacheWriteInputTokens: null,
            serviceTier: null,
            meteringStatus: "incomplete",
            observedAt: NOW,
          },
        ),
      ).rejects.toThrow("BUDGET_UNAVAILABLE");
      expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
    }
    expect(diagnostics.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
      { event: "model_cost_observation_failure", phase: "screening", category: "unknown" },
    ]);
  } finally {
    diagnostics.mockRestore();
  }
});

test("observation receipt write failure does not turn provider, policy or schema rejection into success", async () => {
  const diagnostics = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const kind of ["provider", "policy", "schema"] as const) {
      const f = await fixture(100, undefined, false),
        a = await f.admit();
      let runs = 0;
      f.db.sqlite.exec(
        "CREATE TRIGGER fail_gateway_receipt BEFORE INSERT ON v2_cost_receipts BEGIN SELECT RAISE(ABORT,'private SQL sentinel'); END",
      );
      const gateway = createLlmGateway(
        {
          APP_ENV: "preview",
          AI_GATEWAY_ID: "synthetic",
          AI: {
            run: async () => {
              runs++;
              if (kind === "provider")
                throw Object.assign(new Error("private provider sentinel"), { status: 403 });
              return {
                ...response(),
                choices: [
                  {
                    message: {
                      content: "invalid schema",
                      ...(kind === "policy" ? { refusal: "synthetic policy refusal" } : {}),
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
        { attemptLedger: a.ledger },
      );
      await expect(
        gateway.call(
          "screening",
          PRIVATE_INPUT,
          "synthetic-request",
          async () => true,
          async () => false,
          f.binding.invocationId,
        ),
      ).rejects.toThrow(
        kind === "policy"
          ? "POLICY_REJECTED"
          : kind === "schema"
            ? "MODEL_SCHEMA_INVALID"
            : "MODEL_UNAVAILABLE",
      );
      await Promise.all(a.background);
      expect(runs).toBe(1);
      expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
    }
    expect(diagnostics).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("sentinel");
  } finally {
    diagnostics.mockRestore();
  }
});

test("paid availability requires durable exact proof/control and includes old unresolved carryover", async () => {
  const f = await fixture(3);
  const available = createPaidAvailability(f.core, "preview", {
    clock: () => NOW,
    proofs: async () => ({
      pricingProofId: f.pp.id,
      fundingProofId: f.fp.id,
      allocationProofId: f.ap.id,
    }),
  });
  expect(await available()).toBe(true);
  const usage = createUsageService(f.db.binding, {
    environment: "preview",
    clock: () => NOW,
    budgetProofs: async () => ({
      pricingProofId: f.pp.id,
      fundingProofId: f.fp.id,
      allocationProofId: f.ap.id,
    }),
  });
  expect((await usage.account(f.actor.ownerId)).waitReasons).not.toContain("monthly_budget");
  expect(
    await createPaidAvailability(f.core, "preview", {
      clock: () => NOW,
      proofs: async () => null,
    })(),
  ).toBe(false);
  await f.admit();
  expect(await available()).toBe(true);
  f.db.sqlite.query("UPDATE v2_monthly_budget SET fixed_maintenance_krw=2").run();
  expect(await available()).toBe(false);
  expect((await usage.account(f.actor.ownerId)).waitReasons).toContain("monthly_budget");
  f.db.sqlite.query("UPDATE v2_monthly_budget SET fixed_maintenance_krw=0").run();
  f.db.sqlite
    .query(
      "INSERT INTO v2_monthly_budget(month,environment,allocation_version,limit_krw,reserved_krw) VALUES('2026-09','preview',1,3,3)",
    )
    .run();
  expect((await f.runtime.exposure(NOW))?.carryover_krw).toBe(3);
  expect(await available()).toBe(false);
});

test("canonical schema rejects old Whisper alias and execution evidence is not an arbitrary client flag", async () => {
  const f = await fixture();
  await expect(
    f.runtime.prepareHold(f.actor, {
      ...(await f.service.prepareAdmission(f.binding, f.request))?.request,
      plan: { verified: true },
    } as never),
  ).rejects.toBeDefined();
  expect(await runtimeDigest({ b: 2, a: 1 })).toBe(await runtimeDigest({ a: 1, b: 2 }));
  expect(
    pricingProofSchema.safeParse({
      ...f.pp,
      modelBillingPolicy: null,
      prices: [
        {
          ...f.pp.prices[0],
          sku: "asr_seconds",
          unit: "seconds",
          modelRates: null,
          model: "@cf/openai/whisper",
        },
      ],
    }).success,
  ).toBe(false);
});

test("awaited dispatch crossing deadline preserves committed exposure and never starts model", async () => {
  const f = await fixture(),
    a = await f.admit();
  const original = f.runtime.beforeDispatch;
  f.runtime.beforeDispatch = async (...args) => {
    const result = await original(...args);
    f.setNow(f.binding.deadlineAt);
    return result;
  };
  let runs = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          runs++;
          return response();
        },
      },
    },
    { attemptLedger: a.ledger },
  );
  await expect(
    gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).rejects.toThrow("MODEL_UNAVAILABLE");
  expect(runs).toBe(0);
  expect(f.db.sqlite.query("SELECT state FROM v2_paid_holds").get()).toEqual({
    state: "dispatched",
  });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
});

test("actual concurrent factory admissions cannot overdraw local global allocation or reserve extra logical quota", async () => {
  const f = await fixture(3);
  const inputs = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const id = crypto.randomUUID();
      const encrypted = await f.core.encrypt("v2_workspaces", id, f.actor.ownerId, 1, {
        subjectContext: "individual",
        jurisdiction: "KR",
      });
      f.db.sqlite
        .query(
          "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
        )
        .run(id, f.actor.ownerId, encrypted, NOW, NOW);
      const binding = {
        ...f.binding,
        operationId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        targetId: id,
        invocationId: crypto.randomUUID(),
      };
      const request = { ...f.request, invocationId: binding.invocationId };
      return { binding, admission: await f.service.prepareAdmission(binding, request) };
    }),
  );
  const results = await Promise.all(
    inputs.map(async ({ binding, admission }) => {
      if (!admission) throw new Error("synthetic concurrency admission");
      return f.jobs.admitWorkspace(
        { ...admission.actor, workspaceId: binding.targetId, expectedRevision: 1 },
        {
          operationId: binding.operationId,
          key: crypto.randomUUID(),
          requestHash: binding.requestHash,
        },
        binding.jobId,
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: { expectedRevision: 1, text: "합성 사건", selectedFileIds: [] },
        },
        admission.paid,
      );
    }),
  );
  expect(results.filter(Boolean)).toHaveLength(3);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(3);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(3);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 3 });
});

test("schema correction has two actual metered attempts and one logical user reservation", async () => {
  const f = await fixture(),
    a = await f.admit();
  let runs = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: { run: async () => (++runs === 1 ? { ...response(), choices: [] } : response()) },
    },
    { attemptLedger: a.ledger },
  );
  expect(
    await gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      async () => true,
      f.binding.invocationId,
    ),
  ).toMatchObject({ inScope: true });
  expect(runs).toBe(2);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(2);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 2 });
  expect(f.db.sqlite.query("SELECT count(DISTINCT attempt_id) n FROM v2_paid_holds").get()).toEqual(
    { n: 2 },
  );
});

test("restore binds same immutable prepared plan; stale fence cannot dispatch", async () => {
  const f = await fixture(),
    a = await f.admit();
  const restored = await f.service.restoreAdmission(
    f.binding,
    f.request,
    a.admission.request.attemptId,
  );
  expect(restored?.request).toEqual(a.admission.request);
  const changedCorrection = {
    ...f.request,
    correction: true,
    ...(await gatewayWireIdentity(prepareGatewayWireInput("screening", PRIVATE_INPUT, true))),
  };
  // Same token limits and operation request hash cannot replace the original
  // complete-wire evidence on a restored initial hold.
  expect(
    await f.service.restoreAdmission(f.binding, changedCorrection, a.admission.request.attemptId),
  ).toBeNull();
  expect(
    await f.service.restoreAdmission(
      f.binding,
      { ...f.request, wireInputSha256: "b".repeat(64) },
      a.admission.request.attemptId,
    ),
  ).toBeNull();
  expect(await f.service.restoreAdmission(f.binding, f.request, crypto.randomUUID())).toBeNull();
  const handle = await a.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("synthetic handle");
  f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.binding.jobId);
  expect(await a.ledger.confirmDispatch(handle)).toBe(false);
  expect(f.db.sqlite.query("SELECT state FROM v2_paid_holds").get()).toEqual({ state: "prepared" });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1);
});

test("observation-only gateway keeps model bounds and dispatches after all financial evidence expires", async () => {
  const expires = "2026-10-06T00:00:01.000Z";
  const f = await fixture(
    100,
    (d) => {
      d.validUntil = expires;
    },
    false,
  );
  const p = {
    ...f.pp,
    id: "zz-expired-pricing",
    validUntil: expires,
    fx: { ...f.pp.fx, validUntil: expires },
    prices: f.pp.prices.map((p) => ({ ...p, validUntil: expires })),
  };
  const funding = {
    ...f.fp,
    id: "zz-expired-funding",
    state: "unavailable" as const,
    spendAllowanceKrw: 0,
    validUntil: expires,
  };
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  expect(await f.runtime.putFundingProof(funding, NOW)).toBe(true);
  f.binding.pricingProofId = p.id;
  f.binding.fundingProofId = funding.id;
  f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
  f.setNow("2026-10-06T00:00:02.000Z");
  const a = await f.admit();
  let calls = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          return response();
        },
      },
    },
    { attemptLedger: a.ledger },
  );
  expect(
    await gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).toMatchObject({ inScope: true });
  await Promise.all(a.background);
  expect(calls).toBe(1);
  expect(
    f.db.sqlite
      .query("SELECT pricing_status,charged_krw FROM v2_execution_cost_observations")
      .get(),
  ).toEqual({
    pricing_status: "stale",
    charged_krw: null,
  });
  expect((await f.runtime.findProof(p.id, "2026-10-06T00:00:02.000Z"))?.payload).toEqual(p);
  const overBound = { ...f.request, outputTokenUpperBound: 50000 };
  expect(await f.service.prepareAdmission(f.binding, overBound)).toBeNull();
});

for (const metadata of ["none", "missing_sku"] as const) {
  test(`observation-only model runs and stores actual usage with ${metadata} cost metadata`, async () => {
    const f = await fixture(100, undefined, false, metadata);
    const a = await f.admit();
    const beforeProofs = f.db.sqlite.query("SELECT * FROM v2_runtime_proofs ORDER BY id").all();
    let calls = 0;
    const gateway = createLlmGateway(
      {
        APP_ENV: "preview",
        AI_GATEWAY_ID: "synthetic",
        AI: {
          run: async () => {
            calls++;
            return response();
          },
        },
      },
      { attemptLedger: a.ledger },
    );
    expect(
      await gateway.call(
        "screening",
        PRIVATE_INPUT,
        "synthetic-request",
        async () => true,
        undefined,
        f.binding.invocationId,
      ),
    ).toMatchObject({ inScope: true });
    await Promise.all(a.background);
    expect(calls).toBe(1);
    expect(f.db.sqlite.query("SELECT state,transport FROM v2_execution_admissions").get()).toEqual({
      state: "final",
      transport: "response",
    });
    const observation = f.db.sqlite
      .query(
        "SELECT pricing_status,funding_status,charged_usd,charged_krw,payload_json FROM v2_execution_cost_observations",
      )
      .get() as { payload_json: string };
    expect(observation).toMatchObject({
      pricing_status: metadata === "none" ? "missing" : "incomplete",
      funding_status: metadata === "none" ? "missing" : "current",
      charged_usd: null,
      charged_krw: null,
    });
    expect(JSON.parse(observation.payload_json)).toMatchObject({
      providerRequestId: "chatcmpl-synthetic",
      quantities: [
        { sku: "model_input_tokens", quantity: "10" },
        { sku: "model_output_tokens", quantity: "20" },
      ],
    });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_quotes").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT * FROM v2_runtime_proofs ORDER BY id").all()).toEqual(
      beforeProofs,
    );
    if (metadata === "none")
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_monthly_budget").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
}

test("unpriced admission restores exact wire evidence and refuses stale lease or duplicate dispatch", async () => {
  const f = await fixture(100, undefined, false, "none"),
    a = await f.admit();
  const restored = await f.service.restoreAdmission(
    f.binding,
    f.request,
    a.admission.request.attemptId,
  );
  expect(restored?.request).toEqual(a.admission.request);
  expect(
    await f.service.restoreAdmission(
      f.binding,
      { ...f.request, wireInputSha256: "b".repeat(64) },
      a.admission.request.attemptId,
    ),
  ).toBeNull();
  if (!restored) throw new Error("synthetic restore missing");
  const ledger = f.service.createLedger({
    binding: f.binding,
    initial: restored,
    lease: async () => ({ lease: a.acquired.lease, expiresAt: "2026-10-06T00:02:00.000Z" }),
    waitUntil: () => {},
  });
  const h = await ledger.beforeDispatch(f.request);
  expect(h).not.toBeNull();
  if (!h) throw new Error("synthetic handle missing");
  expect(await ledger.confirmDispatch(h)).toBe(true);
  expect(await ledger.confirmDispatch(h)).toBe(false);
  expect(await f.runtime.beforeDispatch(f.actor, a.acquired.lease, h.attemptId)).toBeNull();
  expect(
    await f.service.restoreAdmission(f.binding, f.request, a.admission.request.attemptId),
  ).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_admissions").get()).toEqual({
    n: 1,
  });
});

test("unpriced unknown transport retains unresolved execution and prevents overlapping retry", async () => {
  const f = await fixture(100, undefined, false, "none"),
    a = await f.admit();
  const h = await a.ledger.beforeDispatch(f.request);
  if (!h) throw new Error("synthetic handle missing");
  expect(await a.ledger.confirmDispatch(h)).toBe(true);
  await a.ledger.afterTransport(h, {
    transport: "unknown",
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    serviceTier: null,
    meteringStatus: "incomplete",
    observedAt: NOW,
    definitiveNoCharge: false,
  });
  expect(await a.ledger.beforeDispatch({ ...f.request, attemptOrdinal: 2 })).toBeNull();
  expect(f.db.sqlite.query("SELECT state,transport FROM v2_execution_admissions").get()).toEqual({
    state: "unknown",
    transport: "unknown",
  });
  expect(
    f.db.sqlite.query("SELECT charged_krw,charged_usd FROM v2_execution_cost_observations").get(),
  ).toEqual({ charged_krw: null, charged_usd: null });
});

test("unpriced observation append failure preserves a valid response and technical completion", async () => {
  const f = await fixture(100, undefined, false, "none"),
    a = await f.admit();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_observation_failure BEFORE INSERT ON v2_execution_cost_observations BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  let calls = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          return response();
        },
      },
    },
    { attemptLedger: a.ledger },
  );
  expect(
    await gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).toMatchObject({ inScope: true });
  await Promise.all(a.background);
  expect(calls).toBe(1);
  expect(f.db.sqlite.query("SELECT state,transport FROM v2_execution_admissions").get()).toEqual({
    state: "final",
    transport: "response",
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_cost_observations").get()).toEqual({
    n: 0,
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
});

test("unpriced model preserves technical bounds, admission durability and actual provider rejection", async () => {
  const f = await fixture(100, undefined, false, "none");
  expect(
    await f.service.prepareAdmission(f.binding, { ...f.request, outputTokenUpperBound: 50000 }),
  ).toBeNull();
  const a = await f.admit();
  let calls = 0;
  const gateway = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          throw new Error("synthetic provider rejection");
        },
      },
    },
    { attemptLedger: a.ledger },
  );
  await expect(
    gateway.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      f.binding.invocationId,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  expect(f.db.sqlite.query("SELECT state FROM v2_execution_admissions").get()).toEqual({
    state: "unknown",
  });
  const g = await fixture(100, undefined, false, "none"),
    b = await g.admit();
  g.db.sqlite.exec(
    "CREATE TRIGGER synthetic_dispatch_failure BEFORE UPDATE ON v2_execution_admissions BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  let forbiddenCalls = 0;
  const blocked = createLlmGateway(
    {
      APP_ENV: "preview",
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          forbiddenCalls++;
          return response();
        },
      },
    },
    { attemptLedger: b.ledger },
  );
  await expect(
    blocked.call(
      "screening",
      PRIVATE_INPUT,
      "synthetic-request",
      async () => true,
      undefined,
      g.binding.invocationId,
    ),
  ).rejects.toThrow();
  expect(forbiddenCalls).toBe(0);
  expect(g.db.sqlite.query("SELECT state FROM v2_execution_admissions").get()).toEqual({
    state: "prepared",
  });
});
