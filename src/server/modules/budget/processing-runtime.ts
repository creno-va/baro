import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { type ExecutionPlan, runtimeDigest } from "../../db/v2-paid-runtime";
import {
  createFileProcessingExecution,
  type FileProcessingParams,
} from "../file-processing/execution";
import { ProcessingError } from "../file-processing/protocol";
import { createProcessorTransport, type ProcessingCosts } from "../file-processing/transport";
import { createFilesService } from "../files/service";
import { createMediaGateway, WHISPER_MODEL } from "../llm-gateway/transcription";
import type { GatewayExecutionBinding } from "./gateway-ledger";
import { createProcessingBudgetService } from "./processing-ledger";

export type ProcessingRuntimePolicy = Pick<
  Parameters<typeof createProcessingBudgetService>[0],
  "bounds" | "metering"
> &
  Pick<Parameters<typeof createMediaGateway>[1], "visionCapability">;

export const boundedProcessingResources: NonNullable<ProcessingRuntimePolicy["bounds"]> = async (
  input,
  inputDigest,
  now,
) => {
  let quantities: ExecutionPlan["quantities"];
  if (
    input.service === "container" &&
    (input.action === "container_probe" || input.action === "container_process")
  ) {
    // standard-2 allocation: 1 vCPU / 6 GiB / 12 GB. The reservation includes
    // startup, the 265-second request limit and the five-minute stop fallback.
    quantities = [
      { sku: "container_cpu_seconds", maximumQuantity: "600" },
      { sku: "container_memory_gib_seconds", maximumQuantity: "3600" },
      { sku: "container_disk_gb_seconds", maximumQuantity: "7200" },
      {
        sku: "r2_class_b_requests",
        maximumQuantity: String(2 * Math.ceil(input.byteLength / 8388608)),
      },
    ];
  } else if (input.service === "requests" && input.action === "r2_get") {
    quantities = [{ sku: "r2_class_b_requests", maximumQuantity: "2" }];
  } else if (
    input.service === "asr" &&
    input.action === "asr" &&
    input.model === WHISPER_MODEL &&
    input.durationSeconds !== null &&
    input.durationSeconds > 0 &&
    input.durationSeconds <= 30
  ) {
    // The gateway validates actual mono PCM bytes before producing this input.
    quantities = [{ sku: "asr_seconds", maximumQuantity: "30" }];
  } else {
    // Vision token capability and recurring stored-byte funding require their
    // own authenticated configuration. Never infer them from byte length.
    return null;
  }
  return {
    inputDigest,
    quantities,
    verifiedAt: now,
    validUntil: new Date(Date.parse(now) + 300_000).toISOString(),
    evidenceHash: await runtimeDigest({
      inputDigest,
      quantities,
      policy: "standard-2-bounded-native-v1",
    }),
  };
};

async function jobBinding(
  core: V2Core,
  params: FileProcessingParams,
  instanceId: string,
  now: string,
  environment: "preview" | "production",
): Promise<GatewayExecutionBinding | null> {
  const row = await core
    .statement(
      `SELECT o.id AS operationId,o.revision AS operationRevision,i.request_hash AS requestHash,
      j.id AS jobId,j.target_kind AS targetKind,j.target_id AS targetId,j.target_revision AS targetRevision,
      p.pricing_proof_id AS pricingProofId,p.funding_proof_id AS fundingProofId,c.allocation_proof_id AS allocationProofId
     FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_idempotency i ON i.operation_id=o.id
     JOIN v2_paid_holds h ON h.job_id=j.id JOIN v2_runtime_plans p ON p.id=h.plan_id
     JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_controls c ON c.month=ca.month
     WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.target_kind='file'
       AND j.target_id=? AND j.target_revision=? AND c.phase='active' AND c.environment=?
     ORDER BY p.created_at,p.id LIMIT 1`,
      [params.jobId, params.ownerId, instanceId, params.fileId, params.fileRevision, environment],
    )
    .first<Omit<GatewayExecutionBinding, "invocationId" | "maximumAttempts" | "deadlineAt">>();
  return row
    ? {
        ...row,
        invocationId: instanceId,
        maximumAttempts: 1,
        deadlineAt: new Date(Date.parse(now) + 300_000).toISOString(),
      }
    : null;
}

/** Environment bindings are the only network/model/storage surfaces. Pricing,
 * funding and bounds must be configured by trusted deployment composition.
 * Missing evidence remains a domain failure, never a test adapter fallback.
 */
export async function createFileProcessingRuntime(
  env: Env,
  params: FileProcessingParams,
  instanceId: string,
  waitUntil: (task: Promise<void>) => void,
  policy: ProcessingRuntimePolicy = {},
) {
  if (!env.CASE_PRIVATE_R2 || !env.FILE_PROCESSOR || !env.AI || !env.AI_GATEWAY_ID)
    throw new ProcessingError("MODEL_UNAVAILABLE");
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const core = createV2Core(env.DB, await createCaseDataCipher(env), {
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  const initialAttemptId = await core
    .statement(
      `SELECT h.attempt_id FROM v2_paid_holds h JOIN v2_jobs j ON j.id=h.job_id JOIN v2_operations o ON o.id=j.operation_id
     JOIN v2_cost_attempts ca ON ca.id=h.attempt_id WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=?
       AND h.state='prepared' AND ca.state='reserved' ORDER BY ca.created_at,ca.id LIMIT 1`,
      [params.jobId, params.ownerId, instanceId],
    )
    .first<string>("attempt_id");
  const budget = createProcessingBudgetService({
    core,
    environment,
    ownerId: params.ownerId,
    ...(initialAttemptId ? { initialAttemptId } : {}),
    ...policy,
    bounds: policy.bounds ?? boundedProcessingResources,
    binding: (now) => jobBinding(core, params, instanceId, now, environment),
  });
  let execution: ReturnType<typeof createFileProcessingExecution>;
  const ledgers = new Map<string, ProcessingCosts>();
  const costOwner = new WeakMap<object, ProcessingCosts>();
  const costs: ProcessingCosts = {
    async before(input, access) {
      const lease = await execution.currentLease();
      const key = `${lease.token}:${lease.fencing}`;
      let ledger = ledgers.get(key);
      if (!ledger) {
        ledger = budget.costs(lease);
        ledgers.set(key, ledger);
      }
      const permit = await ledger.before(input, access);
      if (permit) costOwner.set(permit, ledger);
      return permit;
    },
    async after(permit, receipt) {
      await costOwner.get(permit)?.after(permit, receipt);
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
  execution = createFileProcessingExecution(core, params, {
    environment,
    instanceId,
    ...(initialAttemptId ? { initialAttemptId } : {}),
    files: createFilesService(core, { environment, bucket: env.CASE_PRIVATE_R2 }),
    bucket: env.CASE_PRIVATE_R2,
    processor,
    costs,
    media: createMediaGateway(
      { AI: env.AI, AI_GATEWAY_ID: env.AI_GATEWAY_ID },
      {
        costs,
        waitUntil,
        ...(policy.visionCapability ? { visionCapability: policy.visionCapability } : {}),
      },
    ),
  });
  return execution;
}
