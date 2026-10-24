import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { v2FileObservationSchema } from "../../../contracts/v2";
import { type Actor, aliveWorkspace, type V2Core } from "../../db/v2-core";
import type { WorkspaceContext } from "./pipeline";

export const materialWindowRequestSchema = z.strictObject({
  fileId: opaqueIdSchema,
  fileRevision: z.number().int().positive(),
  startOrdinal: z.number().int().min(0).max(200_000),
  count: z.number().int().min(1).max(32),
});
export type MaterialWindowRequest = z.infer<typeof materialWindowRequestSchema>;
export type MaterialWindow = {
  fileId: string;
  fileRevision: number;
  observationCount: number;
  startOrdinal: number;
  nextOrdinal: number | null;
  materials: WorkspaceContext["materials"];
};
export const MATERIAL_CONTEXT_BYTES = 192 * 1024;

/** A model selects positions in already-authorized files, never URLs/R2 keys or
 * another case. Whole excerpts preserve exact source quotes and review exclusions.
 * Ownership, revision and ciphertext pointers are checked on both sides of AES. */
export async function readMaterialWindow(
  core: V2Core,
  actor: Actor,
  workspaceId: string,
  request: MaterialWindowRequest,
  maximumBytes = MATERIAL_CONTEXT_BYTES,
): Promise<MaterialWindow> {
  request = materialWindowRequestSchema.parse(request);
  for (const id of [actor.ownerId, workspaceId]) opaqueIdSchema.parse(id);
  const owned = () =>
    core
      .statement(
        `SELECT f.revision,f.encrypted_payload,f.coverage_snapshot_id FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.id=? AND w.owner_id=? AND ${aliveWorkspace} AND f.state='ready' AND f.revision=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [request.fileId, workspaceId, actor.ownerId, request.fileRevision],
      )
      .first<{
        revision: number;
        encrypted_payload: string;
        coverage_snapshot_id: string | null;
      }>();
  const before = await owned();
  if (!before) throw new Error("MATERIAL_UNAVAILABLE");
  const total = await core
    .statement(
      "SELECT count(*) AS count FROM v2_file_observations WHERE file_id=? AND file_revision=?",
      [request.fileId, request.fileRevision],
    )
    .first<number>("count");
  const rows = (
    await core
      .statement(
        "SELECT id,revision,ordinal,encrypted_payload FROM v2_file_observations WHERE file_id=? AND file_revision=? AND ordinal>=? ORDER BY ordinal LIMIT ?",
        [request.fileId, request.fileRevision, request.startOrdinal, request.count + 1],
      )
      .all<{ id: string; revision: number; ordinal: number; encrypted_payload: string }>()
  ).results;
  const materials: WorkspaceContext["materials"] = [];
  let bytes = 2,
    nextOrdinal: number | null = null;
  for (const [index, row] of rows.entries()) {
    if (index === request.count) {
      nextOrdinal = row.ordinal;
      break;
    }
    const value = await core.decrypt(
      "v2_file_observations",
      row.id,
      actor.ownerId,
      row.revision,
      row.encrypted_payload,
      v2FileObservationSchema,
    );
    if (!value.included) continue;
    const material: WorkspaceContext["materials"][number] = {
      reference: {
        kind: "user_material",
        fileId: request.fileId,
        fileRevision: request.fileRevision,
        position: value.position,
      },
      text: value.text,
      coverage: {
        limitedTo: "observation_window",
        ordinal: row.ordinal,
        fullCoverageSnapshotId: before.coverage_snapshot_id,
        observationCertainty: value.certainty,
        userEdited: value.userEdited,
      },
    };
    const size = new TextEncoder().encode(JSON.stringify(material)).byteLength + 1;
    if (bytes + size > Math.max(0, maximumBytes)) {
      nextOrdinal = row.ordinal;
      break;
    }
    bytes += size;
    materials.push(material);
  }
  const after = await owned();
  if (!after || JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("MATERIAL_UNAVAILABLE");
  const afterRows = (
    await core
      .statement(
        "SELECT id,revision,ordinal,encrypted_payload FROM v2_file_observations WHERE file_id=? AND file_revision=? AND ordinal>=? ORDER BY ordinal LIMIT ?",
        [request.fileId, request.fileRevision, request.startOrdinal, request.count + 1],
      )
      .all()
  ).results;
  if (JSON.stringify(afterRows) !== JSON.stringify(rows)) throw new Error("MATERIAL_UNAVAILABLE");
  const final = await owned();
  if (!final || JSON.stringify(before) !== JSON.stringify(final))
    throw new Error("MATERIAL_UNAVAILABLE");
  return {
    fileId: request.fileId,
    fileRevision: request.fileRevision,
    observationCount: total ?? 0,
    startOrdinal: request.startOrdinal,
    nextOrdinal,
    materials,
  };
}

/** Current attachments first, then the most recent conversation attachments.
 * Re-reading a deleted historical attachment must not break an unrelated reply. */
export function conversationMaterialIds(
  latest: { selectedFileIds: string[] } | undefined,
  messages: readonly { selectedFileIds: string[] }[],
) {
  return [
    ...new Set([
      ...(latest?.selectedFileIds ?? []),
      ...messages.flatMap((message) => message.selectedFileIds),
    ]),
  ].slice(0, 100);
}
