import { createCaseDataCipher } from "../crypto";
import { usageDateKst } from "../db/repository";
import { createV2Core } from "../db/v2-core";
import { createFileProcessingDispatcher } from "../modules/file-processing/dispatch";
import { createProfilePublicationDispatcher } from "../modules/lawyers/publication-dispatch";

/** Scheduled recovery only dispatches admitted immutable IDs. The coordinator
 * must have activated real funding, including fixed platform maintenance. */
export async function reconcileV2Dispatch(env: Env) {
  try {
    const now = new Date().toISOString();
    const core = createV2Core(env.DB, await createCaseDataCipher(env));
    const environment = env.APP_ENV === "production" ? "production" : "preview";
    const control = await core
      .statement(
        `SELECT c.month FROM v2_runtime_controls c
      JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment
      JOIN v2_runtime_proofs allocation ON allocation.id=c.allocation_proof_id AND allocation.kind='allocation' AND allocation.environment=c.environment
      WHERE c.environment=? AND c.month=? AND c.phase='active' AND allocation.verified_at<=? AND allocation.valid_until>?
      AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw<=b.limit_krw
      AND EXISTS(SELECT 1 FROM v2_runtime_proofs funding WHERE funding.environment=c.environment AND funding.kind='funding'
        AND funding.verified_at<=? AND funding.valid_until>? AND json_extract(funding.payload_json,'$.state') IN ('funded','trial_credit'))`,
        [environment, usageDateKst(now).slice(0, 7), now, now, now, now],
      )
      .first();
    if (!control) return { available: false };
    const files = await createFileProcessingDispatcher(core, {
      binding: env.FILE_PROCESSING,
    }).dispatch(4);
    const profiles = await createProfilePublicationDispatcher(core, {
      binding: env.PROFILE_PUBLICATION,
    }).dispatch(4);
    return { available: true, files, profiles };
  } catch {
    // Payloads, SQL and provider failures must not enter scheduled logs.
    return { available: false };
  }
}
