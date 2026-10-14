import { z } from "zod";
import { timestampSchema } from "../../../contracts";
import { type Actor, actorSchema, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { recordExecutionTransport } from "../../db/v2-execution-runtime";
import {
  createV2PaidRuntimeRepository,
  type ExecutionPlan,
  type PaidHoldRequest,
  paidHoldRequestSchema,
  processingArtifactScopeSchema,
  runtimeDigest,
  type UsageReceipt,
  type VerifiedEvidence,
} from "../../db/v2-paid-runtime";
import type { PreparedPaidHold } from "../../db/v2-paid-statements";
import { type JobLease, leaseSchema } from "../../db/v2-workspace";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import {
  authorize,
  type ProcessingCostPermit,
  type ProcessingCosts,
} from "../file-processing/transport";
import { digest } from "../files/binary";
import type { GatewayExecutionBinding } from "./gateway-ledger";

type Input = Parameters<ProcessingCosts["before"]>[0];
async function inputIdentity(input: Input): Promise<string | null> {
  const { wire, ...descriptor } = input;
  let wireHash: string | null = null;
  if (wire) {
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    if (bytes.byteLength > 4 * 1024 * 1024 || bytes.byteLength !== input.byteLength) return null;
    wireHash = await digest(bytes);
    if (wireHash !== input.identity) return null;
  }
  return runtimeDigest({ ...descriptor, wireHash });
}
export type ProcessingAdmission = {
  readonly actor: Actor;
  readonly request: PaidHoldRequest;
  readonly paid: PreparedPaidHold;
  readonly inputDigest: string;
};
const proofSchema = z.strictObject({
  inputDigest: z.string().regex(/^[0-9a-f]{64}$/),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  verifiedAt: timestampSchema,
  validUntil: timestampSchema,
  quantities: z.array(
    z.strictObject({
      sku: z.string(),
      maximumQuantity: z.string(),
    }),
  ),
});

/** Closure-bound producer of paid admissions and actual dispatch receipts. The
 * server supplies authenticated bounds for the exact immutable input: native
 * allocation/stop bound, WAV duration, model wire, or R2 retention/request bound.
 * Missing configuration denies work. No browser proof or implicit free call.
 */
export function createProcessingBudgetService(options: {
  core: V2Core;
  environment: "preview" | "production";
  ownerId: string;
  clock?: () => string;
  /** Durable admission already attached by the server transaction. Its stored
   * immutable invocation is matched before reuse across a Workflow restart. */
  initialAttemptId?: string;
  binding: (now: string) => Promise<GatewayExecutionBinding | null>;
  bounds?: (
    input: Readonly<Input>,
    inputDigest: string,
    now: string,
  ) => Promise<{
    inputDigest: string;
    evidenceHash: string;
    verifiedAt: string;
    validUntil: string;
    quantities: ExecutionPlan["quantities"];
  } | null>;
  /** Authenticate actual provider billing evidence. A local completion or
   * estimated elapsed time cannot produce this receipt. */
  metering?: (
    request: PaidHoldRequest,
    permit: ProcessingCostPermit,
    transport: Parameters<ProcessingCosts["after"]>[1],
    now: string,
  ) => Promise<{ receipt: UsageReceipt; evidence: VerifiedEvidence } | null>;
}) {
  const actor = (): Actor =>
    actorSchema.parse({
      ownerId: options.ownerId,
      now: (options.clock ?? (() => new Date().toISOString()))(),
    });
  actor();
  const executions = new Map<string, VerifiedEvidence>();
  const receipts = new Map<string, VerifiedEvidence>();
  const admissions = new WeakSet<object>();
  let pendingPersisted = options.initialAttemptId;
  const runtime = createV2PaidRuntimeRepository(
    options.core,
    options.environment,
    async (kind, _payload, hash) =>
      kind === "execution"
        ? (executions.get(hash) ?? null)
        : kind === "usage"
          ? (receipts.get(hash) ?? null)
          : null,
  );

  async function invocationFor(
    input: Input,
    inputDigest: string,
    binding: GatewayExecutionBinding,
  ): Promise<string | null> {
    const invocation = (identity: string) =>
      runtimeDigest({ run: binding.invocationId, inputDigest: identity }).then(
        (id) => `media-${id}`,
      );
    if (input.artifactScope === undefined) return invocation(inputDigest);
    const scope = processingArtifactScopeSchema.safeParse(input.artifactScope);
    if (
      !scope.success ||
      binding.targetKind !== "file" ||
      !(
        (input.service === "model" && input.action === "vision") ||
        (input.service === "asr" && input.action === "asr")
      )
    )
      return null;
    const { artifactScope: _scope, ...legacyInput } = input;
    const legacyDigest = await inputIdentity(legacyInput);
    if (!legacyDigest) return null;
    const legacyInvocation = await invocation(legacyDigest);
    const row = await options.core
      .statement(
        `SELECT p.payload_json,p.digest,h.state,
         (EXISTS(SELECT 1 FROM v2_execution_admissions a WHERE a.attempt_id=h.attempt_id AND a.state='final' AND a.transport='response')
          OR EXISTS(SELECT 1 FROM v2_runtime_usage u WHERE u.attempt_id=h.attempt_id AND u.outcome='settled' AND json_extract(u.payload_json,'$.transport')='response' AND json_extract(u.payload_json,'$.dispatchToken')=h.dispatch_token)) AS responded
         FROM v2_execution_job_plans p JOIN v2_execution_job_holds h ON h.plan_id=p.id
         WHERE p.invocation_id=? AND h.job_id=?`,
        [legacyInvocation, binding.jobId],
      )
      .first<{ payload_json: string; digest: string; state: string; responded: number }>();
    // The first caller must compete with old and new callers through the SAME
    // legacy invocation CAS. Its immutable request records which position won.
    if (!row) return legacyInvocation;
    const parsed = paidHoldRequestSchema.safeParse(JSON.parse(row.payload_json));
    if (!parsed.success) return null;
    const saved = parsed.data;
    if (
      (await runtimeDigest(saved)) !== row.digest ||
      saved.jobId !== binding.jobId ||
      saved.attempt !== 1 ||
      saved.plan.maximumAttempts !== 1 ||
      saved.plan.invocationId !== legacyInvocation ||
      saved.plan.operationId !== binding.operationId ||
      saved.plan.operationRevision !== binding.operationRevision ||
      saved.plan.requestHash !== binding.requestHash ||
      saved.targetKind !== binding.targetKind ||
      saved.targetId !== binding.targetId ||
      saved.targetRevision !== binding.targetRevision ||
      saved.service !== input.service ||
      !saved.artifactScope
    )
      return null;
    if (
      saved.artifactScope.unit === scope.data.unit &&
      saved.artifactScope.index === scope.data.index
    )
      return legacyInvocation;
    // A response before the result checkpoint never frees the SAME position.
    // Only immutable evidence of a different completed position permits another
    // invocation. Historical unscoped or unresolved records remain untouched;
    // they require an explicit user retry with a new runtime.
    return row.state === "final" && row.responded === 1 ? invocation(inputDigest) : null;
  }

  async function prepareInitial(input: Input): Promise<ProcessingAdmission | null> {
    const a = actor();
    const immutable = JSON.parse(JSON.stringify(input)) as Input;
    if (
      !Number.isSafeInteger(immutable.byteLength) ||
      immutable.byteLength < 1 ||
      immutable.byteLength > 1_000_000_000 ||
      !immutable.identity ||
      immutable.identity.length > 256 ||
      (immutable.durationSeconds !== null &&
        (!Number.isFinite(immutable.durationSeconds) || immutable.durationSeconds <= 0))
    )
      return null;
    const inputDigest = await inputIdentity(immutable);
    if (!inputDigest) return null;
    const binding = await options.binding(a.now);
    if (!binding || !options.bounds) return null;
    const invocationId = await invocationFor(immutable, inputDigest, binding);
    if (!invocationId) return null;
    const parsed = proofSchema.safeParse(await options.bounds(immutable, inputDigest, a.now));
    if (!parsed.success) return null;
    const proof = parsed.data;
    if (
      proof.inputDigest !== inputDigest ||
      Date.parse(proof.verifiedAt) > Date.parse(a.now) ||
      Date.parse(proof.validUntil) < Date.parse(binding.deadlineAt) ||
      Date.parse(binding.deadlineAt) <= Date.parse(a.now)
    )
      return null;
    const parsedRequest = paidHoldRequestSchema.safeParse({
      attemptId: crypto.randomUUID(),
      quoteId: options.core.applicationCostLimitsEnabled ? crypto.randomUUID() : null,
      planId: crypto.randomUUID(),
      pricingProofId: binding.pricingProofId,
      fundingProofId: binding.fundingProofId,
      attempt: 1,
      service: immutable.action === "r2_get" ? "requests" : immutable.service,
      jobId: binding.jobId,
      targetKind: binding.targetKind,
      targetId: binding.targetId,
      targetRevision: binding.targetRevision,
      ...(immutable.artifactScope ? { artifactScope: immutable.artifactScope } : {}),
      plan: {
        operationId: binding.operationId,
        operationRevision: binding.operationRevision,
        requestHash: binding.requestHash,
        // Stable within the server's run and immutable action. Workflow replay
        // cannot turn an unresolved call into a fresh billing invocation.
        invocationId,
        maximumAttempts: 1,
        deadlineAt: binding.deadlineAt,
        quantities: proof.quantities,
      },
    });
    if (!parsedRequest.success) return null;
    const request = parsedRequest.data;
    const hash = await runtimeDigest(request);
    executions.set(hash, {
      digest: hash,
      evidenceHash: proof.evidenceHash,
      method: "authenticated_coordinator",
      verifiedAt: proof.verifiedAt,
    });
    let paid: PreparedPaidHold | null;
    try {
      paid = await runtime.prepareHold(a, request);
    } finally {
      executions.delete(hash);
    }
    if (!paid) return null;
    const result = Object.freeze({
      actor: Object.freeze(a),
      request: paid.request,
      paid,
      inputDigest,
    });
    admissions.add(result);
    return result;
  }

  function costs(lease: JobLease, initial?: ProcessingAdmission): ProcessingCosts {
    leaseSchema.parse(lease);
    let pendingInitial = initial;
    const issued = new WeakMap<object, { request: PaidHoldRequest; observed: boolean }>();
    return {
      async before(input, access) {
        if (!(await authorize(access))) return null;
        let request: PaidHoldRequest | null = null;
        if (!pendingInitial && pendingPersisted) {
          const a = actor();
          const binding = await options.binding(a.now);
          const identity = await inputIdentity(input);
          const row = await options.core
            .statement(
              `SELECT p.payload_json,p.digest FROM v2_execution_job_holds h JOIN v2_execution_job_plans p ON p.id=h.plan_id
             WHERE h.attempt_id=? AND h.job_id=? AND h.state='prepared'`,
              [pendingPersisted, lease.jobId],
            )
            .first<{ payload_json: string; digest: string }>();
          if (row && binding && identity) {
            const parsed = paidHoldRequestSchema.safeParse(JSON.parse(row.payload_json));
            if (parsed.success) {
              const candidate = parsed.data;
              if (
                candidate.attemptId === pendingPersisted &&
                candidate.jobId === lease.jobId &&
                candidate.plan.operationId === binding.operationId &&
                candidate.plan.operationRevision === binding.operationRevision &&
                candidate.plan.requestHash === binding.requestHash &&
                candidate.targetKind === binding.targetKind &&
                candidate.targetId === binding.targetId &&
                candidate.targetRevision === binding.targetRevision &&
                candidate.pricingProofId === binding.pricingProofId &&
                candidate.fundingProofId === binding.fundingProofId &&
                candidate.service === (input.action === "r2_get" ? "requests" : input.service) &&
                candidate.plan.invocationId ===
                  `media-${await runtimeDigest({ run: binding.invocationId, inputDigest: identity })}` &&
                (await runtimeDigest(candidate)) === row.digest
              ) {
                request = candidate;
                pendingPersisted = undefined;
              }
            }
          }
          if (row && !request) return null;
        }
        let admission: ProcessingAdmission | null;
        if (pendingInitial) {
          if (
            !admissions.has(pendingInitial) ||
            pendingInitial.request.jobId !== lease.jobId ||
            pendingInitial.inputDigest !== (await inputIdentity(input))
          )
            return null;
          admission = pendingInitial;
          pendingInitial = undefined;
          request = admission.request;
        } else if (!request) {
          admission = await prepareInitial(input);
          if (
            !admission ||
            admission.request.jobId !== lease.jobId ||
            !(await authorize(access)) ||
            !(await runtime.reserveAttempt(admission.actor, lease, admission.paid))
          )
            return null;
          request = admission.request;
        }
        if (!(await authorize(access))) return null;
        if (!request) return null;
        const dispatch = await runtime.beforeDispatch(actor(), lease, request.attemptId);
        if (!dispatch || !(await authorize(access))) return null;
        const permit: ProcessingCostPermit = Object.freeze({
          attemptId: dispatch.attemptId,
          dispatchToken: dispatch.dispatchToken,
        });
        issued.set(permit, { request, observed: false });
        return permit;
      },
      async after(permit, receipt) {
        const issuedPermit = issued.get(permit);
        if (!issuedPermit || issuedPermit.observed) return;
        // Native elapsed time and local R2 completion are not billing evidence.
        // Until authenticated metering arrives, including late ASR/model output,
        // retain the complete reservation instead of guessing token/CPU costs.
        const a = actor();
        try {
          await recordExecutionTransport(options.core, {
            attemptId: permit.attemptId,
            dispatchToken: permit.dispatchToken,
            transport: receipt.transport,
            observedAt: a.now,
          });
        } catch (error) {
          if (
            options.core.applicationCostLimitsEnabled ||
            !(error instanceof V2RepositoryError) ||
            error.code !== "DB_OPERATION_FAILED"
          )
            throw error;
          reportDependencyFailure(error);
        }
        let metered: Awaited<ReturnType<NonNullable<typeof options.metering>>> | undefined;
        try {
          metered = await options.metering?.(issuedPermit.request, permit, receipt, a.now);
        } catch (error) {
          if (
            options.core.applicationCostLimitsEnabled ||
            !(error instanceof V2RepositoryError) ||
            error.code !== "DB_OPERATION_FAILED"
          )
            throw error;
          reportDependencyFailure(error);
          return;
        }
        if (!metered) return;
        const r = metered.receipt;
        if (
          r.attemptId !== issuedPermit.request.attemptId ||
          r.invocationId !== issuedPermit.request.plan.invocationId ||
          r.dispatchToken !== permit.dispatchToken
        )
          return;
        const hash = await runtimeDigest(r);
        if (metered.evidence.digest !== hash) return;
        receipts.set(hash, metered.evidence);
        try {
          if (await runtime.recordUsage(r, a.now)) issuedPermit.observed = true;
        } catch (error) {
          if (
            options.core.applicationCostLimitsEnabled ||
            !(error instanceof V2RepositoryError) ||
            error.code !== "DB_OPERATION_FAILED"
          )
            throw error;
          reportDependencyFailure(error);
        } finally {
          receipts.delete(hash);
        }
      },
    };
  }
  return { prepareInitial, costs };
}
