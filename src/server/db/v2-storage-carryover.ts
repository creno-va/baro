import { usageDateKst } from "./repository";
import type { V2Core } from "./v2-core";

/** Cold control setup only. The hot upload path never repairs a stale cursor. */
export async function initializeStorageControl(
  core: V2Core,
  environment: "preview" | "production",
  month: string,
  now: string,
): Promise<boolean> {
  const before = await core
    .statement("SELECT cursor_month,revision FROM v2_storage_carryover WHERE id=1 AND version=1")
    .first<{ cursor_month: string; revision: number }>();
  if (!before) throw new Error("STORAGE_CARRYOVER_UNAVAILABLE");
  const trustedMonth = usageDateKst(now).slice(0, 7);
  const results = await core.binding.batch([
    core.statement(
      "INSERT INTO v2_runtime_controls(month,environment,pending_version,updated_at) SELECT month,environment,allocation_version,? FROM v2_monthly_budget WHERE month=? AND environment=? ON CONFLICT(month) DO NOTHING",
      [now, month, environment],
    ),
    core.statement(
      `UPDATE v2_storage_carryover SET cursor_month=?,
       budget_krw=coalesce((SELECT sum(reserved_krw+ambiguous_krw) FROM v2_monthly_budget WHERE month<?),0),
       maintenance_krw=coalesce((SELECT sum(amount_krw) FROM v2_maintenance_exposure WHERE month<? AND state IN ('reserved','ambiguous')),0),revision=revision+1
       WHERE id=1 AND version=1 AND cursor_month=? AND revision=? AND cursor_month<?
       AND ?=? AND ?=strftime('%Y-%m','now','+9 hours')
       AND EXISTS(SELECT 1 FROM v2_monthly_budget b JOIN v2_runtime_controls c ON c.month=b.month AND c.environment=b.environment WHERE b.month=? AND b.environment=? AND (c.pending_version=b.allocation_version OR EXISTS(SELECT 1 FROM v2_runtime_proofs p WHERE p.id=c.allocation_proof_id AND json_extract(p.payload_json,'$.allocation.version')=b.allocation_version)))`,
      [
        month,
        month,
        month,
        before.cursor_month,
        before.revision,
        month,
        month,
        trustedMonth,
        month,
        month,
        environment,
      ],
    ),
    // A failed CAS/readiness check must abort the same batch, including a newly
    // inserted control. This intentionally violates the singleton CHECK/PK.
    core.statement(
      `INSERT INTO v2_storage_carryover(id,cursor_month,budget_krw,maintenance_krw)
       SELECT 1,'invalid',0,0 WHERE NOT EXISTS(SELECT 1 FROM v2_storage_carryover WHERE id=1 AND version=1
       AND (?!=strftime('%Y-%m','now','+9 hours') OR ?!=? OR cursor_month=?))`,
      [month, month, trustedMonth, month],
    ),
  ]);
  // Preserve the original API: true means the frozen control was newly created,
  // not that the summary advanced. Existing active controls are never updated.
  return results[0]?.meta.changes === 1;
}
