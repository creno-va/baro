import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { usageDateKst } from "./repository";
import { parse, safe, type V2Core } from "./v2-core";
import {
  type ExecutionPlan,
  estimatePlanKrw,
  fundingProofSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import {
  allocationProofSchema,
  createV2PaidRuntimeRepository,
  runtimeDigest,
} from "./v2-paid-runtime";
import { carryoverSql } from "./v2-paid-statements";

export const runtimeRefreshSchema = z.strictObject({
  id: opaqueIdSchema,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  expectedControlRevision: z.number().int().positive(),
  allocationVersion: z.number().int().positive(),
  allocationProofId: opaqueIdSchema,
  pricingProofId: opaqueIdSchema,
  fundingProofId: opaqueIdSchema,
});
export type RuntimeRefresh = z.infer<typeof runtimeRefreshSchema>;
const claimGuard = "EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)";

/** Trusted operations only; never mounted on a user API. No drain, quota,
 * hold release, job cancellation or allocation mutation is performed here. */
export function createV2RuntimeRefreshRepository(
  core: V2Core,
  environment: "preview" | "production",
  verify?: RuntimeProofVerifier,
) {
  const proofs = createV2PaidRuntimeRepository(core, environment);
  return {
    refresh(input: RuntimeRefresh, now: string) {
      return safe(async () => {
        const request = parse(runtimeRefreshSchema, input);
        now = new Date(parse(timestampSchema, now)).toISOString();
        if (!verify) return false;
        const requestDigest = await runtimeDigest({ environment, request });
        const committed = await core
          .statement(
            "SELECT request_digest FROM v2_runtime_refreshes WHERE id=? AND environment=?",
            [request.id, environment],
          )
          .first<string>("request_digest");
        // A committed receipt describes this operation, not current availability.
        if (committed) return committed === requestDigest;
        if (request.month !== usageDateKst(now).slice(0, 7)) return false;
        const [pr, fr, allocationRow, storage] = await Promise.all([
          proofs.findProof(request.pricingProofId, now),
          proofs.findProof(request.fundingProofId, now),
          core
            .statement(
              "SELECT payload_json,digest FROM v2_runtime_proofs WHERE id=? AND kind='allocation' AND environment=? AND verified_at<=?",
              [request.allocationProofId, environment, now],
            )
            .first<{ payload_json: string; digest: string }>(),
          core
            .statement("SELECT * FROM v2_storage_projections WHERE environment=? AND month=?", [
              environment,
              request.month,
            ])
            .first<{
              id: string;
              payload_json: string;
              digest: string;
              capacity_bytes: number;
              gets: number;
              heads: number;
              deletes: number;
            }>(),
        ]);
        if (
          pr?.kind !== "pricing" ||
          fr?.kind !== "funding" ||
          !allocationRow ||
          (await runtimeDigest(JSON.parse(allocationRow.payload_json))) !== allocationRow.digest
        )
          return false;
        const ar = allocationRow.payload_json;
        const pricing = parse(pricingProofSchema, pr.payload),
          funding = parse(fundingProofSchema, fr.payload),
          allocation = parse(allocationProofSchema, JSON.parse(ar));
        if (
          allocation.allocation.month !== request.month ||
          allocation.allocation.version !== request.allocationVersion ||
          funding.state === "unavailable" ||
          Date.parse(funding.observedAt) > Date.parse(now) ||
          Date.parse(pricing.fx.asOf) > Date.parse(now)
        )
          return false;
        const monthEnd = new Date(
          Date.UTC(Number(request.month.slice(0, 4)), Number(request.month.slice(5, 7)), 1) -
            9 * 3600000,
        ).toISOString();
        const validUntil = new Date(
          Math.min(
            ...[
              monthEnd,
              fr.validUntil,
              pricing.validUntil,
              pricing.fx.validUntil,
              ...pricing.prices.map((p) => p.validUntil),
            ].map(Date.parse),
          ),
        ).toISOString();
        if (
          Date.parse(validUntil) <= Date.parse(now) ||
          [pricing, pricing.fx, ...pricing.prices].some(
            (p) => Date.parse(p.checkedAt) > Date.parse(now),
          )
        )
          return false;
        let maintenanceKrw = 0,
          projectionJson = "",
          projectionDigest = "";
        if (storage) {
          const prior = JSON.parse(storage.payload_json) as {
            input: Record<string, unknown>;
            quantities: ExecutionPlan["quantities"];
            allocationJson: string;
          };
          if (prior.allocationJson !== ar) return false;
          // Reserve a fresh full conservative ceiling; earlier maintenance
          // exposure remains intact. Neither IO counters nor limits reset.
          maintenanceKrw = estimatePlanKrw(pricing, prior.quantities);
          if (
            maintenanceKrw < 1 ||
            (core.applicationCostLimitsEnabled && maintenanceKrw > 1000000) ||
            prior.quantities.some((q) => {
              const p = pricing.prices.find((v) => v.sku === q.sku);
              return (
                p?.provider !== "cloudflare" ||
                p.billingMode !== "metered" ||
                (q.sku.startsWith("r2_") && p.plan !== "standard")
              );
            })
          )
            return false;
          projectionJson = JSON.stringify({
            ...prior,
            input: {
              ...prior.input,
              pricingProofId: request.pricingProofId,
              fundingProofId: request.fundingProofId,
              expectedControlRevision: request.expectedControlRevision,
            },
            reservedKrw: maintenanceKrw,
            pricingJson: JSON.stringify(pricing),
            fundingJson: JSON.stringify(funding),
            validUntil,
          });
          projectionDigest = await runtimeDigest(JSON.parse(projectionJson));
        }
        const payload = {
          kind: "same-allocation-refresh",
          environment,
          request,
          validUntil,
          priorProjection: storage?.payload_json ?? null,
          projection: projectionJson || null,
          maintenanceKrw,
          projectionDigest,
        };
        const payloadJson = JSON.stringify(payload),
          digest = await runtimeDigest({
            ...payload,
            priorProjection: storage?.digest ?? null,
            projection: projectionDigest || null,
          });
        if (new TextEncoder().encode(payloadJson).byteLength > 1048576) return false;
        const evidence = await verify("maintenance", payload, digest);
        if (!evidence) return false;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.method !== "authenticated_coordinator" ||
          e.digest !== digest ||
          Date.parse(e.verifiedAt) > Date.parse(now) ||
          Date.parse(e.verifiedAt) >= Date.parse(validUntil)
        )
          return false;
        const claim = crypto.randomUUID();
        const a = allocation.allocation;
        const storageGuard = storage
          ? "EXISTS(SELECT 1 FROM v2_storage_projections s JOIN v2_physical_storage_capacity cap ON cap.environment=s.environment JOIN v2_physical_storage_totals total ON total.environment=cap.environment WHERE s.environment=c.environment AND s.month=c.month AND s.id=? AND s.digest=? AND s.gets=? AND s.heads=? AND s.deletes=? AND s.capacity_bytes=cap.capacity_bytes AND cap.held_bytes=total.held_bytes AND cap.held_bytes<=cap.capacity_bytes)"
          : "NOT EXISTS(SELECT 1 FROM v2_storage_projections WHERE environment=c.environment AND month=c.month)";
        const ok = await core.changed([
          core.statement(
            `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision)
            SELECT ?,?,c.month,c.revision FROM v2_runtime_controls c
            JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment
            JOIN v2_budget_allocations a ON a.month=b.month AND a.version=b.allocation_version
            JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id
            JOIN v2_runtime_proofs pp ON pp.id=? JOIN v2_runtime_proofs fp ON fp.id=?
            JOIN v2_storage_funding_heads head ON head.environment=c.environment AND head.proof_id=fp.id AND head.verified_at=fp.verified_at
            WHERE c.month=? AND c.environment=? AND c.revision=? AND c.phase IN ('active','frozen','drained')
              AND (c.pending_version IS NULL OR c.pending_version=b.allocation_version)
              AND b.allocation_version=? AND c.allocation_proof_id=? AND ap.payload_json=?
              AND a.manifest_hash=? AND a.preview_krw=? AND a.production_krw=? AND a.shared_fixed_krw=? AND a.maintenance_reserve_krw=?
              AND pp.kind='pricing' AND fp.kind='funding' AND pp.environment=c.environment AND fp.environment=c.environment
              AND pp.payload_json=? AND fp.payload_json=? AND pp.verified_at<=? AND fp.verified_at<=? AND pp.valid_until>=? AND fp.valid_until>=?
              AND json_extract(fp.payload_json,'$.state') IN ('funded','trial_credit')
              AND (${core.applicationCostLimitsEnabled ? "0" : "1"}=1 OR b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})+?<=json_extract(fp.payload_json,'$.spendAllowanceKrw'))
              AND (?=1 OR b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})+?<=b.limit_krw)
              AND NOT EXISTS(SELECT 1 FROM v2_storage_integrity_faults WHERE environment=c.environment)
              AND ${storageGuard} AND NOT EXISTS(SELECT 1 FROM v2_runtime_refreshes WHERE id=?)`,
            [
              claim,
              environment,
              request.pricingProofId,
              request.fundingProofId,
              request.month,
              environment,
              request.expectedControlRevision,
              request.allocationVersion,
              request.allocationProofId,
              ar,
              a.manifestHash,
              a.previewKrw,
              a.productionKrw,
              a.sharedFixedKrw,
              a.maintenanceReserveKrw,
              JSON.stringify(pricing),
              JSON.stringify(funding),
              now,
              now,
              validUntil,
              validUntil,
              request.month,
              request.month,
              maintenanceKrw,
              core.monthlyBudgetCapEnabled ? 0 : 1,
              request.month,
              request.month,
              maintenanceKrw,
              ...(storage
                ? [storage.id, storage.digest, storage.gets, storage.heads, storage.deletes]
                : []),
              request.id,
            ],
          ),
          core.statement(
            `INSERT INTO v2_runtime_refreshes(id,month,environment,control_revision,allocation_version,allocation_proof_id,pricing_proof_id,funding_proof_id,request_digest,payload_json,evidence_hash,created_at,valid_until) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${claimGuard}`,
            [
              request.id,
              request.month,
              environment,
              request.expectedControlRevision + 1,
              request.allocationVersion,
              request.allocationProofId,
              request.pricingProofId,
              request.fundingProofId,
              requestDigest,
              payloadJson,
              e.evidenceHash,
              now,
              validUntil,
              claim,
            ],
          ),
          ...(storage
            ? [
                core.statement(
                  `INSERT INTO v2_maintenance_exposure(id,month,reference_hash,amount_krw,state,created_at) SELECT ?,?,?,?,'reserved',? WHERE ${claimGuard}`,
                  [request.id, request.month, projectionDigest, maintenanceKrw, now, claim],
                ),
                core.statement(
                  `INSERT INTO v2_maintenance_evidence(id,maintenance_id,action,digest,payload_json,evidence_hash,verified_at) SELECT ?,?,'record',?,?,?,? WHERE ${claimGuard}`,
                  [
                    crypto.randomUUID(),
                    request.id,
                    projectionDigest,
                    projectionJson,
                    e.evidenceHash,
                    e.verifiedAt,
                    claim,
                  ],
                ),
                core.statement(
                  `UPDATE v2_storage_projections SET payload_json=?,digest=?,pricing_proof_id=?,funding_proof_id=?,maintenance_id=?,reserved_krw=?,created_at=?,valid_until=? WHERE environment=? AND month=? AND ${claimGuard}`,
                  [
                    projectionJson,
                    projectionDigest,
                    request.pricingProofId,
                    request.fundingProofId,
                    request.id,
                    maintenanceKrw,
                    now,
                    validUntil,
                    environment,
                    request.month,
                    claim,
                  ],
                ),
              ]
            : []),
          core.statement(
            `UPDATE v2_monthly_budget SET fixed_maintenance_krw=fixed_maintenance_krw+? WHERE month=? AND environment=? AND ${claimGuard}`,
            [maintenanceKrw, request.month, environment, claim],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='active',pending_version=NULL,local_drain_id=NULL,revision=revision+1,updated_at=? WHERE month=? AND environment=? AND ${claimGuard}`,
            [now, request.month, environment, claim],
          ),
          core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [claim]),
        ]);
        // A concurrent identical request may have committed while we waited.
        return (
          ok ||
          (await core
            .statement(
              "SELECT request_digest FROM v2_runtime_refreshes WHERE id=? AND environment=?",
              [request.id, environment],
            )
            .first<string>("request_digest")) === requestDigest
        );
      });
    },
  };
}
