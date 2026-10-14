import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { reportDependencyFailure } from "../dependency-diagnostics";
import { type Actor, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import {
  fundingProofSchema,
  paidHoldRequestSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  receiptKrw,
  type UsageReceipt,
  usageReceiptSchema,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import { runtimeDigest } from "./v2-paid-runtime";
import { storagePaidHoldRequestSchema } from "./v2-storage-paid-contracts";
import type { JobLease } from "./v2-workspace";

export async function dispatchExecution(
  core: V2Core,
  environment: string,
  actor: Actor,
  lease: JobLease,
  attemptId: string,
) {
  const present = await core
    .statement("SELECT 1 FROM v2_execution_admissions WHERE attempt_id=?", [attemptId])
    .first();
  if (!present) return undefined;
  const token = crypto.randomUUID(),
    claim = crypto.randomUUID();
  const ok = await core.changed([
    core.statement(
      `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision)
      SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_execution_admissions a
      JOIN v2_jobs j ON j.id=a.job_id JOIN v2_operations o ON o.id=j.operation_id
      JOIN v2_billing_principals p ON p.id=a.principal_id
      WHERE a.attempt_id=? AND a.kind='job' AND a.environment=? AND a.state='prepared'
      AND a.job_id=? AND a.runtime_instance_id=j.runtime_instance_id AND p.owner_id=? AND o.owner_id=p.owner_id AND o.id=a.operation_id
      AND o.revision=a.operation_revision AND o.state='admitted'
      AND j.target_kind=a.target_kind AND j.target_id=a.target_id AND j.target_revision=a.target_revision
      AND j.status IN ('running','validating') AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
      AND a.deadline_at>? AND ${jobAlive}`,
      [
        claim,
        attemptId,
        environment,
        lease.jobId,
        actor.ownerId,
        lease.token,
        lease.fencing,
        actor.now,
        actor.now,
      ],
    ),
    core.statement(
      `UPDATE v2_execution_admissions SET state='dispatched',lease_token=?,fencing=?,dispatch_token=?,dispatched_at=? WHERE attempt_id=? AND ${sqlClaim}`,
      [lease.token, lease.fencing, token, actor.now, attemptId, claim],
    ),
    core.finish(claim),
  ]);
  if (!ok) return null;
  const row = await core
    .statement(
      `SELECT a.plan_id,a.digest,a.payload_json,a.invocation_id,a.attempt
    FROM v2_execution_admissions a JOIN v2_jobs j ON j.id=a.job_id JOIN v2_operations o ON o.id=j.operation_id
    WHERE a.attempt_id=? AND a.dispatch_token=? AND a.runtime_instance_id=j.runtime_instance_id AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
    AND o.owner_id=? AND o.state='admitted' AND o.revision=a.operation_revision AND ${jobAlive}`,
      [attemptId, token, lease.token, lease.fencing, actor.now, actor.ownerId],
    )
    .first<{
      plan_id: string;
      digest: string;
      payload_json: string;
      invocation_id: string;
      attempt: number;
    }>();
  if (!row) return null;
  const request = parse(paidHoldRequestSchema, JSON.parse(row.payload_json));
  return {
    attemptId,
    jobId: lease.jobId,
    leaseToken: lease.token,
    fencing: lease.fencing,
    dispatchToken: token,
    planId: row.plan_id,
    planHash: row.digest,
    pricingProofId: request.pricingProofId,
    fundingProofId: request.fundingProofId,
    quoteId: request.quoteId,
    invocationId: row.invocation_id,
    attempt: row.attempt,
  };
}

/** This is a local transport observation, never provider metering or a charge.
 * Callers hold a closure-issued permit; durable dispatch failure still denies IO. */
export function recordExecutionTransport(
  core: V2Core,
  value: {
    attemptId: string;
    dispatchToken: string | null;
    transport: "response" | "provider_error" | "unknown" | "not_sent";
    observedAt: string;
  },
): Promise<boolean | null> {
  return safe(async () => {
    parse(opaqueIdSchema, value.attemptId);
    if (value.dispatchToken !== null) parse(opaqueIdSchema, value.dispatchToken);
    const observedAt = new Date(parse(timestampSchema, value.observedAt)).toISOString();
    const row = await core
      .statement(
        "SELECT state,dispatch_token,transport,transport_observed_at FROM v2_execution_admissions WHERE attempt_id=?",
        [value.attemptId],
      )
      .first<{
        state: string;
        dispatch_token: string | null;
        transport: string | null;
        transport_observed_at: string | null;
      }>();
    if (!row) return null;
    if (
      row.dispatch_token !== value.dispatchToken ||
      (row.state === "prepared" && value.transport !== "not_sent")
    )
      return false;
    if (row.state === "final") return row.transport === value.transport;
    if (row.transport_observed_at && observedAt < row.transport_observed_at) return false;
    const digest = await runtimeDigest({ ...value, observedAt });
    return (
      (
        await core
          .statement(
            `UPDATE v2_execution_admissions SET state=?,transport=?,transport_observed_at=?,transport_digest=? WHERE attempt_id=? AND state=? AND dispatch_token IS ? AND (transport_observed_at IS NULL OR transport_observed_at<=?)`,
            [
              value.transport === "unknown" ? "unknown" : "final",
              value.transport,
              observedAt,
              digest,
              value.attemptId,
              row.state,
              value.dispatchToken,
              observedAt,
            ],
          )
          .run()
      ).meta.changes === 1
    );
  });
}

/** Returns null only for a historical priced attempt. Technical completion is
 * committed first. Failure to append accounting cannot undo that real result. */
export function recordExecutionUsage(
  core: V2Core,
  verify: RuntimeProofVerifier | undefined,
  receipt: UsageReceipt,
  now: string,
): Promise<boolean | null> {
  return safe(async () => {
    const r = parse(usageReceiptSchema, receipt);
    now = new Date(parse(timestampSchema, now)).toISOString();
    const row = await core
      .statement(
        "SELECT kind,payload_json,digest,environment,state,dispatch_token,transport,transport_digest FROM v2_execution_admissions WHERE attempt_id=?",
        [r.attemptId],
      )
      .first<{
        kind: string;
        payload_json: string;
        digest: string;
        environment: string;
        state: string;
        dispatch_token: string | null;
        transport: string | null;
        transport_digest: string | null;
      }>();
    if (!row) return null;
    if (
      !verify ||
      Date.parse(r.observedAt) > Date.parse(now) ||
      row.dispatch_token !== r.dispatchToken
    )
      return false;
    if (r.definitiveNoCharge) {
      if (r.dispatchToken !== null) return false;
      const unsentDigest = await runtimeDigest({
        attemptId: r.attemptId,
        dispatchToken: null,
        transport: "not_sent",
        observedAt: r.observedAt,
      });
      if (
        row.state !== "prepared" &&
        !(
          row.state === "final" &&
          row.transport === "not_sent" &&
          row.transport_digest === unsentDigest
        )
      )
        return false;
    }
    const request =
      row.kind === "storage"
        ? parse(storagePaidHoldRequestSchema, JSON.parse(row.payload_json))
        : parse(paidHoldRequestSchema, JSON.parse(row.payload_json));
    if (
      (await runtimeDigest(request)) !== row.digest ||
      request.plan.invocationId !== r.invocationId ||
      r.quantities.some((q) => !request.plan.quantities.some((p) => p.sku === q.sku)) ||
      (r.meteringComplete &&
        request.plan.quantities.some((p) => !r.quantities.some((q) => p.sku === q.sku)))
    )
      return false;
    const digest = await runtimeDigest(r),
      raw = await verify("usage", r, digest);
    if (!raw) return false;
    const evidence = parse(verifiedEvidenceSchema, raw);
    if (
      evidence.digest !== digest ||
      Date.parse(evidence.verifiedAt) > Date.parse(now) ||
      Date.parse(evidence.verifiedAt) < Date.parse(r.observedAt) ||
      ![
        "provider_receipt",
        "authenticated_console",
        ...(r.definitiveNoCharge ? ["authenticated_coordinator"] : []),
      ].includes(evidence.method)
    )
      return false;
    if (
      !(await recordExecutionTransport(core, {
        attemptId: r.attemptId,
        dispatchToken: r.dispatchToken,
        transport: r.transport,
        observedAt: r.observedAt,
      }))
    )
      return false;
    try {
      const proofs = await core
        .statement(
          "SELECT id,kind,payload_json,digest,verified_at FROM v2_runtime_proofs WHERE environment=? AND verified_at<=? AND ((kind='pricing' AND id=coalesce(?,(SELECT id FROM v2_runtime_proofs latest WHERE latest.environment=v2_runtime_proofs.environment AND latest.kind='pricing' AND latest.verified_at<=? ORDER BY latest.verified_at DESC,latest.id DESC LIMIT 1))) OR (kind='funding' AND id=coalesce(?,(SELECT id FROM v2_runtime_proofs latest WHERE latest.environment=v2_runtime_proofs.environment AND latest.kind='funding' AND latest.verified_at<=? ORDER BY latest.verified_at DESC,latest.id DESC LIMIT 1))))",
          [
            row.environment,
            r.observedAt,
            request.pricingProofId,
            r.observedAt,
            request.fundingProofId,
            r.observedAt,
          ],
        )
        .all<{
          id: string;
          kind: string;
          payload_json: string;
          digest: string;
          verified_at: string;
        }>();
      let pricingId: string | null = null,
        fundingId: string | null = null,
        pricingStatus = "missing",
        fundingStatus = "missing",
        chargedKrw: number | null = null;
      for (const proof of proofs.results) {
        const value = JSON.parse(proof.payload_json);
        if ((await runtimeDigest(value)) !== proof.digest) continue;
        if (proof.kind === "pricing") {
          const parsed = pricingProofSchema.safeParse(value);
          if (!parsed.success) continue;
          const p = parsed.data;
          pricingId = proof.id;
          const complete = request.plan.quantities.every((q) =>
            p.prices.some((price) => price.sku === q.sku),
          );
          const current =
            [p, p.fx, ...p.prices].every(
              (v) =>
                Date.parse(v.checkedAt) <= Date.parse(r.observedAt) &&
                Date.parse(v.validUntil) > Date.parse(r.observedAt),
            ) && Date.parse(p.fx.asOf) <= Date.parse(r.observedAt);
          pricingStatus = !complete ? "incomplete" : current ? "current" : "stale";
          if (pricingStatus === "current") {
            try {
              chargedKrw = receiptKrw(p, r);
            } catch {
              chargedKrw = null;
            }
          }
        } else {
          const parsed = fundingProofSchema.safeParse(value);
          if (!parsed.success) continue;
          const f = parsed.data;
          fundingId = proof.id;
          fundingStatus =
            Date.parse(f.observedAt) > Date.parse(r.observedAt) ||
            Date.parse(f.validUntil) <= Date.parse(r.observedAt)
              ? "stale"
              : f.state === "unavailable"
                ? "unavailable"
                : "current";
        }
      }
      await core
        .statement(
          `INSERT INTO v2_execution_cost_observations(id,attempt_id,digest,payload_json,evidence_hash,verified_at,observed_at,pricing_proof_id,funding_proof_id,pricing_status,funding_status,charged_usd,charged_krw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id,digest) DO NOTHING`,
          [
            r.id,
            r.attemptId,
            digest,
            JSON.stringify(r),
            evidence.evidenceHash,
            evidence.verifiedAt,
            r.observedAt,
            pricingId,
            fundingId,
            pricingStatus,
            fundingStatus,
            r.chargedUsd,
            chargedKrw,
          ],
        )
        .run();
    } catch (error) {
      reportDependencyFailure(error);
    }
    return true;
  });
}
