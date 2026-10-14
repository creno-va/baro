import { z } from "zod";
import { usageDateKst } from "../src/server/db/repository";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { decimalSchema, pricingProofSchema } from "../src/server/db/v2-paid-contracts";
import {
  createV2PaidRuntimeRepository,
  type PricingProof,
  type RuntimeProofVerifier,
  runtimeDigest,
} from "../src/server/db/v2-paid-runtime";
import {
  createV2RuntimeRefreshRepository,
  runtimeRefreshSchema,
} from "../src/server/db/v2-runtime-refresh";
import type { initializeEmptyStorage } from "./initialize-storage";
import { remoteBudgetD1 } from "./remote-budget-d1";

export const observationSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  creditUsd: decimalSchema,
  spendAllowanceKrw: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  fundingState: z.enum(["funded", "trial_credit", "unavailable"]).default("funded"),
  pricing: z
    .strictObject(pricingProofSchema.shape)
    .omit({ id: true, version: true, environment: true })
    .refine(
      (p) =>
        pricingProofSchema.safeParse({
          ...p,
          id: "observation-template",
          version: 1,
          environment: "preview",
        }).success,
    ),
  existingPaymentPath: z.literal(true),
  autoRecharge: z.literal(true),
  thresholdUsd: z.literal("10.00"),
  refillUsd: z.literal("30.00"),
  authorizedByDirectUserInstruction: z.literal(true),
  monthlyBudgetCapEnabled: z.literal(false),
  fx: z.strictObject({
    krwPerUsd: decimalSchema.refine((v) => /[1-9]/.test(v)),
    asOf: z.iso.datetime(),
    authority: z.string().min(1).max(200),
    referenceUrl: z.literal("https://global.ibk.co.kr/en/services/ExchangeRate/USD"),
  }),
  model: z.literal("openai/gpt-6-sol"),
  contextTokens: z.literal(1050000),
  maximumOutputTokens: z.literal(128000),
  modelReference: z.literal("https://developers.cloudflare.com/ai/models/openai/gpt-6-sol/"),
  outputReference: z.literal("https://developers.openai.com/api/docs/models/gpt-6-sol"),
});
export type AiRuntimeObservation = z.infer<typeof observationSchema>;

// The historical capability observation is independent of billing approval, FX,
// available credit and refresh. Its original dates are provenance, not renewed
// billing authority; observation-only runtime ignores the legacy expiry field.
export const modelCapabilitySchema = observationSchema
  .pick({
    checkedAt: true,
    validUntil: true,
    model: true,
    contextTokens: true,
    maximumOutputTokens: true,
    modelReference: true,
    outputReference: true,
  })
  .strip();

export function modelBounds(
  observation: z.infer<typeof modelCapabilitySchema>,
  evidenceHash: string,
) {
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
  return pricingProofSchema.parse({
    ...o.pricing,
    id: crypto.randomUUID(),
    version: 1,
    environment,
  });
}

type RuntimeEnvironment = "preview" | "production";
export function operationsCore(binding: D1Database) {
  return createV2Core(
    binding,
    {
      async encrypt() {
        throw new Error("Coordinator has no private data access");
      },
      async decrypt() {
        throw new Error("Coordinator has no private data access");
      },
    },
    { applicationCostLimitsEnabled: false, monthlyBudgetCapEnabled: false },
  );
}

/** Installation is separate from activation. Inputs are operator observations,
 * never user API bodies; unavailable funding is installed as the latest head. */
export async function observeAiRuntime(
  bindings: Partial<Record<RuntimeEnvironment, D1Database>>,
  raw: unknown,
  mode: "observe" | "refresh" = "observe",
  operationKey = "default",
) {
  const o = observationSchema.parse(raw),
    now = new Date().toISOString();
  if (
    Date.parse(o.checkedAt) > Date.parse(now) ||
    o.pricing.fx.krwPerUsd !== o.fx.krwPerUsd ||
    o.pricing.fx.asOf !== o.fx.asOf
  )
    throw new Error("AI_RUNTIME_OBSERVATION_STALE");
  const evidenceHash = await runtimeDigest(o),
    month = usageDateKst(now).slice(0, 7);
  if (
    Date.parse(o.validUntil) <= Date.parse(now) ||
    Date.parse(now) - Date.parse(o.checkedAt) > 86400000
  ) {
    return {
      evidenceHash,
      month,
      mode,
      costObservationState: "stale" as const,
      observedAt: o.checkedAt,
      validUntil: o.validUntil,
      results: Object.keys(bindings).map((environment) => ({
        environment,
        observationInstalled: false,
        pricingInstalled: false,
        refreshCommitted: false,
        control: null,
      })),
    };
  }
  const results = [];
  for (const environment of ["preview", "production"] as const) {
    const binding = bindings[environment];
    if (!binding) continue;
    const core = operationsCore(binding);
    const verify: RuntimeProofVerifier = async (kind, _payload, digest) => ({
      digest,
      evidenceHash,
      verifiedAt: o.checkedAt,
      method:
        kind === "pricing"
          ? "official_document"
          : kind === "funding"
            ? "authenticated_console"
            : "authenticated_coordinator",
    });
    const runtime = createV2PaidRuntimeRepository(core, environment, verify);
    const pp = { ...pricing(environment, o), id: `price-${environment}-${evidenceHash}` };
    const fp = {
      id: `fund-${environment}-${evidenceHash}`,
      environment,
      state: o.fundingState,
      existingPaymentPath: true,
      autoRecharge: true,
      spendAllowanceKrw: o.spendAllowanceKrw,
      reference: `Authenticated existing billing observation ${evidenceHash}; existing auto-recharge $10/$30`,
      observedAt: o.checkedAt,
      validUntil: o.validUntil,
    } as const;
    // A funding stop must not be suppressed by an unrelated expired price.
    if (!(await runtime.putFundingProof(fp, now)))
      throw new Error("AI_RUNTIME_OBSERVATION_REJECTED");
    const pricingInstalled = await runtime.putPricingProof(pp, now);
    const operationDigest = await runtimeDigest({
      evidenceHash,
      operationKey: runtimeRefreshSchema.shape.id.parse(operationKey),
    });
    const id = `refresh-${environment}-${operationDigest}`;
    let committed = false;
    if (mode === "refresh" && pricingInstalled) {
      const saved = await core
        .statement("SELECT payload_json FROM v2_runtime_refreshes WHERE id=? AND environment=?", [
          id,
          environment,
        ])
        .first<string>("payload_json");
      const exposure = await runtime.exposure(now);
      const allocationId = await core
        .statement(
          "SELECT allocation_proof_id FROM v2_runtime_controls WHERE month=? AND environment=?",
          [month, environment],
        )
        .first<string>("allocation_proof_id");
      const request = saved
        ? runtimeRefreshSchema.parse(JSON.parse(saved).request)
        : exposure && allocationId
          ? {
              id,
              month,
              expectedControlRevision: exposure.control_revision,
              allocationVersion: exposure.allocation_version,
              allocationProofId: allocationId,
              pricingProofId: pp.id,
              fundingProofId: fp.id,
            }
          : null;
      if (request && (request.pricingProofId !== pp.id || request.fundingProofId !== fp.id))
        throw new Error("AI_RUNTIME_REFRESH_IDENTITY_MISMATCH");
      const renew = createV2RuntimeRefreshRepository(core, environment, verify);
      committed = request ? await renew.refresh(request, now) : false;
      if (request && !committed) {
        const concurrent = await core
          .statement("SELECT payload_json FROM v2_runtime_refreshes WHERE id=? AND environment=?", [
            id,
            environment,
          ])
          .first<string>("payload_json");
        if (concurrent) {
          const original = runtimeRefreshSchema.parse(JSON.parse(concurrent).request);
          if (original.pricingProofId === pp.id && original.fundingProofId === fp.id)
            committed = await renew.refresh(original, now);
        }
      }
    }
    results.push({
      environment,
      observationInstalled: true,
      pricingInstalled,
      refreshCommitted: committed,
      control: await runtime.exposure(now),
    });
  }
  if (!results.length) throw new Error("AI_RUNTIME_ENVIRONMENT_REQUIRED");
  return {
    evidenceHash,
    month,
    mode,
    costObservationState: "observed" as const,
    observedAt: o.checkedAt,
    validUntil: o.validUntil,
    results,
  };
}

/** Explicit reallocation: both genuine drains are still required. */
export async function provisionAiRuntime(
  bindings: Record<"preview" | "production", D1Database>,
  raw: unknown,
) {
  const o = observationSchema.parse(raw),
    now = new Date().toISOString();
  if (
    o.fundingState === "unavailable" ||
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
      { applicationCostLimitsEnabled: false, monthlyBudgetCapEnabled: false },
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
        .statement("SELECT count(*) AS n FROM v2_budget_allocations WHERE month=?", [month])
        .first<number>("n"),
      costs: await p.core
        .statement("SELECT count(*) AS n FROM v2_cost_attempts WHERE month=?", [month])
        .first<number>("n"),
      exposure: await p.runtime.exposure(now),
    })),
  );
  const bootstrap = observed.every(
    (s) => s.allocations === 0 && s.costs === 0 && s.exposure === null,
  );
  if (
    !bootstrap &&
    observed.some((s) => s.exposure?.reserved_krw !== 0 || s.exposure.ambiguous_krw !== 0)
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
    fundingState: o.fundingState,
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
          state: o.fundingState,
          existingPaymentPath: true,
          autoRecharge: true,
          spendAllowanceKrw: o.spendAllowanceKrw,
          reference: `Authenticated existing billing observation ${evidenceHash}; existing auto-recharge $10/$30; no application monthly cap`,
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

/** Read-only, allowlisted operational summary. No private payload or proof
 * reference is returned; absence of a migrated capability stays explicit. */
export async function inspectAiRuntime(bindings: Partial<Record<RuntimeEnvironment, D1Database>>) {
  const results = [];
  for (const environment of ["preview", "production"] as const) {
    const binding = bindings[environment];
    if (!binding) continue;
    const core = operationsCore(binding);
    const available = new Set(
      (
        await core
          .statement(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('v2_storage_projections','v2_storage_carryover','v2_storage_funding_heads','v2_physical_blob_bindings')",
          )
          .all<{ name: string }>()
      ).results.map((r) => r.name),
    );
    const schema = await core
      .statement("SELECT value FROM app_metadata WHERE key='schema_version'")
      .first<string>("value");
    const control = await core
      .statement(
        "SELECT c.month,c.phase,c.revision,c.pending_version,b.allocation_version,b.limit_krw,b.settled_krw,b.reserved_krw,b.ambiguous_krw,b.fixed_maintenance_krw FROM v2_runtime_controls c LEFT JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment WHERE c.environment=? ORDER BY c.month DESC LIMIT 1",
        [environment],
      )
      .first();
    const funding = await core
      .statement(
        `SELECT json_extract(p.payload_json,'$.state') AS state,json_extract(p.payload_json,'$.spendAllowanceKrw') AS spendAllowanceKrw,json_extract(p.payload_json,'$.observedAt') AS observedAt,p.valid_until AS validUntil FROM v2_runtime_proofs p ${available.has("v2_storage_funding_heads") ? "JOIN v2_storage_funding_heads head ON head.proof_id=p.id AND head.environment=p.environment" : ""} WHERE p.environment=? AND p.kind='funding' ORDER BY p.verified_at DESC,p.id DESC LIMIT 1`,
        [environment],
      )
      .first();
    const projection = available.has("v2_storage_projections")
      ? await core
          .statement(
            "SELECT month,capacity_bytes,reserved_krw,get_limit,head_limit,delete_limit,gets,heads,deletes,valid_until FROM v2_storage_projections WHERE environment=? ORDER BY month DESC LIMIT 1",
            [environment],
          )
          .first()
      : null;
    const carryover = available.has("v2_storage_carryover")
      ? await core
          .statement(
            "SELECT cursor_month,budget_krw,maintenance_krw FROM v2_storage_carryover WHERE id=1",
          )
          .first()
      : null;
    const initializationPrerequisites = await core
      .statement(
        `SELECT (SELECT count(*) FROM v2_blobs) AS recordedBlobs,(SELECT count(*) FROM v2_storage_paid_executions) AS storageExecutions,(SELECT count(*) FROM v2_jobs WHERE status IN ('queued','running','validating')) AS unfinishedJobs,${available.has("v2_physical_blob_bindings") ? "(SELECT count(*) FROM v2_physical_blob_bindings)" : "NULL"} AS physicalBindings`,
      )
      .first();
    results.push({
      environment,
      schema,
      control,
      funding,
      fundingAuthority: available.has("v2_storage_funding_heads")
        ? "latest_head"
        : "legacy_observation_only",
      projection,
      carryover,
      initializationPrerequisites,
    });
  }
  return { mode: "status", observedAt: new Date().toISOString(), results };
}

if (import.meta.main) {
  try {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const [sha, mode = "refresh", target = "both"] = process.argv.slice(2);
    if (
      !["status", "observe", "refresh", "reallocate", "initialize-storage"].includes(mode) ||
      !["preview", "production", "both"].includes(target) ||
      (mode === "reallocate" && target !== "both") ||
      (mode === "initialize-storage" && target === "both")
    )
      throw new Error("AI_RUNTIME_OPERATION_INVALID");
    if (!token || !sha || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error("AI_RUNTIME_DEPLOYMENT_INPUT_INVALID");
    const config = (await Bun.file("wrangler.jsonc").json()) as {
      env: Record<string, { d1_databases: { database_id: string }[] }>;
    };
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!account) throw new Error("AI_RUNTIME_ACCOUNT_MISSING");
    const bindings = Object.fromEntries(
      ["preview", "production"].map((e) => [
        e,
        remoteBudgetD1(token, account, config.env[e]?.d1_databases[0]?.database_id ?? ""),
      ]),
    ) as Record<"preview" | "production", D1Database>;
    const selected =
      target === "both" ? bindings : { [target]: bindings[target as RuntimeEnvironment] };
    if (mode === "status")
      console.log(JSON.stringify({ ...(await inspectAiRuntime(selected)), candidateSha: sha }));
    else {
      const observation = observationSchema.parse(
        process.env.AI_RUNTIME_OBSERVATION_JSON
          ? JSON.parse(process.env.AI_RUNTIME_OBSERVATION_JSON)
          : await Bun.file("docs/operations/AI-RUNTIME-OBSERVATION.json").json(),
      );
      let result:
        | Awaited<ReturnType<typeof observeAiRuntime>>
        | Awaited<ReturnType<typeof provisionAiRuntime>>
        | Awaited<ReturnType<typeof initializeEmptyStorage>>;
      if (mode === "initialize-storage") {
        const environment = target as RuntimeEnvironment;
        const configuration = JSON.parse(process.env.STORAGE_INITIALIZATION_JSON ?? "null");
        const origin =
          environment === "preview" ? "https://preview.baro.site" : "https://baro.site";
        const health = await fetch(`${origin}/api/health/live`, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        const live = z
          .object({
            status: z.literal("ok"),
            service: z.literal("baro"),
            release: z.string(),
            environment: z.string(),
          })
          .parse(await health.json());
        if (!health.ok || live.release !== sha || live.environment !== environment)
          throw new Error("AI_RUNTIME_SERVING_SHA_MISMATCH");
        const { initializeEmptyStorage } = await import("./initialize-storage");
        result = await initializeEmptyStorage(
          bindings[environment],
          environment,
          observation,
          configuration,
          process.env.AI_RUNTIME_OPERATION_KEY ?? "default",
          sha,
        );
      } else
        result =
          mode === "reallocate"
            ? await provisionAiRuntime(bindings, observation)
            : await observeAiRuntime(
                selected,
                observation,
                mode as "observe" | "refresh",
                process.env.AI_RUNTIME_OPERATION_KEY ?? "default",
              );
      console.log(
        JSON.stringify({
          ...result,
          candidateSha: sha,
          modelBoundsConfigured: false,
          autoRecharge: true,
        }),
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error && /^(AI_RUNTIME|STORAGE_INITIALIZATION)_[A-Z_]+$/.test(error.message)
        ? error.message
        : "AI_RUNTIME_PROVISION_FAILED",
    );
    process.exitCode = 1;
  }
}
