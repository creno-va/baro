import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import * as schema from "../db/schema";
import { type Actor, hashSchema, type V2Core } from "../db/v2-core";
import { createV2FilesRepository } from "../db/v2-files";
import { jobAlive } from "../db/v2-jobs";
import { runtimeDigest } from "../db/v2-paid-runtime";
import { createV2UploadProbeRepository } from "../db/v2-upload-probe";
import { createProcessingBudgetService } from "../modules/budget/processing-ledger";
import {
  boundedProcessingResources,
  type ProcessingRuntimePolicy,
} from "../modules/budget/processing-runtime";
import { hasCurrentConsent } from "../modules/consent/service";
import { admitFileProcessing } from "../modules/file-processing/execution";
import { ProcessingError } from "../modules/file-processing/protocol";
import { createProcessorTransport } from "../modules/file-processing/transport";
import type { FileServiceDependencies } from "../modules/files/service";

import { readProcessingProofs } from "./processing-proofs";

export function createFileProcessingAdmission(
  core: V2Core,
  env: Env,
  policy: ProcessingRuntimePolicy = {},
  clock = () => new Date().toISOString(),
): Pick<FileServiceDependencies, "probe" | "enqueueProcessing"> {
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const actor = (ownerId: string): Actor => ({ ownerId, now: clock() });
  const currentConsent = (ownerId: string) =>
    hasCurrentConsent(drizzle(core.binding, { schema }), ownerId);
  return {
    async probe(input) {
      if (!env.FILE_PROCESSOR || !(await currentConsent(input.ownerId)))
        throw new ProcessingError("BUDGET_UNAVAILABLE");
      const probes = createV2UploadProbeRepository(core);
      const context = await probes.context(
        actor(input.ownerId),
        input.uploadSession,
        input.uploadRevision,
      );
      if (
        !context ||
        context.fileId !== input.fileId ||
        context.workspaceId !== input.workspaceId ||
        context.byteLength !== input.byteLength
      )
        throw new ProcessingError("STALE_REVISION");
      const jobId = crypto.randomUUID(),
        invocationId = `${jobId}-1`;
      const budget = createProcessingBudgetService({
        core,
        environment,
        ownerId: input.ownerId,
        clock,
        ...policy,
        bounds: policy.bounds ?? boundedProcessingResources,
        binding: async (now) => {
          const proofs = await readProcessingProofs(core, environment, now);
          return proofs
            ? {
                ...proofs,
                operationId: context.operationId,
                operationRevision: context.operationRevision,
                requestHash: context.requestHash,
                jobId,
                targetKind: "file",
                targetId: input.fileId,
                targetRevision: context.fileRevision,
                invocationId,
                maximumAttempts: 1,
                deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
              }
            : null;
        },
      });
      const admission = await budget.prepareInitial({
        service: "container",
        action: "container_probe",
        identity: `probe:${input.contentHash}:0:0`,
        byteLength: input.byteLength,
        durationSeconds: null,
      });
      if (!admission) throw new ProcessingError("BUDGET_UNAVAILABLE");
      const lease = await probes.attach(
        admission.actor,
        {
          uploadId: input.uploadSession,
          uploadRevision: input.uploadRevision,
          leaseUntil: new Date(Date.parse(admission.actor.now) + 300000).toISOString(),
        },
        admission.paid,
      );
      if (!lease) throw new ProcessingError("STALE_REVISION");
      const access = {
        signal: AbortSignal.timeout(265000),
        authorize: async () => {
          if (!(await currentConsent(input.ownerId))) return false;
          const now = clock();
          return !!(await core
            .statement(
              `SELECT j.id FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
          WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status='running' AND ${jobAlive}
          AND EXISTS(SELECT 1 FROM v2_upload_sessions WHERE id=? AND file_id=j.target_id AND revision=? AND state='open' AND encrypted_payload IS NULL AND expires_at>?)
          AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=j.target_id AND owner_id=o.owner_id AND kind='auto_processing' AND version=?)`,
              [
                lease.jobId,
                input.ownerId,
                lease.token,
                lease.fencing,
                now,
                input.uploadSession,
                input.uploadRevision,
                now,
                CURRENT_POLICY_VERSIONS.aiNoticeVersion,
              ],
            )
            .first());
        },
      };
      let native: ReturnType<typeof env.FILE_PROCESSOR.get> | null = null;
      const processor = createProcessorTransport({
        costs: budget.costs(lease, admission),
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
      let succeeded = false;
      try {
        const result = await processor.probe(input, access);
        if (
          !(await probes.finish(
            actor(input.ownerId),
            input.uploadSession,
            input.uploadRevision,
            lease,
            true,
          ))
        )
          throw new ProcessingError("STALE_REVISION");
        succeeded = true;
        return result;
      } finally {
        if (!succeeded)
          await probes
            .finish(actor(input.ownerId), input.uploadSession, input.uploadRevision, lease, false)
            .catch(() => false);
      }
    },
    async enqueueProcessing(input) {
      if (!env.FILE_PROCESSING || !(await currentConsent(input.ownerId))) return false;
      const file = await createV2FilesRepository(core).metadata(actor(input.ownerId), input.fileId);
      if (
        !file?.manifestSnapshotId ||
        file.revision !== input.fileRevision ||
        file.status !== "uploaded"
      )
        return false;
      const row = await core
        .statement(
          "SELECT w.revision,u.encrypted_payload,u.revision AS upload_revision,u.id AS upload_id,u.reserved_bytes FROM v2_workspaces w JOIN v2_files f ON f.workspace_id=w.id JOIN v2_upload_sessions u ON u.file_id=f.id WHERE w.id=? AND w.owner_id=? AND f.id=? AND u.state='finalized'",
          [input.workspaceId, input.ownerId, input.fileId],
        )
        .first<{
          revision: number;
          encrypted_payload: string;
          upload_revision: number;
          upload_id: string;
          reserved_bytes: number;
        }>();
      if (!row) return false;
      const original = await core.decrypt(
        "v2_upload_sessions",
        row.upload_id,
        input.ownerId,
        row.upload_revision,
        row.encrypted_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      const jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID();
      const requestHash = await runtimeDigest({
        workspaceId: input.workspaceId,
        fileId: input.fileId,
        fileRevision: input.fileRevision,
        contentHash: original.contentHash,
      });
      const budget = createProcessingBudgetService({
        core,
        environment,
        ownerId: input.ownerId,
        clock,
        ...policy,
        bounds: policy.bounds ?? boundedProcessingResources,
        binding: async (now) => {
          const proofs = await readProcessingProofs(core, environment, now);
          return proofs
            ? {
                ...proofs,
                operationId,
                operationRevision: row.revision + 1,
                requestHash,
                jobId,
                targetKind: "file",
                targetId: input.fileId,
                targetRevision: input.fileRevision,
                invocationId: `${jobId}-1`,
                maximumAttempts: 1,
                deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
              }
            : null;
        },
      });
      const admission = await budget.prepareInitial({
        service: "container",
        action: "container_process",
        identity: `process_unit:${original.contentHash}:0:0`,
        byteLength: row.reserved_bytes,
        durationSeconds: null,
      });
      if (!admission) return false;
      await admitFileProcessing(core, {
        ...input,
        expectedRevision: row.revision,
        key: `file-process-${input.fileId}-${input.fileRevision}`,
        paid: admission.paid,
        admissionActor: admission.actor,
      });
      return true;
    },
  };
}
