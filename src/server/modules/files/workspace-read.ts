import { opaqueIdSchema } from "../../../contracts";
import { aliveWorkspace, type V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { FileError } from "./binary";

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
