import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import { usageDateKst } from "../../db/repository";
import { type Actor, actorSchema, hashSchema, type V2Core } from "../../db/v2-core";
import {
  executionPlanSchema,
  fundingProofSchema,
  pricingProofSchema,
  type UsageReceipt,
  usageReceiptSchema,
  type VerifiedEvidence,
} from "../../db/v2-paid-contracts";
import {
  allocationProofSchema,
  createV2PaidRuntimeRepository,
  runtimeDigest,
} from "../../db/v2-paid-runtime";
import {
  type StoragePaidHoldRequest,
  storagePaidHoldRequestSchema,
} from "../../db/v2-storage-paid-contracts";
import {
  createV2StoragePaidRuntimeRepository,
  type PreparedStoragePaidHold,
} from "../../db/v2-storage-paid-runtime";

const descriptorSchema = z.strictObject({
  runId: opaqueIdSchema,
  maximumAttempts: z.number().int().min(1).max(3),
  deadlineAt: timestampSchema,
  action: z.enum(["r2_put", "public_copy"]),
  service: z.enum(["requests", "storage"]),
  operationId: opaqueIdSchema,
  operationRevision: revisionSchema,
  requestHash: hashSchema,
  targetKind: storagePaidHoldRequestSchema.shape.targetKind,
  targetId: opaqueIdSchema,
  targetRevision: revisionSchema,
  reservationId: opaqueIdSchema,
  blobId: opaqueIdSchema,
  pending: storagePaidHoldRequestSchema.shape.pending,
  intent: storagePaidHoldRequestSchema.shape.intent,
});
export const storageCostInputSchema = descriptorSchema.extend({
  attemptOrdinal: z.number().int().min(1).max(3),
});
export type StorageCostInput = z.infer<typeof storageCostInputSchema>;
const boundsSchema = z.strictObject({
  inputDigest: hashSchema,
  evidenceHash: hashSchema,
  verifiedAt: timestampSchema,
  validUntil: timestampSchema,
  quantities: executionPlanSchema.shape.quantities,
});
export type StorageBounds = z.infer<typeof boundsSchema>;
export type StorageAdmission = {
  readonly actor: Readonly<Actor>;
  readonly paid: PreparedStoragePaidHold;
  readonly request: Readonly<StoragePaidHoldRequest>;
  readonly inputDigest: string;
};
export type StoragePermit = {
  readonly attemptId: string;
  readonly dispatchToken: string;
};
const transportSchema = z.strictObject({
  transport: z.enum(["response", "unknown", "not_sent"]),
  definitiveNoCharge: z.boolean(),
  observedAt: timestampSchema,
});
export type StorageTransport = z.infer<typeof transportSchema>;
export interface StorageCosts {
  prepare(input: StorageCostInput): Promise<StorageAdmission | null>;
  beforeDispatch(
    admission: StorageAdmission,
    access: () => Promise<boolean>,
  ): Promise<StoragePermit | null>;
  after(permit: StoragePermit, transport: StorageTransport): Promise<void>;
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}

/** Server-only port. A local PUT/HEAD result is not a billing receipt. The
 * bounds and metering closures authenticate their own provenance; HTTP input
 * cannot inject financial evidence. The caller persists paid.statements with
 * the actual pending intent in one guarded D1 batch using admission.actor. */
export function createStorageBudgetService(options: {
  core: V2Core;
  environment: "preview" | "production";
  ownerId: string;
  clock?: () => string;
  bounds?: (
    input: Readonly<StorageCostInput>,
    inputDigest: string,
    now: string,
  ) => Promise<StorageBounds | null>;
  metering?: (
    request: Readonly<StoragePaidHoldRequest>,
    permit: StoragePermit,
    transport: StorageTransport,
    now: string,
  ) => Promise<{ receipt: UsageReceipt; evidence: VerifiedEvidence } | null>;
}): StorageCosts {
  opaqueIdSchema.parse(options.ownerId);
  const actor = (): Actor =>
    actorSchema.parse({
      ownerId: options.ownerId,
      now: (options.clock ?? (() => new Date().toISOString()))(),
    });
  actor();
  const executions = new Map<string, VerifiedEvidence>();
  const usages = new Map<string, VerifiedEvidence>();
  const runtime = createV2StoragePaidRuntimeRepository(
    options.core,
    options.environment,
    async (kind, _payload, digest) =>
      kind === "execution"
        ? (executions.get(digest) ?? null)
        : kind === "usage"
          ? (usages.get(digest) ?? null)
          : null,
  );
  const proofsRuntime = createV2PaidRuntimeRepository(options.core, options.environment);
  type State = { cutoff: number; allocationId: string; attempted: boolean };
  const admissions = new WeakMap<object, State>();
  const permits = new WeakMap<object, { admission: StorageAdmission; terminal: boolean }>();

  async function proofs(now: string, checkpoint: () => Promise<boolean> = async () => true) {
    const month = usageDateKst(now).slice(0, 7);
    const ids = await options.core
      .statement(
        `SELECT c.allocation_proof_id,
       (SELECT id FROM v2_runtime_proofs WHERE environment=c.environment AND kind='pricing' AND verified_at<=? AND valid_until>? ORDER BY verified_at DESC,id DESC LIMIT 1) AS pricing_id,
       (SELECT id FROM v2_runtime_proofs WHERE environment=c.environment AND kind='funding' AND verified_at<=? AND valid_until>? ORDER BY verified_at DESC,id DESC LIMIT 1) AS funding_id
       FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month
       JOIN v2_budget_allocations a ON a.month=b.month AND a.version=b.allocation_version
       JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id
       WHERE c.month=? AND c.environment=? AND b.environment=c.environment AND c.phase='active'
       AND ap.kind='allocation' AND ap.environment=c.environment AND ap.verified_at<=? AND ap.valid_until>?
       AND json_extract(ap.payload_json,'$.allocation.version')=b.allocation_version
       AND json_extract(ap.payload_json,'$.allocation.manifestHash')=a.manifest_hash
       AND a.reviewed_at<=? AND a.valid_until>? AND a.funding_valid_until>?`,
        [now, now, now, now, month, options.environment, now, now, now, now, now],
      )
      .first<{
        allocation_proof_id: string;
        pricing_id: string | null;
        funding_id: string | null;
      }>();
    if (!(await checkpoint()) || !ids?.pricing_id || !ids.funding_id) return null;
    const p = await proofsRuntime.findProof(ids.pricing_id, now);
    if (!(await checkpoint())) return null;
    const f = await proofsRuntime.findProof(ids.funding_id, now);
    if (!(await checkpoint())) return null;
    const a = await proofsRuntime.findProof(ids.allocation_proof_id, now);
    if (
      !(await checkpoint()) ||
      p?.kind !== "pricing" ||
      f?.kind !== "funding" ||
      a?.kind !== "allocation"
    )
      return null;
    const pricing = pricingProofSchema.parse(p.payload),
      funding = fundingProofSchema.parse(f.payload),
      allocation = allocationProofSchema.parse(a.payload);
    const cutoff = Math.min(
      ...[
        p.validUntil,
        f.validUntil,
        a.validUntil,
        pricing.fx.validUntil,
        ...pricing.prices.map((v) => v.validUntil),
        allocation.allocation.validUntil,
        allocation.allocation.fundingValidUntil,
      ].map(Date.parse),
    );
    if (
      pricing.environment !== options.environment ||
      funding.environment !== options.environment ||
      allocation.environment !== options.environment ||
      allocation.allocation.month !== month ||
      funding.state === "unavailable" ||
      funding.spendAllowanceKrw < 1 ||
      Date.parse(funding.observedAt) > Date.parse(now) ||
      Date.parse(pricing.checkedAt) > Date.parse(now) ||
      Date.parse(pricing.fx.asOf) > Date.parse(now) ||
      Date.parse(pricing.fx.checkedAt) > Date.parse(now) ||
      pricing.prices.some((v) => Date.parse(v.checkedAt) > Date.parse(now)) ||
      Date.parse(actor().now) >= cutoff
    )
      return null;
    return { pricingId: p.id, fundingId: f.id, allocationId: a.id, cutoff };
  }
  return {
    async prepare(value) {
      try {
        if (!options.bounds) return null;
        const input = storageCostInputSchema.parse(value),
          a = actor();
        freeze(input);
        if (
          input.attemptOrdinal > input.maximumAttempts ||
          Date.parse(input.deadlineAt) <= Date.parse(a.now) ||
          Date.parse(input.deadlineAt) - Date.parse(a.now) > 300000 ||
          (input.intent.kind === "approved_public_copy") !== (input.action === "public_copy")
        )
          return null;
        const { attemptOrdinal, ...descriptor } = input;
        const inputDigest = await runtimeDigest(descriptor);
        const bounded = boundsSchema.safeParse(await options.bounds(input, inputDigest, a.now));
        if (
          !bounded.success ||
          bounded.data.inputDigest !== inputDigest ||
          Date.parse(bounded.data.verifiedAt) > Date.parse(a.now) ||
          Date.parse(bounded.data.validUntil) < Date.parse(input.deadlineAt) ||
          Date.parse(actor().now) >= Date.parse(input.deadlineAt)
        )
          return null;
        const proof = await proofs(a.now);
        if (!proof || proof.cutoff < Date.parse(input.deadlineAt)) return null;
        const request = storagePaidHoldRequestSchema.parse({
          attemptId: crypto.randomUUID(),
          quoteId: crypto.randomUUID(),
          planId: crypto.randomUUID(),
          pricingProofId: proof.pricingId,
          fundingProofId: proof.fundingId,
          attempt: attemptOrdinal,
          service: input.service,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetRevision: input.targetRevision,
          reservationId: input.reservationId,
          blobId: input.blobId,
          pending: input.pending,
          intent: input.intent,
          plan: {
            operationId: input.operationId,
            operationRevision: input.operationRevision,
            requestHash: input.requestHash,
            invocationId: `storage-${await runtimeDigest({ runId: input.runId, inputDigest })}`,
            maximumAttempts: input.maximumAttempts,
            deadlineAt: input.deadlineAt,
            quantities: bounded.data.quantities,
          },
        });
        const digest = await runtimeDigest(request);
        executions.set(digest, {
          digest,
          evidenceHash: await runtimeDigest({ inputDigest, bounds: bounded.data.evidenceHash }),
          method: "authenticated_coordinator",
          verifiedAt: new Date(bounded.data.verifiedAt).toISOString(),
        });
        let paid: PreparedStoragePaidHold | null;
        try {
          paid = await runtime.prepareHold(a, request);
        } finally {
          executions.delete(digest);
        }
        const cutoff = Math.min(
          proof.cutoff,
          Date.parse(input.deadlineAt),
          Date.parse(bounded.data.validUntil),
        );
        if (!paid || Date.parse(actor().now) >= cutoff) return null;
        const admission = Object.freeze({
          actor: paid.actor,
          paid,
          request: paid.request,
          inputDigest,
        });
        admissions.set(admission, { cutoff, allocationId: proof.allocationId, attempted: false });
        return admission;
      } catch {
        return null;
      }
    },
    async beforeDispatch(admission, access) {
      const state = admissions.get(admission);
      if (!state || state.attempted) return null;
      state.attempted = true;
      const checkpoint = async () => {
        if (Date.parse(actor().now) >= state.cutoff) return false;
        return (await access()) && Date.parse(actor().now) < state.cutoff;
      };
      try {
        if (!(await checkpoint())) return null;
        const proof = await proofs(actor().now, checkpoint);
        if (
          !proof ||
          proof.pricingId !== admission.request.pricingProofId ||
          proof.fundingId !== admission.request.fundingProofId ||
          proof.allocationId !== state.allocationId ||
          !(await checkpoint())
        )
          return null;
        const dispatch = await runtime.beforeDispatch(actor(), admission.request.attemptId);
        if (!(await checkpoint()) || !dispatch) return null;
        const current = await options.core
          .statement(
            `SELECT h.deadline_at,pp.valid_until AS pricing_until,fp.valid_until AS funding_until,ap.valid_until AS allocation_until FROM v2_storage_paid_executions h JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_controls c ON c.month=ca.month JOIN v2_runtime_proofs pp ON pp.id=h.pricing_proof_id JOIN v2_runtime_proofs fp ON fp.id=h.funding_proof_id JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id WHERE h.attempt_id=? AND h.state='dispatched' AND h.dispatch_token=? AND ca.state='reserved' AND c.phase='active' AND c.environment=? AND c.allocation_proof_id=?`,
            [dispatch.attemptId, dispatch.dispatchToken, options.environment, state.allocationId],
          )
          .first<{
            deadline_at: string;
            pricing_until: string;
            funding_until: string;
            allocation_until: string;
          }>();
        if (
          !(await checkpoint()) ||
          !current ||
          Date.parse(actor().now) >= Math.min(...Object.values(current).map(Date.parse))
        )
          return null;
        const permit = Object.freeze({
          attemptId: dispatch.attemptId,
          dispatchToken: dispatch.dispatchToken,
        });
        permits.set(permit, { admission, terminal: false });
        return permit;
      } catch {
        return null;
      }
    },
    async after(permit, value) {
      const issued = permits.get(permit);
      if (!issued || issued.terminal || !options.metering) return;
      const transport = transportSchema.parse(value),
        now = actor().now;
      const actual = await options.metering(issued.admission.request, permit, transport, now);
      if (!actual) return;
      const receipt = usageReceiptSchema.parse(actual.receipt);
      if (
        receipt.attemptId !== permit.attemptId ||
        receipt.invocationId !== issued.admission.request.plan.invocationId ||
        receipt.dispatchToken !== permit.dispatchToken
      )
        return;
      const hash = await runtimeDigest(receipt);
      if (actual.evidence.digest !== hash) return;
      usages.set(hash, actual.evidence);
      try {
        if (await runtime.recordUsage(receipt, actor().now))
          issued.terminal =
            receipt.definitiveNoCharge ||
            receipt.chargedUsd !== null ||
            (receipt.meteringComplete && receipt.transport === "response");
      } finally {
        usages.delete(hash);
      }
    },
  };
}
