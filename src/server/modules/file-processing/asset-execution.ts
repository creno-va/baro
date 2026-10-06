import { timestampSchema } from "../../../contracts";
import type { V2Core } from "../../db/v2-core";
import { stopExpiredUndispatchedJob } from "../../db/v2-expired-undispatched-job";
import { createV2JobsRepository, jobAlive } from "../../db/v2-jobs";
import type { JobLease } from "../../db/v2-workspace";
import type { AssetProcessingParams } from "./assets";
import { ProcessingError } from "./protocol";

/** Acquisition and publication remain inside one bounded Workflow step. Neither
 * source bytes nor a lease token is serialized into Workflow history. */
export function createAssetProcessingExecution(
  core: V2Core,
  params: AssetProcessingParams,
  options: {
    environment?: "preview" | "production";
    instanceId: string;
    initialAttemptId: string | null;
    clock?: () => string;
    completed: (
      input: AssetProcessingParams,
    ) => Promise<{ status: "ready"; assetId: string; revision: number } | null>;
    sanitize: (
      input: AssetProcessingParams,
      lease: JobLease,
      signal: AbortSignal,
    ) => Promise<{ status: "ready"; assetId: string; revision: number }>;
  },
) {
  const jobs = createV2JobsRepository(core);
  const actor = () => ({
    ownerId: params.ownerId,
    now: new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString(),
  });
  let lease: JobLease | null = null;
  return {
    async run(signal: AbortSignal) {
      const completed = await options.completed(params);
      if (completed) return completed;
      if (signal.aborted) throw new ProcessingError("JOB_TIMEOUT");
      const current = await core
        .statement(
          `SELECT j.lease_token,j.fencing,j.lease_until FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
          WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND j.profile_id=?
          AND j.target_kind='profile_asset' AND j.kind='portfolio_sanitize' AND j.target_id=? AND j.target_revision=?
          AND j.status IN ('queued','running','validating') AND o.state IN ('admitted','ambiguous') AND ${jobAlive}`,
          [
            params.jobId,
            params.ownerId,
            options.instanceId,
            params.profileId,
            params.assetId,
            params.assetRevision,
          ],
        )
        .first<{ lease_token: string | null; fencing: number; lease_until: string | null }>();
      if (!current) throw new ProcessingError("STALE_REVISION");
      if (current.lease_token && current.lease_until && current.lease_until > actor().now) {
        lease = { jobId: params.jobId, token: current.lease_token, fencing: current.fencing };
      } else {
        // A newly acquired paid job must have its actual durable admission.
        if (!options.initialAttemptId) {
          if (options.environment)
            await stopExpiredUndispatchedJob(core, options.environment, {
              ownerId: params.ownerId,
              jobId: params.jobId,
              instanceId: options.instanceId,
              now: actor().now,
            });
          throw new ProcessingError("BUDGET_UNAVAILABLE");
        }
        const acquisition = actor();
        const granted = await jobs.acquire(
          acquisition,
          params.jobId,
          crypto.randomUUID(),
          new Date(Date.parse(acquisition.now) + 300000).toISOString(),
          options.initialAttemptId,
        );
        if (!granted) {
          if (options.environment)
            await stopExpiredUndispatchedJob(core, options.environment, {
              ownerId: params.ownerId,
              jobId: params.jobId,
              instanceId: options.instanceId,
              now: actor().now,
            });
          throw new ProcessingError("BUDGET_UNAVAILABLE");
        }
        lease = granted.lease;
      }
      return options.sanitize(params, lease, signal);
    },
    async fail(error: unknown) {
      const code = error instanceof ProcessingError ? error.code : "FILE_PROCESSING_FAILED";
      if (lease)
        await jobs.fail(
          actor(),
          lease,
          code === "STALE_REVISION" ? "FILE_PROCESSING_FAILED" : code,
          !["FILE_REJECTED", "STALE_REVISION"].includes(code),
        );
      return { status: "stopped" as const, code };
    },
  };
}
export type AssetProcessingExecution = ReturnType<typeof createAssetProcessingExecution>;
