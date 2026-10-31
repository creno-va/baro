import { type V2ActionCompletion, v2ActionSchema } from "../../contracts/v2";
import type { V2Core, WorkspaceGuard } from "./v2-core";

/** Preserve saved content; only a still-pending exact revision may become done. */
export async function prepareActionCompletions(
  core: V2Core,
  g: WorkspaceGuard,
  completions: readonly V2ActionCompletion[],
) {
  const updates = [];
  for (const completion of completions) {
    const row = await core
      .statement(
        "SELECT id,revision,status,encrypted_payload FROM v2_actions WHERE workspace_id=? AND entity_id=?",
        [g.workspaceId, completion.actionId],
      )
      .first<{ id: string; revision: number; status: string; encrypted_payload: string }>();
    if (row?.status !== "todo" || row.revision !== completion.expectedRevision) return null;
    const saved = await core.decrypt(
      "v2_actions",
      row.id,
      g.ownerId,
      row.revision,
      row.encrypted_payload,
      v2ActionSchema,
    );
    if (
      saved.id !== completion.actionId ||
      saved.revision !== row.revision ||
      saved.status !== "todo"
    )
      return null;
    const references = [...saved.references];
    if (!references.some((ref) => JSON.stringify(ref) === JSON.stringify(completion.reference)))
      references.push(completion.reference);
    const value = v2ActionSchema.parse({
      ...saved,
      revision: saved.revision + 1,
      status: "done",
      references,
    });
    updates.push({
      row,
      value,
      payload: await core.encrypt("v2_actions", row.id, g.ownerId, value.revision, value),
    });
  }
  return updates;
}
