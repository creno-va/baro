import { createCaseDataCipher } from "../crypto";
import { aliveWorkspace, createV2Core, type V2Core } from "../db/v2-core";
import { createReworkRuntime, type ReworkRuntimeOptions } from "../modules/rework/runtime";

export async function resumeReworkCase(env: Env, ownerId: string, caseId: string) {
  try {
    const core = createV2Core(env.DB, await createCaseDataCipher(env), {
      applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    return await createReworkRuntime(core, env).resume(ownerId, caseId);
  } catch {
    return { status: "waiting" as const };
  }
}
/** Reuse the existing product dispatch scheduler; no new scheduler/automation.
 * Rotate bounded pages so an unchanged failed/old case cannot starve another. */
export async function reconcileReworkPreparation(
  core: V2Core,
  env: Env,
  options: ReworkRuntimeOptions = {},
) {
  const now = (options.clock ?? (() => new Date().toISOString()))(),
    limit = 4;
  const rows = (
    await core
      .statement(
        `WITH candidates AS (
    SELECT w.id,w.owner_id,w.updated_at FROM v2_workspaces w JOIN v2_intakes i ON i.id=w.id
    WHERE w.status='active' AND i.confirmed_summary_revision IS NOT NULL AND w.current_job_id IS NULL AND ${aliveWorkspace}
  ), numbered AS (SELECT candidates.*,row_number() OVER(ORDER BY updated_at,id)-1 scan_index,count(*) OVER() scan_count FROM candidates)
  SELECT id,owner_id FROM numbered WHERE scan_index/?=?%((scan_count+?-1)/?) ORDER BY scan_index`,
        [limit, Math.floor(Date.parse(now) / 60000), limit, limit],
      )
      .all<{ id: string; owner_id: string }>()
  ).results;
  const runtime = createReworkRuntime(core, env, options);
  let resumed = 0;
  for (const row of rows) {
    try {
      const result = await runtime.resume(row.owner_id, row.id);
      if (["analysis", "complete"].includes(result.status)) resumed++;
    } catch {
      /* owner/consent/technical/source failure stays private and bounded */
    }
  }
  return { inspected: rows.length, resumed };
}
