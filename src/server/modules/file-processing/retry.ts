import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import * as schema from "../../db/schema";
import { guardSchema, type V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { createV2JobsRepository } from "../../db/v2-jobs";
import { readProcessingProofs } from "../../runtime/processing-proofs";
import { createProcessingBudgetService } from "../budget/processing-ledger";
import { boundedProcessingResources } from "../budget/processing-runtime";
import { hasCurrentConsent } from "../consent/service";
import { FileError } from "../files/binary";
import type { FileServiceDependencies } from "../files/service";

/** Retry keeps the original operation and immutable source, but attaches a new
 * paid hold, runtime instance and fencing token through the existing jobs CAS. */
export function createFileRetry(
  core: V2Core,
  env: Env,
  deps: Pick<FileServiceDependencies, "enqueueProcessing" | "testOnlyUnmeteredStorage" | "clock">,
) {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const files = createV2FilesRepository(core),
    jobs = createV2JobsRepository(core);
  return async (ownerId: string, workspaceId: string, fileId: string, input: unknown) => {
    const value = z
      .strictObject({
        expectedRevision: z.number().int().positive(),
        fileRevision: z.number().int().positive(),
      })
      .parse(input);
    opaqueIdSchema.parse(fileId);
    const g = guardSchema.parse({
      ownerId,
      workspaceId,
      expectedRevision: value.expectedRevision,
      now: clock(),
    });
    if (!(await hasCurrentConsent(drizzle(core.binding, { schema }), ownerId)))
      throw new FileError("PROCESSING_UNAVAILABLE");
    const file = await files.metadata(g, fileId);
    const consent = await core
      .statement(
        "SELECT file_id FROM v2_consents WHERE owner_id=? AND file_id=? AND kind='auto_processing' AND version=?",
        [ownerId, fileId, CURRENT_POLICY_VERSIONS.aiNoticeVersion],
      )
      .first();
    if (
      !file ||
      (await core
        .statement("SELECT workspace_id FROM v2_files WHERE id=?", [fileId])
        .first<string>("workspace_id")) !== workspaceId
    )
      throw new FileError("NOT_FOUND");
    if (!consent || file.revision !== value.fileRevision) throw new FileError("CONFLICT");
    if (["queued", "processing"].includes(file.status)) return file;
    const workspace = await core
      .statement("SELECT revision FROM v2_workspaces WHERE id=? AND owner_id=?", [
        workspaceId,
        ownerId,
      ])
      .first<number>("revision");
    if (workspace !== value.expectedRevision) throw new FileError("CONFLICT");
    if (file.status === "uploaded") {
      const op = await core
        .statement(
          "SELECT operation_id FROM v2_upload_sessions WHERE file_id=? AND state='finalized'",
          [fileId],
        )
        .first<string>("operation_id");
      if (
        !op ||
        !(await deps.enqueueProcessing?.({
          ownerId,
          workspaceId,
          fileId,
          fileRevision: file.revision,
          operationId: op,
        }))
      )
        throw new FileError("PROCESSING_UNAVAILABLE");
      return files.metadata({ ...g, now: clock() }, fileId);
    }
    if (file.status !== "failed") throw new FileError("CONFLICT");
    const row = await core
      .statement(
        `SELECT j.id,j.attempts,j.operation_id,o.revision AS operation_revision,coalesce((SELECT request_hash FROM v2_runtime_plans WHERE operation_id=o.id AND job_id=j.id ORDER BY created_at,id LIMIT 1),(SELECT request_hash FROM v2_idempotency WHERE operation_id=o.id LIMIT 1)) AS request_hash FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.target_kind='file' AND j.target_id=? AND j.target_revision=? AND j.kind='file_processing' AND j.status='failed' AND j.retryable=1 AND o.owner_id=? ORDER BY j.updated_at DESC,j.id DESC LIMIT 1`,
        [fileId, file.revision, ownerId],
      )
      .first<{
        id: string;
        attempts: number;
        operation_id: string;
        operation_revision: number;
        request_hash: string | null;
      }>();
    const original = await files.read(g, fileId);
    if (!row || !original?.manifest) throw new FileError("CONFLICT");
    if (!row.request_hash) throw new FileError("PROCESSING_UNAVAILABLE");
    const requestHash = row.request_hash;
    const budget = createProcessingBudgetService({
      core,
      environment,
      ownerId,
      clock,
      bounds: boundedProcessingResources,
      binding: async (now) => {
        const proof = await readProcessingProofs(core, environment, now);
        return proof && env.FILE_PROCESSING
          ? {
              ...proof,
              operationId: row.operation_id,
              operationRevision: row.operation_revision,
              requestHash,
              jobId: row.id,
              targetKind: "file",
              targetId: fileId,
              targetRevision: file.revision,
              invocationId: `${row.id}-${row.attempts + 1}`,
              maximumAttempts: 1,
              deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
            }
          : null;
      },
    });
    const test = environment === "preview" && deps.testOnlyUnmeteredStorage === true;
    const paid = test
      ? null
      : await budget.prepareInitial({
          service: "container",
          action: "container_process",
          identity: `process_unit:${original.manifest.contentHash}:0:0`,
          byteLength: original.manifest.byteLength,
          durationSeconds: null,
        });
    if (!test && !paid) throw new FileError("PROCESSING_UNAVAILABLE");
    if (!(await jobs.retry({ ...g, now: paid?.actor.now ?? clock() }, row.id, paid?.paid)))
      throw new FileError("CONFLICT");
    return files.metadata({ ...g, now: clock() }, fileId);
  };
}
