import { opaqueIdSchema } from "../../../contracts";
import { coverageMatchesProbe, v2CoverageSchema } from "../../../contracts/v2";
import { aliveWorkspace, readSnapshot, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { FileError } from "./binary";

/** Lists need coverage, not the complete observation/derivative collection.
 * Keep the compact read's bound and use the existing bounded snapshot reader. */
export async function readWorkspaceFileCoverage(
  core: V2Core,
  ownerId: string,
  workspaceId: string,
  fileId: string,
) {
  for (const id of [ownerId, workspaceId, fileId]) opaqueIdSchema.parse(id);
  const owned = () =>
    core
      .statement(
        `SELECT f.revision,f.state,f.coverage_snapshot_id,f.encrypted_payload,f.current_job_id,f.operation_id,f.manifest_snapshot_id,f.declared_bytes,f.failure_code FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [fileId, workspaceId, ownerId],
      )
      .first<{
        revision: number;
        state: string;
        coverage_snapshot_id: string | null;
        encrypted_payload: string;
        current_job_id: string | null;
        operation_id: string;
        manifest_snapshot_id: string | null;
        declared_bytes: number;
        failure_code: string | null;
      }>();
  const before = await owned();
  if (!before) throw new FileError("NOT_FOUND");
  const actor = { ownerId, now: new Date().toISOString() };
  const metadata = await createV2FilesRepository(core).metadata(actor, fileId);
  if (
    !metadata ||
    metadata.revision !== before.revision ||
    metadata.status !== before.state ||
    metadata.coverageSnapshotId !== before.coverage_snapshot_id
  )
    throw new FileError("NOT_FOUND");
  const coverage = before.coverage_snapshot_id
    ? await readSnapshot(
        core,
        actor,
        before.coverage_snapshot_id,
        "file_coverage",
        fileId,
        before.revision,
        v2CoverageSchema,
      )
    : null;
  const after = await owned();
  if (
    !after ||
    after.revision !== before.revision ||
    after.state !== before.state ||
    after.coverage_snapshot_id !== before.coverage_snapshot_id ||
    after.encrypted_payload !== before.encrypted_payload ||
    after.current_job_id !== before.current_job_id ||
    after.operation_id !== before.operation_id ||
    after.manifest_snapshot_id !== before.manifest_snapshot_id ||
    after.declared_bytes !== before.declared_bytes ||
    after.failure_code !== before.failure_code
  )
    throw new FileError("NOT_FOUND");
  // Preserve the source/coverage and ready-lifecycle checks from v2FileSchema
  // without rehydrating the original manifest or material collections.
  if (
    (metadata.probe && metadata.probe.byteLength !== metadata.byteLength) ||
    (coverage && (!metadata.probe || !coverageMatchesProbe(coverage, metadata.probe))) ||
    (before.state === "ready" &&
      (!coverage ||
        !metadata.probe ||
        !metadata.manifestSnapshotId ||
        metadata.currentJobId !== null ||
        !metadata.operationId ||
        metadata.failure !== null))
  )
    throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
  return { id: fileId, revision: before.revision, status: before.state, coverage };
}

/** Reads existing encrypted observations, with workspace/file ownership checked before and after. */
export async function readWorkspaceFile(
  core: V2Core,
  ownerId: string,
  workspaceId: string,
  fileId: string,
) {
  for (const id of [ownerId, workspaceId, fileId]) opaqueIdSchema.parse(id);
  const belongs = async () =>
    core
      .statement(
        `SELECT f.revision FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [fileId, workspaceId, ownerId],
      )
      .first<number>("revision");
  const before = await belongs();
  if (!before) throw new FileError("NOT_FOUND");
  const file = await createV2FilesRepository(core).read(
    { ownerId, now: new Date().toISOString() },
    fileId,
  );
  if (!file || file.revision !== before || (await belongs()) !== before)
    throw new FileError("NOT_FOUND");
  return file;
}
