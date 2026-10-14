import { usageDateKst } from "../db/repository";
import type { V2Core } from "../db/v2-core";
import { allocationUntilSql } from "../db/v2-runtime-authority";

/** Proofs are installed by the authenticated deployment coordinator. This reader
 * cannot manufacture funding or activate a budget from an HTTP request. */
export async function readProcessingProofs(
  core: V2Core,
  environment: "preview" | "production",
  now: string,
  sku: string | null = "container_cpu_seconds",
) {
  if (!core.applicationCostLimitsEnabled) {
    // Each existing observation is independent. Missing pricing, SKU, FX or
    // funding never becomes a fabricated proof or an execution prerequisite.
    try {
      const row = await core
        .statement(
          `SELECT
        (SELECT id FROM v2_runtime_proofs WHERE environment=? AND kind='pricing' AND verified_at<=? ORDER BY verified_at DESC,id DESC LIMIT 1) AS pricingProofId,
        (SELECT id FROM v2_runtime_proofs WHERE environment=? AND kind='funding' AND verified_at<=? ORDER BY verified_at DESC,id DESC LIMIT 1) AS fundingProofId`,
          [environment, now, environment, now],
        )
        .first<{ pricingProofId: string | null; fundingProofId: string | null }>();
      return {
        pricingProofId: row?.pricingProofId ?? null,
        fundingProofId: row?.fundingProofId ?? null,
        allocationProofId: null,
      };
    } catch {
      return { pricingProofId: null, fundingProofId: null, allocationProofId: null };
    }
  }
  return core
    .statement(
      `SELECT pricing.id AS pricingProofId,funding.id AS fundingProofId,c.allocation_proof_id AS allocationProofId
    FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment
    JOIN v2_runtime_proofs allocation ON allocation.id=c.allocation_proof_id AND allocation.kind='allocation'
    JOIN v2_runtime_proofs pricing ON pricing.environment=c.environment AND pricing.kind='pricing'
    JOIN v2_storage_funding_heads head ON head.environment=c.environment JOIN v2_runtime_proofs funding ON funding.id=head.proof_id AND funding.verified_at=head.verified_at AND funding.environment=c.environment AND funding.kind='funding'
    WHERE c.environment=? AND c.phase='active' AND c.month=substr(?,1,7)
    AND allocation.verified_at<=? AND ${allocationUntilSql("c", "allocation")}>? AND pricing.verified_at<=? AND pricing.valid_until>?
    AND funding.verified_at<=? AND funding.valid_until>?
    AND json_extract(funding.payload_json,'$.state') IN ('funded','trial_credit')
    AND pricing.id=coalesce((SELECT renewal.pricing_proof_id FROM v2_runtime_refreshes renewal WHERE renewal.environment=c.environment AND renewal.month=c.month AND renewal.control_revision=c.revision AND renewal.allocation_proof_id=c.allocation_proof_id),pricing.id)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM json_each(pricing.payload_json,'$.prices') WHERE json_extract(value,'$.sku')=?))
    ORDER BY pricing.verified_at DESC,funding.verified_at DESC,pricing.id,funding.id LIMIT 1`,
      [environment, usageDateKst(now), now, now, now, now, now, now, sku, sku],
    )
    .first<{
      pricingProofId: string;
      fundingProofId: string;
      allocationProofId: string;
    }>();
}
