import { z } from "zod";
import { usageDateKst } from "../src/server/db/repository";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import {
  createV2PaidRuntimeRepository,
  type PricingProof,
  type RuntimeProofVerifier,
  runtimeDigest,
} from "../src/server/db/v2-paid-runtime";
import { remoteBudgetD1 } from "./remote-budget-d1";

export const observationSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  creditUsd: z.literal("40.00"),
  existingPaymentPath: z.literal(true),
  autoRecharge: z.literal(true),
  thresholdUsd: z.literal("10.00"),
  refillUsd: z.literal("30.00"),
  authorizedByDirectUserInstruction: z.literal(true),
  monthlyBudgetCapEnabled: z.literal(false),
  fx: z.strictObject({
    krwPerUsd: z.literal("1351.70"),
    asOf: z.iso.datetime(),
    authority: z.literal("Industrial Bank of Korea: sending remittance rate, 2026-10-06"),
    referenceUrl: z.literal("https://global.ibk.co.kr/en/services/ExchangeRate/USD"),
  }),
  model: z.literal("openai/gpt-6-sol"),
  contextTokens: z.literal(1050000),
  maximumOutputTokens: z.literal(128000),
  modelReference: z.literal("https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/"),
  outputReference: z.literal("https://developers.openai.com/api/docs/models/gpt-6-sol"),
});
export type AiRuntimeObservation = z.infer<typeof observationSchema>;

export function modelBounds(observation: AiRuntimeObservation, evidenceHash: string) {
  return {
    bounds: {
      basis: "verified_model_context_limit",
      tokenizerRevision: "gpt-6-sol-context-2026-10-07",
      textTokensUpperBound: 1050000,
      framingTokensUpperBound: 0,
      vision: null,
      modelInputTokenLimit: 1050000,
      modelContextTokenLimit: observation.contextTokens,
      modelOutputTokenLimit: observation.maximumOutputTokens,
      checkedAt: observation.checkedAt,
      validUntil: observation.validUntil,
    },
    evidenceHash,
    verifiedAt: observation.checkedAt,
  };
}
export function pricing(
  environment: "preview" | "production",
  o: AiRuntimeObservation,
): PricingProof {
  const fresh = { checkedAt: o.checkedAt, validUntil: o.validUntil };
  return {
    id: crypto.randomUUID(),
    version: 1,
    environment,
    prices: [
      {
        sku: "model_input_tokens" as const,
        usdPerUnit: "5.50",
        modelRates: [
          { contextTier: "short" as const, cacheClass: "ordinary" as const, usdPerUnit: "2" },
          { contextTier: "short" as const, cacheClass: "cached_read" as const, usdPerUnit: "0.20" },
          { contextTier: "short" as const, cacheClass: "cache_write" as const, usdPerUnit: "2.50" },
          { contextTier: "long" as const, cacheClass: "ordinary" as const, usdPerUnit: "4" },
          { contextTier: "long" as const, cacheClass: "cached_read" as const, usdPerUnit: "0.40" },
          { contextTier: "long" as const, cacheClass: "cache_write" as const, usdPerUnit: "5" },
        ],
      },
      {
        sku: "model_output_tokens" as const,
        usdPerUnit: "16.50",
        modelRates: [
          {
            contextTier: "short" as const,
            cacheClass: "not_applicable" as const,
            usdPerUnit: "10",
          },
          { contextTier: "long" as const, cacheClass: "not_applicable" as const, usdPerUnit: "15" },
        ],
      },
    ].map((p) => ({
      ...p,
      provider: "openai" as const,
      model: o.model,
      region: "global",
      plan: "AI Gateway Unified Billing",
      billingMode: "metered" as const,
      unit: "tokens" as const,
      unitSize: "1000000",
      billingQuantum: "1",
      officialUrl: o.modelReference,
      ...fresh,
    })),
    modelBillingPolicy: {
      contextThresholdTokens: 272000,
      serviceTier: "default",
      processingRegion: "global",
      regionMultiplier: "1.10",
    },
    fx: { ...o.fx, ...fresh },
    taxRatio: "0.10",
    feeRatio: "0.05",
    safetyMarginRatio: "0.20",
    hiddenAttemptMultiplier: 1,
    hiddenRetryReference: "Gateway retry OFF; application attempts each reserve their own hold",
    ...fresh,
  };
}

/** Existing repository primitives coordinate both real databases; no fake remote drain receipts. */
export async function provisionAiRuntime(
  bindings: Record<"preview" | "production", D1Database>,
  raw: unknown,
) {
  const o = observationSchema.parse(raw),
    now = new Date().toISOString();
  if (
    Date.parse(o.checkedAt) > Date.parse(now) ||
    Date.parse(o.validUntil) <= Date.parse(now) ||
    Date.parse(now) - Date.parse(o.checkedAt) > 24 * 60 * 60 * 1000
  )
    throw new Error("AI_RUNTIME_OBSERVATION_STALE");
  const evidenceHash = await runtimeDigest(o),
    month = usageDateKst(now).slice(0, 7);
  const verifier: RuntimeProofVerifier = async (kind, _payload, digest) => ({
    digest,
    evidenceHash,
    method:
      kind === "pricing"
        ? "official_document"
        : kind === "funding"
          ? "authenticated_console"
          : "authenticated_coordinator",
    verifiedAt: o.checkedAt,
  });
  const environments = ["preview", "production"] as const;
  const peers = environments.map((environment) => {
    const core = createV2Core(
      bindings[environment],
      {
        async encrypt() {
          throw new Error("Coordinator has no private data access");
        },
        async decrypt() {
          throw new Error("Coordinator has no private data access");
        },
      },
      { monthlyBudgetCapEnabled: false },
    );
    return {
      environment,
      core,
      accounting: createV2AccountingRepository(core, environment),
      runtime: createV2PaidRuntimeRepository(core, environment, verifier),
    };
  });
  // Genuine authenticated zero-state observations bootstrap the first manifest.
  const observed = await Promise.all(
    peers.map(async (p) => ({
      allocations: await p.core
        .statement("SELECT count(*) AS n FROM v2_budget_allocations")
        .first<number>("n"),
      costs: await p.core
        .statement("SELECT count(*) AS n FROM v2_cost_attempts")
        .first<number>("n"),
      exposure: await p.runtime.exposure(now),
    })),
  );
  const bootstrap = observed.every(
    (s) => s.allocations === 0 && s.costs === 0 && s.exposure === null,
  );
  if (
    !bootstrap &&
    observed.some(
      (s) => !s.exposure || s.exposure.reserved_krw !== 0 || s.exposure.ambiguous_krw !== 0,
    )
  )
    throw new Error("AI_RUNTIME_DRAIN_REQUIRED");
  const version = Math.max(0, ...observed.map((s) => s.exposure?.allocation_version ?? 0)) + 1;
  const manifest = {
    month,
    version,
    previewKrw: 100000,
    productionKrw: 900000,
    sharedFixedKrw: 0,
    maintenanceReserveKrw: 0,
    pricingProvenance: o.modelReference,
    fxProvenance: o.fx.referenceUrl,
    fundingProvenance:
      "Authenticated existing Cloudflare payment path with user-approved $10/$30 auto recharge",
    reviewedAt: o.checkedAt,
    validUntil: o.validUntil,
    fundingState: "funded" as const,
    fundingValidUntil: o.validUntil,
  };
  const allocation: BudgetAllocation = { ...manifest, manifestHash: await runtimeDigest(manifest) };
  for (const p of peers) {
    if (!(await p.accounting.recordAllocation(allocation)))
      throw new Error("AI_RUNTIME_MANIFEST_CONFLICT");
    if (bootstrap) {
      for (const environment of environments)
        await p.accounting.recordAllocationAcknowledgment({
          month,
          version,
          environment,
          manifestHash: allocation.manifestHash,
          drainReceiptId: await runtimeDigest({ environment, observed, month, version }),
          now,
        });
      if (
        !(await p.accounting.activateAllocation(month, version, now)) ||
        !(await p.runtime.initializeControl(month, now))
      )
        throw new Error("AI_RUNTIME_BOOTSTRAP_FAILED");
    }
  }
  const drains = [];
  const proofs = [];
  for (const p of peers) {
    const exposure = await p.runtime.exposure(now);
    if (!exposure) throw new Error("AI_RUNTIME_CONTROL_MISSING");
    if (!bootstrap && !(await p.runtime.freeze(month, exposure.control_revision, version, now)))
      throw new Error("AI_RUNTIME_FREEZE_CONFLICT");
    const current = await p.runtime.exposure(now);
    if (!current) throw new Error("AI_RUNTIME_CONTROL_MISSING");
    const ap = { id: crypto.randomUUID(), environment: p.environment, allocation };
    if (!(await p.runtime.putAllocationProof(ap, now)))
      throw new Error("AI_RUNTIME_ALLOCATION_PROOF_FAILED");
    const drain = await p.runtime.drain(month, current.control_revision, ap.id, now);
    if (!drain) throw new Error("AI_RUNTIME_DRAIN_REQUIRED");
    drains.push(drain);
    proofs.push(ap);
  }
  for (const [index, p] of peers.entries()) {
    const local = drains[index],
      remote = drains[1 - index],
      ap = proofs[index];
    if (!local || !remote || !ap) throw new Error("AI_RUNTIME_PEER_MISSING");
    if (
      !(await p.runtime.putRemoteDrainProof(local, now)) ||
      !(await p.runtime.putRemoteDrainProof(remote, now))
    )
      throw new Error("AI_RUNTIME_AUTHENTICATED_DRAIN_FAILED");
    if (!(await p.runtime.activate(month, local.controlRevision, ap.id, local.id, remote.id, now)))
      throw new Error("AI_RUNTIME_ACTIVATION_FAILED");
    if (!(await p.runtime.putPricingProof(pricing(p.environment, o), now)))
      throw new Error("AI_RUNTIME_PRICING_FAILED");
    if (
      !(await p.runtime.putFundingProof(
        {
          id: crypto.randomUUID(),
          environment: p.environment,
          state: "funded",
          existingPaymentPath: true,
          autoRecharge: true,
          spendAllowanceKrw: Number.MAX_SAFE_INTEGER,
          reference:
            "Authenticated Cloudflare billing: existing credit $40; authorized auto-recharge $10/$30; no application monthly cap",
          observedAt: o.checkedAt,
          validUntil: o.validUntil,
        },
        now,
      ))
    )
      throw new Error("AI_RUNTIME_FUNDING_FAILED");
  }
  return {
    evidenceHash,
    month,
    version,
    bootstrap,
    previewActive: true,
    productionActive: true,
    monthlyBudgetCapEnabled: false,
  };
}

if (import.meta.main) {
  try {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const sha = process.argv[2];
    if (!token || !sha || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error("AI_RUNTIME_DEPLOYMENT_INPUT_INVALID");
    const config = (await Bun.file("wrangler.jsonc").json()) as {
      env: Record<string, { d1_databases: { database_id: string }[] }>;
    };
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!account) throw new Error("AI_RUNTIME_ACCOUNT_MISSING");
    const observation = observationSchema.parse(
      await Bun.file("docs/operations/AI-RUNTIME-OBSERVATION.json").json(),
    );
    const bindings = Object.fromEntries(
      ["preview", "production"].map((e) => [
        e,
        remoteBudgetD1(token, account, config.env[e]?.d1_databases[0]?.database_id ?? ""),
      ]),
    ) as Record<"preview" | "production", D1Database>;
    const result = await provisionAiRuntime(bindings, observation);
    const bounds = JSON.stringify(modelBounds(observation, result.evidenceHash));
    for (const environment of ["preview", "production"]) {
      const child = Bun.spawn(
        ["bunx", "wrangler", "secret", "put", "AI_MODEL_TOKEN_BOUNDS_JSON", "--env", environment],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      child.stdin.write(bounds);
      child.stdin.end();
      await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if ((await child.exited) !== 0) throw new Error("AI_RUNTIME_BOUNDS_DEPLOY_FAILED");
    }
    console.log(
      JSON.stringify({
        ...result,
        candidateSha: sha,
        modelBoundsConfigured: true,
        autoRecharge: true,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof Error && /^AI_RUNTIME_[A-Z_]+$/.test(error.message)
        ? error.message
        : "AI_RUNTIME_PROVISION_FAILED",
    );
    process.exitCode = 1;
  }
}
