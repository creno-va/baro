import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { V2Core } from "../db/v2-core";
import { createV2JobsRepository } from "../db/v2-jobs";
import { createProcessingBudgetService } from "../modules/budget/processing-ledger";
import {
  boundedProcessingResources,
  type ProcessingRuntimePolicy,
} from "../modules/budget/processing-runtime";
import { hasCurrentConsent } from "../modules/consent/service";
import type { LawyerAssetDependencies } from "../modules/lawyers/assets";
import { readProcessingProofs } from "./processing-proofs";

/** The first real sanitizer action is the private original read. Its admission
 * reserves that exact input before the asset job and outbox are installed. */
export function createAssetProcessingAdmission(
  core: V2Core,
  env: Env,
  policy: ProcessingRuntimePolicy = {},
  clock = () => new Date().toISOString(),
): Pick<LawyerAssetDependencies, "enqueueProcessing"> {
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  return {
    async enqueueProcessing(input) {
      if (
        !env.ASSET_PROCESSING ||
        !env.FILE_PROCESSOR ||
        !(await hasCurrentConsent(drizzle(core.binding, { schema }), input.ownerId))
      )
        return false;
      const source = await core
        .statement(
          `SELECT a.original_blob_id,b.cipher_hash,b.cipher_bytes,o.revision AS operation_revision,i.request_hash
          FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_blobs b ON b.id=a.original_blob_id
          JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_operations o ON o.id=r.operation_id
          JOIN v2_idempotency i ON i.operation_id=o.id JOIN v2_billing_principals principal ON principal.id=b.principal_id
          WHERE a.id=? AND a.profile_id=? AND a.owner_id=? AND p.owner_id=a.owner_id AND a.revision=?
          AND a.state='uploaded' AND a.current_job_id IS NULL AND a.purpose IN ('profile_photo','portfolio')
          AND b.state='stored' AND b.visibility='private' AND b.cipher_bytes>0 AND b.cipher_hash IS NOT NULL
          AND r.kind='lawyer_asset' AND r.entity_id=a.id AND r.state='stored' AND principal.owner_id=a.owner_id
          AND o.id=? AND o.owner_id=a.owner_id AND o.kind='profile_asset' AND o.state='admitted'
          AND ((a.purpose='profile_photo' AND b.kind='profile_photo_original') OR (a.purpose='portfolio' AND b.kind='portfolio_original'))
          AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`,
          [input.assetId, input.profileId, input.ownerId, input.assetRevision, input.operationId],
        )
        .first<{
          original_blob_id: string;
          cipher_hash: string;
          cipher_bytes: number;
          operation_revision: number;
          request_hash: string;
        }>();
      if (!source) return false;
      const jobId = crypto.randomUUID();
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
                operationId: input.operationId,
                operationRevision: source.operation_revision,
                requestHash: source.request_hash,
                jobId,
                targetKind: "profile_asset",
                targetId: input.assetId,
                targetRevision: input.assetRevision,
                invocationId: `${jobId}-1`,
                maximumAttempts: 1,
                deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
              }
            : null;
        },
      });
      const prepared = await budget.prepareInitial({
        service: "storage",
        action: "r2_get",
        identity: `asset-original:${source.original_blob_id}:${source.cipher_hash}`,
        byteLength: source.cipher_bytes,
        durationSeconds: null,
      });
      if (!prepared) return false;
      return createV2JobsRepository(core).admitAsset(
        prepared.actor,
        { assetId: input.assetId, assetRevision: input.assetRevision, jobId },
        prepared.paid,
      );
    },
  };
}
