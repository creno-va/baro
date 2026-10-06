import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import { v2HashSchema } from "../../../contracts/v2";
import { actorSchema, type V2Core } from "../../db/v2-core";
import { jobAlive } from "../../db/v2-jobs";
import { createV2PaidRuntimeRepository, runtimeDigest } from "../../db/v2-paid-runtime";
import type { PreparedPaidHold } from "../../db/v2-paid-statements";
import { type JobLease, leaseSchema } from "../../db/v2-workspace";
import type {
  GatewayAttemptHandle,
  GatewayAttemptLedger,
  GatewayAttemptRequest,
  GatewayTransportReceipt,
} from "../llm-gateway/attempts";
import { MODEL_ID } from "../llm-gateway/prompts";
import {
  fundingProofSchema,
  type PaidHoldRequest,
  paidHoldRequestSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  type UsageReceipt,
  usageReceiptSchema,
  type VerifiedEvidence,
} from "./contracts";
import { isVerifiedExecution, type VerifiedExecution } from "./execution-plan";
import { BudgetError } from "./service";

const bindingSchema = z.strictObject({
  operationId: opaqueIdSchema,
  operationRevision: revisionSchema,
  requestHash: v2HashSchema,
  jobId: opaqueIdSchema,
  targetKind: z.enum(["workspace", "file", "report", "profile_asset"]),
  targetId: opaqueIdSchema,
  targetRevision: revisionSchema,
  invocationId: opaqueIdSchema,
  maximumAttempts: z.number().int().min(1).max(3),
  deadlineAt: timestampSchema,
  pricingProofId: opaqueIdSchema,
  fundingProofId: opaqueIdSchema,
  allocationProofId: opaqueIdSchema,
});
export type GatewayExecutionBinding = z.infer<typeof bindingSchema>;
export type GatewayAdmission = {
  readonly actor: { ownerId: string; now: string };
  readonly request: PaidHoldRequest;
  readonly paid: PreparedPaidHold;
  readonly execution: VerifiedExecution;
};
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const transportSchema = z.strictObject({
  transport: z.enum(["response", "provider_error", "unknown", "not_sent"]),
  providerRequestId: opaqueIdSchema.nullable(),
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  cacheWriteInputTokens: count,
  serviceTier: z.enum(["default", "flex", "scale", "priority"]).nullable(),
  meteringStatus: z.enum(["complete", "incomplete", "invalid"]),
  observedAt: timestampSchema,
  definitiveNoCharge: z.boolean(),
});

/** Server composition only. The factory never invokes AI, creates resources or
 * accepts HTTP proofs. Execution and usage evidence are private closure-bound;
 * independent pricing/funding/coordinator proofs require the external verifier.
 */
export function createGatewayBudgetService(options: {
  core: V2Core;
  environment: "preview" | "production";
  ownerId: string;
  clock?: () => string;
  verifyEvidence?: RuntimeProofVerifier;
  execution: (request: GatewayAttemptRequest, now: string) => Promise<VerifiedExecution | null>;
}) {
  opaqueIdSchema.parse(options.ownerId);
  const clock = () =>
    new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = () => actorSchema.parse({ ownerId: options.ownerId, now: clock() });
  const executions = new Map<string, VerifiedEvidence>();
  const usages = new Map<string, VerifiedEvidence>();
  const admissions = new WeakSet<object>();
  const verify: RuntimeProofVerifier = async (kind, payload, digest) => {
    if (kind === "execution") return executions.get(digest) ?? null;
    if (kind === "usage") return usages.get(digest) ?? null;
    return options.verifyEvidence?.(kind, payload, digest) ?? null;
  };
  const runtime = createV2PaidRuntimeRepository(options.core, options.environment, verify);

  async function proofs(binding: GatewayExecutionBinding, now: string) {
    const values = await Promise.all([
      runtime.findProof(binding.pricingProofId, now),
      runtime.findProof(binding.fundingProofId, now),
      runtime.findProof(binding.allocationProofId, now),
    ]);
    const [p, f, a] = values;
    if (!p || !f || !a || p.kind !== "pricing" || f.kind !== "funding" || a.kind !== "allocation")
      return null;
    const pricing = pricingProofSchema.parse(p.payload),
      funding = fundingProofSchema.parse(f.payload);
    if (
      pricing.environment !== options.environment ||
      funding.environment !== options.environment ||
      funding.state === "unavailable" ||
      funding.spendAllowanceKrw < 1
    )
      return null;
    const cutoff = Math.min(
      ...[
        p.validUntil,
        f.validUntil,
        a.validUntil,
        pricing.fx.validUntil,
        ...pricing.prices.map((v) => v.validUntil),
      ].map(Date.parse),
    );
    return { pricing, funding, cutoff };
  }
  async function prepare(
    bindingInput: GatewayExecutionBinding,
    request: GatewayAttemptRequest,
    existing?: PaidHoldRequest,
    existingEvidenceHash?: string,
  ): Promise<GatewayAdmission | null> {
    const binding = bindingSchema.parse(bindingInput),
      a = actor();
    if (
      request.invocationId !== binding.invocationId ||
      request.model !== MODEL_ID ||
      request.attemptOrdinal < 1 ||
      request.attemptOrdinal > binding.maximumAttempts
    )
      return null;
    const execution = await options.execution(request, a.now);
    if (!execution || !isVerifiedExecution(execution)) return null;
    if (existing && execution.evidenceHash !== existingEvidenceHash) return null;
    const proof = await proofs(binding, a.now);
    if (
      !proof ||
      proof.cutoff < Date.parse(binding.deadlineAt) ||
      Date.parse(execution.descriptor.validUntil) < Date.parse(binding.deadlineAt)
    )
      return null;
    const r = paidHoldRequestSchema.parse({
      attemptId: existing?.attemptId ?? crypto.randomUUID(),
      quoteId: existing?.quoteId ?? crypto.randomUUID(),
      planId: existing?.planId ?? crypto.randomUUID(),
      pricingProofId: binding.pricingProofId,
      fundingProofId: binding.fundingProofId,
      attempt: request.attemptOrdinal,
      service: "model",
      jobId: binding.jobId,
      targetKind: binding.targetKind,
      targetId: binding.targetId,
      targetRevision: binding.targetRevision,
      plan: {
        operationId: binding.operationId,
        operationRevision: binding.operationRevision,
        requestHash: binding.requestHash,
        invocationId: binding.invocationId,
        maximumAttempts: binding.maximumAttempts,
        deadlineAt: binding.deadlineAt,
        quantities: execution.quantities,
      },
    });
    const digest = await runtimeDigest(r);
    if (existing && digest !== (await runtimeDigest(existing))) return null;
    executions.set(digest, {
      digest,
      evidenceHash: execution.evidenceHash,
      method: "authenticated_coordinator",
      verifiedAt: execution.verifiedAt,
    });
    let paid: PreparedPaidHold | null;
    try {
      paid = await runtime.prepareHold(a, r);
    } finally {
      executions.delete(digest);
    }
    if (
      !paid ||
      Date.parse(clock()) >=
        Math.min(
          proof.cutoff,
          Date.parse(binding.deadlineAt),
          Date.parse(execution.descriptor.validUntil),
        )
    )
      return null;
    const result = Object.freeze({
      actor: Object.freeze(a),
      request: paid.request,
      paid,
      execution,
    });
    admissions.add(result);
    return result;
  }
  return {
    runtime,
    prepareAdmission: prepare,
    async restoreAdmission(
      binding: GatewayExecutionBinding,
      request: GatewayAttemptRequest,
      attemptId: string,
    ) {
      opaqueIdSchema.parse(attemptId);
      const row = await options.core
        .statement(
          "SELECT p.payload_json,p.digest,p.evidence_hash FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_jobs j ON j.id=h.job_id JOIN v2_operations o ON o.id=j.operation_id WHERE h.attempt_id=? AND h.state='prepared' AND o.owner_id=?",
          [attemptId, options.ownerId],
        )
        .first<{ payload_json: string; digest: string; evidence_hash: string }>();
      if (!row) return null;
      const r = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
      if ((await runtimeDigest(r)) !== row.digest) return null;
      return prepare(binding, request, r, row.evidence_hash);
    },
    createLedger(input: {
      binding: GatewayExecutionBinding;
      lease: () => Promise<{ lease: JobLease; expiresAt: string }>;
      initial?: GatewayAdmission;
      waitUntil: (settlement: Promise<void>) => void;
    }): GatewayAttemptLedger {
      const binding = bindingSchema.parse(input.binding);
      if (input.initial && !admissions.has(input.initial))
        throw new BudgetError("BUDGET_UNAVAILABLE");
      type State = {
        admission: GatewayAdmission;
        lease: JobLease;
        expiresAt: string;
        token: string | null;
        confirmed: boolean;
        confirmTried: boolean;
      };
      const attempts = new Map<string, State>();
      let initial = input.initial;
      let preparing = false;
      const stateFor = (handle: GatewayAttemptHandle) => {
        if (handle.invocationId !== binding.invocationId) return null;
        return attempts.get(handle.attemptId) ?? null;
      };
      return {
        async beforeDispatch(request) {
          if (preparing || request.invocationId !== binding.invocationId) return null;
          preparing = true;
          try {
            const lease = await input.lease();
            leaseSchema.parse(lease.lease);
            if (
              lease.lease.jobId !== binding.jobId ||
              Date.parse(lease.expiresAt) <= Date.parse(clock())
            )
              return null;
            let admission: GatewayAdmission | null;
            if (initial) {
              const saved = initial;
              initial = undefined;
              admission = await prepare(
                binding,
                request,
                saved.request,
                saved.execution.evidenceHash,
              );
            } else {
              admission = await prepare(binding, request);
              if (
                !admission ||
                !(await runtime.reserveAttempt(admission.actor, lease.lease, admission.paid))
              )
                return null;
            }
            if (!admission) return null;
            attempts.set(admission.request.attemptId, {
              admission,
              lease: lease.lease,
              expiresAt: new Date(lease.expiresAt).toISOString(),
              token: null,
              confirmed: false,
              confirmTried: false,
            });
            return { invocationId: binding.invocationId, attemptId: admission.request.attemptId };
          } finally {
            preparing = false;
          }
        },
        async confirmDispatch(handle) {
          const state = stateFor(handle);
          if (!state || state.confirmTried) return false;
          state.confirmTried = true;
          const p = await proofs(binding, clock());
          if (!p) return false;
          const cutoff = Math.min(
            p.cutoff,
            Date.parse(state.expiresAt),
            Date.parse(binding.deadlineAt),
            Date.parse(state.admission.execution.descriptor.validUntil),
          );
          if (Date.parse(clock()) >= cutoff) return false;
          const dispatched = await runtime.beforeDispatch(actor(), state.lease, handle.attemptId);
          if (!dispatched) return false;
          state.token = dispatched.dispatchToken;
          const current = await options.core
            .statement(
              `SELECT j.lease_until,p.deadline_at,pp.valid_until AS pricing_until,fp.valid_until AS funding_until,ap.valid_until AS allocation_until FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_paid_holds h ON h.job_id=j.id JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_controls c ON c.month=ca.month JOIN v2_runtime_proofs pp ON pp.id=p.pricing_proof_id JOIN v2_runtime_proofs fp ON fp.id=p.funding_proof_id JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id WHERE h.attempt_id=? AND h.dispatch_token=? AND j.lease_token=? AND j.fencing=? AND j.status IN ('running','validating') AND o.owner_id=? AND o.state='admitted' AND p.operation_revision=o.revision AND c.phase='active' AND c.environment=? AND ${jobAlive}`,
              [
                handle.attemptId,
                state.token,
                state.lease.token,
                state.lease.fencing,
                options.ownerId,
                options.environment,
              ],
            )
            .first<{
              lease_until: string;
              deadline_at: string;
              pricing_until: string;
              funding_until: string;
              allocation_until: string;
            }>();
          // A committed dispatch never becomes locally refundable if time advances
          // while D1 awaits. The subsequent not_sent receipt must fail the DB CAS.
          if (
            !current ||
            Date.parse(clock()) >= Math.min(cutoff, ...Object.values(current).map(Date.parse))
          )
            return false;
          state.confirmed = true;
          return true;
        },
        async afterTransport(handle, value: GatewayTransportReceipt) {
          const state = stateFor(handle);
          if (!state) throw new BudgetError("INVALID_RECEIPT");
          const transport = transportSchema.parse(value),
            now = clock();
          if (transport.transport !== "not_sent" && !state.confirmed)
            throw new BudgetError("INVALID_RECEIPT");
          const quantities: UsageReceipt["quantities"] = [];
          if (transport.inputTokens !== null)
            quantities.push({ sku: "model_input_tokens", quantity: String(transport.inputTokens) });
          if (transport.outputTokens !== null)
            quantities.push({
              sku: "model_output_tokens",
              quantity: String(transport.outputTokens),
            });
          const receipt = usageReceiptSchema.parse({
            id: crypto.randomUUID(),
            attemptId: handle.attemptId,
            invocationId: binding.invocationId,
            providerRequestId: transport.providerRequestId,
            dispatchToken: state.token,
            observedAt: new Date(transport.observedAt).toISOString(),
            transport: transport.transport,
            definitiveNoCharge: transport.definitiveNoCharge,
            meteringComplete: transport.meteringStatus === "complete" && quantities.length === 2,
            quantities,
            chargedUsd: null,
            modelTokenDetails: {
              cachedInputTokens: transport.cachedInputTokens,
              cacheWriteInputTokens: transport.cacheWriteInputTokens,
              serviceTier: transport.serviceTier,
            },
          });
          const digest = await runtimeDigest(receipt);
          usages.set(digest, {
            digest,
            evidenceHash: digest,
            method: receipt.definitiveNoCharge ? "authenticated_coordinator" : "provider_receipt",
            verifiedAt: now,
          });
          try {
            if (!(await runtime.recordUsage(receipt, now)))
              throw new BudgetError("BUDGET_UNAVAILABLE");
          } finally {
            usages.delete(digest);
          }
        },
        waitUntil: input.waitUntil,
      };
    },
  };
}
