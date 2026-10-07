import { timestampSchema } from "../../../contracts";
import { usageDateKst } from "../../db/repository";
import type { V2Core } from "../../db/v2-core";
import { allocationProofSchema, createV2PaidRuntimeRepository } from "../../db/v2-paid-runtime";
import { fundingProofSchema, pricingProofSchema } from "./contracts";

/** Advisory display only. No mutation/reservation and no fallback to legacy
 * budgets or free credits. Admission still checks exact per-invocation exposure.
 */
export function createPaidAvailability(
  core: V2Core,
  environment: "preview" | "production",
  options: {
    proofs: () => Promise<{
      pricingProofId: string;
      fundingProofId: string;
      allocationProofId: string;
    } | null>;
    clock?: () => string;
  },
) {
  const runtime = createV2PaidRuntimeRepository(core, environment);
  return async (_snapshotNow?: string) => {
    try {
      const clock = () =>
        new Date(
          timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
        ).toISOString();
      const ids = await options.proofs();
      if (!ids) return false;
      const now = clock();
      const [p, f, a, e] = await Promise.all([
        runtime.findProof(ids.pricingProofId, now),
        runtime.findProof(ids.fundingProofId, now),
        runtime.findProof(ids.allocationProofId, now),
        runtime.exposure(now),
      ]);
      if (
        !p ||
        !f ||
        !a ||
        !e ||
        p.kind !== "pricing" ||
        f.kind !== "funding" ||
        a.kind !== "allocation" ||
        e.phase !== "active"
      )
        return false;
      const pricing = pricingProofSchema.parse(p.payload),
        funding = fundingProofSchema.parse(f.payload),
        allocation = allocationProofSchema.parse(a.payload);
      const cutoff = Math.min(
        ...[
          p.validUntil,
          f.validUntil,
          a.validUntil,
          allocation.allocation.fundingValidUntil,
          pricing.fx.validUntil,
          ...pricing.prices.map((v) => v.validUntil),
        ].map(Date.parse),
      );
      const exposure =
        e.settled_krw +
        e.reserved_krw +
        e.ambiguous_krw +
        e.fixed_maintenance_krw +
        e.carryover_krw;
      const control = await core
        .statement(
          "SELECT allocation_proof_id FROM v2_runtime_controls WHERE month=? AND phase='active' AND environment=?",
          [e.month, environment],
        )
        .first<string>("allocation_proof_id");
      const freshNow = Date.parse(clock());
      return (
        control === ids.allocationProofId &&
        Number.isSafeInteger(exposure) &&
        e.allocation_version === allocation.allocation.version &&
        allocation.environment === environment &&
        allocation.allocation.month === e.month &&
        pricing.environment === environment &&
        e.month === usageDateKst(new Date(freshNow).toISOString()).slice(0, 7) &&
        funding.environment === environment &&
        funding.state !== "unavailable" &&
        pricing.prices.length > 0 &&
        pricing.prices.every(
          (v) => v.billingMode === "metered" && Date.parse(v.checkedAt) <= freshNow,
        ) &&
        Date.parse(pricing.checkedAt) <= freshNow &&
        Date.parse(pricing.fx.checkedAt) <= freshNow &&
        Date.parse(pricing.fx.asOf) <= freshNow &&
        Date.parse(funding.observedAt) <= freshNow &&
        freshNow < cutoff &&
        (!core.monthlyBudgetCapEnabled || exposure < e.limit_krw) &&
        exposure < funding.spendAllowanceKrw
      );
    } catch {
      return false;
    }
  };
}
