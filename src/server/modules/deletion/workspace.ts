import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
export class WorkspaceDeletionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "INVALID_REQUEST") {
    super(code);
  }
}
/** Metadata-only admission. Existing v2 deletion triggers capture cleanup journals,
 * cancel work and tombstone the workspace atomically. No private payload is read. */
export async function deleteWorkspace(
  db: D1Database,
  ownerId: string,
  id: string,
  key: string,
  now = new Date().toISOString(),
) {
  opaqueIdSchema.parse(ownerId);
  opaqueIdSchema.parse(id);
  idempotencyKeySchema.parse(key);
  const route = `/api/v2/cases/${encodeURIComponent(id)}`;
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ kind: "workspace_delete", id })),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const replay = async () => {
    const prior = await db
      .prepare(
        "SELECT request_hash FROM idempotency_records WHERE user_id=? AND method='DELETE' AND route=? AND key=? AND expires_at>?",
      )
      .bind(ownerId, route, key, now)
      .first<{ request_hash: string }>();
    if (!prior) return false;
    if (prior.request_hash !== hash) throw new WorkspaceDeletionError("IDEMPOTENCY_CONFLICT");
    return true;
  };
  if (await replay()) return;
  const alive =
    "NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='workspace' AND t.target_id=w.id) OR (t.target_kind='account' AND t.target_id=w.owner_id))";
  try {
    const result = await db.batch([
      db
        .prepare(
          "DELETE FROM idempotency_records WHERE user_id=? AND method='DELETE' AND route=? AND key=? AND expires_at<=?",
        )
        .bind(ownerId, route, key, now),
      db
        .prepare(
          `INSERT INTO idempotency_records(user_id,method,route,key,request_hash,response_status,response_json,created_at,expires_at) SELECT ?,'DELETE',?,?,?,202,'{"status":"accepted"}',?,? FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${alive}`,
        )
        .bind(
          ownerId,
          route,
          key,
          hash,
          now,
          new Date(Date.parse(now) + 86400000).toISOString(),
          id,
          ownerId,
        ),
      db
        .prepare(
          "DELETE FROM v2_workspaces WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM idempotency_records WHERE user_id=? AND method='DELETE' AND route=? AND key=? AND request_hash=? AND created_at=?)",
        )
        .bind(id, ownerId, ownerId, route, key, hash, now),
    ]);
    if (result[1]?.meta.changes === 1 && result[2]?.meta.changes === 1) return;
  } catch (error) {
    if (await replay()) return;
    throw error;
  }
  if (await replay()) return;
  throw new WorkspaceDeletionError("NOT_FOUND");
}
