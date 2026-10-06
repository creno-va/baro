import type { V2Core } from "../../db/v2-core";
import type { CleanupLease } from "../../db/v2-deletion";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import type { MaintenanceIO } from "../../db/v2-storage-capacity-contracts";

/** Callers authorize their source before admission; refresh that authorization
 * after consuming one current capability, immediately before the R2 request.
 * A denied or uncertain request never refunds its conservative allowance. */
export function createStorageMaintenance(
  core: V2Core,
  environment: "preview" | "production",
  clock: () => string,
) {
  const capacity = createV2StorageCapacityRepository(core, environment);
  return {
    async admit(
      blobId: string,
      objectKey: string,
      action: MaintenanceIO["action"],
      authorize: () => Promise<boolean>,
    ): Promise<boolean> {
      try {
        const permit = await capacity.beforeMaintenanceIO({ blobId, action }, clock());
        return (
          !!permit &&
          permit.objectKey === objectKey &&
          (await capacity.consumeMaintenanceIO(permit, clock())) &&
          (await authorize())
        );
      } catch {
        return false;
      }
    },
  };
}

/** Cleanup belongs to a live fenced journal, including after owner deletion.
 * An unresolved writer must stop before its object can be removed. */
export async function authorizeBlobCleanup(
  core: V2Core,
  lease: CleanupLease,
  blobId: string,
  objectKey: string,
  now: string,
): Promise<boolean> {
  return !!(await core
    .statement(
      `SELECT b.id FROM v2_blobs b JOIN v2_deletion_targets t ON t.target_id=b.id AND t.kind='blob'
    JOIN v2_deletion_journals j ON j.id=t.journal_id
    WHERE b.id=? AND b.object_key=? AND b.state='deleting' AND t.state='pending'
    AND j.id=? AND j.lease_token=? AND j.fencing=? AND j.state='running' AND j.lease_until>?
    AND NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings binding WHERE binding.blob_id=b.id AND binding.writer_state='running')`,
      [blobId, objectKey, lease.journalId, lease.token, lease.fencing, now],
    )
    .first());
}
