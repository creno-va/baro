import { createCaseDataCipher } from "../../crypto";
import { createV2Core } from "../../db/v2-core";
import { createAssetProcessingExecution } from "../file-processing/asset-execution";
import {
  type AssetProcessingParams,
  createAssetProcessingService,
} from "../file-processing/assets";
import { ProcessingError } from "../file-processing/protocol";
import { createProcessorTransport, type ProcessingCosts } from "../file-processing/transport";
import { createLawyerAssetsService } from "../lawyers/assets";
import type { GatewayExecutionBinding } from "./gateway-ledger";
import { createProcessingBudgetService } from "./processing-ledger";
import { boundedProcessingResources, type ProcessingRuntimePolicy } from "./processing-runtime";

export async function createAssetProcessingRuntime(
  env: Env,
  params: AssetProcessingParams,
  instanceId: string,
  policy: ProcessingRuntimePolicy = {},
) {
  if (!env.CASE_PRIVATE_R2 || !env.FILE_PROCESSOR) throw new ProcessingError("STORAGE_UNAVAILABLE");
  const core = createV2Core(env.DB, await createCaseDataCipher(env));
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const initial = await core
    .statement(
      `SELECT h.attempt_id FROM v2_paid_holds h JOIN v2_jobs j ON j.id=h.job_id JOIN v2_operations o ON o.id=j.operation_id
      JOIN v2_cost_attempts a ON a.id=h.attempt_id WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=?
      AND j.target_kind='profile_asset' AND j.kind='portfolio_sanitize' AND j.profile_id=? AND j.target_id=? AND j.target_revision=?
      AND h.state='prepared' AND a.state='reserved' ORDER BY a.created_at,a.id LIMIT 1`,
      [
        params.jobId,
        params.ownerId,
        instanceId,
        params.profileId,
        params.assetId,
        params.assetRevision,
      ],
    )
    .first<string>("attempt_id");
  const budget = createProcessingBudgetService({
    core,
    environment,
    ownerId: params.ownerId,
    ...(initial ? { initialAttemptId: initial } : {}),
    ...policy,
    bounds: policy.bounds ?? boundedProcessingResources,
    binding: async (now) => {
      const row = await core
        .statement(
          `SELECT o.id AS operationId,o.revision AS operationRevision,i.request_hash AS requestHash,
          j.id AS jobId,j.target_kind AS targetKind,j.target_id AS targetId,j.target_revision AS targetRevision,
          p.pricing_proof_id AS pricingProofId,p.funding_proof_id AS fundingProofId,c.allocation_proof_id AS allocationProofId
          FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_idempotency i ON i.operation_id=o.id
          JOIN v2_paid_holds h ON h.job_id=j.id JOIN v2_runtime_plans p ON p.id=h.plan_id
          JOIN v2_cost_attempts a ON a.id=h.attempt_id JOIN v2_runtime_controls c ON c.month=a.month
          WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_kind='profile_asset'
          AND j.profile_id=? AND j.target_id=? AND j.target_revision=? AND c.environment=? AND c.phase='active'
          ORDER BY p.created_at,p.id LIMIT 1`,
          [
            params.jobId,
            params.ownerId,
            instanceId,
            params.profileId,
            params.assetId,
            params.assetRevision,
            environment,
          ],
        )
        .first<Omit<GatewayExecutionBinding, "invocationId" | "maximumAttempts" | "deadlineAt">>();
      return row
        ? {
            ...row,
            invocationId: instanceId,
            maximumAttempts: 1,
            deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
          }
        : null;
    },
  });
  const ledgerByFence = new Map<string, ProcessingCosts>();
  const owner = new WeakMap<object, ProcessingCosts>();
  const costs: ProcessingCosts = {
    async before(input, access) {
      const lease = await core
        .statement(
          "SELECT lease_token AS token,fencing FROM v2_jobs WHERE id=? AND runtime_instance_id=? AND status IN ('running','validating')",
          [params.jobId, instanceId],
        )
        .first<{ token: string; fencing: number }>();
      if (!lease?.token) return null;
      const key = `${lease.token}:${lease.fencing}`;
      let ledger = ledgerByFence.get(key);
      if (!ledger) {
        ledger = budget.costs({ jobId: params.jobId, ...lease });
        ledgerByFence.set(key, ledger);
      }
      const permit = await ledger.before(input, access);
      if (permit) owner.set(permit, ledger);
      return permit;
    },
    async after(permit, receipt) {
      await owner.get(permit)?.after(permit, receipt);
    },
  };
  let native: ReturnType<typeof env.FILE_PROCESSOR.get> | null = null;
  const processor = createProcessorTransport({
    costs,
    fetch: (request) => {
      native = env.FILE_PROCESSOR.get(env.FILE_PROCESSOR.newUniqueId());
      return native.fetch(request);
    },
    stop: async () => {
      const current = native;
      native = null;
      await current?.stop("SIGKILL");
    },
  });
  const source = createLawyerAssetsService(core, { environment, bucket: env.CASE_PRIVATE_R2 });
  const assets = createAssetProcessingService(core, {
    environment,
    instanceId,
    bucket: env.CASE_PRIVATE_R2,
    processor,
    costs,
    openOriginal: source.openOriginal,
  });
  return createAssetProcessingExecution(core, params, {
    environment,
    instanceId,
    initialAttemptId: initial,
    completed: assets.completed,
    sanitize: assets.sanitize,
  });
}
