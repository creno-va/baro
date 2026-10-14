import { createCaseDataCipher } from "../crypto";
import { usageDateKst } from "../db/repository";
import { createV2Core } from "../db/v2-core";
import { carryoverSql } from "../db/v2-paid-statements";
import { allocationUntilSql } from "../db/v2-runtime-authority";
import {
  createAssetProcessingDispatcher,
  createFileProcessingDispatcher,
} from "../modules/file-processing/dispatch";
import { createProfilePublicationDispatcher } from "../modules/lawyers/publication-dispatch";
import { createWorkspaceDispatcher } from "../modules/workspace/dispatch";
import { reconcileStoppedJobs } from "./job-recovery";

/** Recover confirmed terminal instances, then dispatch admitted immutable IDs.
 * Funding policy applies only when application cost limits are enabled. */
export async function reconcileV2Dispatch(env: Env) {
  try {
    const now = new Date().toISOString();
    const core = createV2Core(env.DB, await createCaseDataCipher(env), {
      applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    const environment = env.APP_ENV === "production" ? "production" : "preview";
    const stopped = await reconcileStoppedJobs(core, {
      files: env.FILE_PROCESSING,
      workspaces: env.WORKSPACE_PROCESSING,
    });
    const control =
      !core.applicationCostLimitsEnabled ||
      (await core
        .statement(
          `SELECT c.month FROM v2_runtime_controls c
      JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment
      JOIN v2_storage_funding_heads head ON head.environment=c.environment JOIN v2_runtime_proofs funding ON funding.id=head.proof_id AND funding.verified_at=head.verified_at AND funding.environment=c.environment AND funding.kind='funding'
      JOIN v2_runtime_proofs allocation ON allocation.id=c.allocation_proof_id AND allocation.kind='allocation' AND allocation.environment=c.environment
      WHERE c.environment=? AND c.month=? AND c.phase='active' AND allocation.verified_at<=? AND ${allocationUntilSql("c", "allocation")}>?
      AND (${core.monthlyBudgetCapEnabled ? "0" : "1"}=1 OR b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})<=b.limit_krw)
      AND (${core.applicationCostLimitsEnabled ? "0" : "1"}=1 OR b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})<=json_extract(funding.payload_json,'$.spendAllowanceKrw'))
      AND funding.verified_at<=? AND funding.valid_until>? AND json_extract(funding.payload_json,'$.state') IN ('funded','trial_credit')`,
          [
            environment,
            usageDateKst(now).slice(0, 7),
            now,
            now,
            usageDateKst(now).slice(0, 7),
            usageDateKst(now).slice(0, 7),
            usageDateKst(now).slice(0, 7),
            usageDateKst(now).slice(0, 7),
            now,
            now,
          ],
        )
        .first());
    if (!control) return { available: false };
    const files = await createFileProcessingDispatcher(core, {
      environment,
      binding: env.FILE_PROCESSING,
    }).dispatch(4);
    const assets = await createAssetProcessingDispatcher(core, {
      environment,
      binding: env.ASSET_PROCESSING,
    }).dispatch(4);
    const profiles = await createProfilePublicationDispatcher(core, {
      binding: env.PROFILE_PUBLICATION,
    }).dispatch(4);
    const workspaces = await createWorkspaceDispatcher(core, {
      binding: env.WORKSPACE_PROCESSING,
    }).dispatch(4);
    return { available: true, files, assets, profiles, workspaces, stopped };
  } catch {
    // Payloads, SQL and provider failures must not enter scheduled logs.
    return { available: false };
  }
}
