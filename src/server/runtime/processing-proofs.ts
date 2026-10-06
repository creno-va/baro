import { usageDateKst } from "../db/repository";
import type { V2Core } from "../db/v2-core";

/** Proofs are installed by the authenticated deployment coordinator. This reader
 * cannot manufacture funding or activate a budget from an HTTP request. */
export async function readProcessingProofs(
  core: V2Core,
  environment: "preview" | "production",
  now: string,
) {
  return core
    .statement(
      `SELECT pricing.id AS pricingProofId,funding.id AS fundingProofId,c.allocation_proof_id AS allocationProofId
    FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment
    JOIN v2_runtime_proofs allocation ON allocation.id=c.allocation_proof_id AND allocation.kind='allocation'
    JOIN v2_runtime_proofs pricing ON pricing.environment=c.environment AND pricing.kind='pricing'
    JOIN v2_runtime_proofs funding ON funding.environment=c.environment AND funding.kind='funding'
    WHERE c.environment=? AND c.phase='active' AND c.month=substr(?,1,7)
    AND allocation.verified_at<=? AND allocation.valid_until>? AND pricing.verified_at<=? AND pricing.valid_until>?
    AND funding.verified_at<=? AND funding.valid_until>?
    AND EXISTS(SELECT 1 FROM json_each(pricing.payload_json,'$.prices') WHERE json_extract(value,'$.sku')='container_cpu_seconds')
    ORDER BY pricing.verified_at DESC,funding.verified_at DESC,pricing.id,funding.id LIMIT 1`,
      [environment, usageDateKst(now), now, now, now, now, now, now],
    )
    .first<{
      pricingProofId: string;
      fundingProofId: string;
      allocationProofId: string;
    }>();
}
