import { timestampSchema } from "../../contracts";
import type { V2Core } from "./v2-core";

/** Bound deleted item rows, rather than cascading whole snapshots of arbitrary size. */
export function directoryCleanupStatements(db: V2Core["binding"], now: string) {
  const cutoff = new Date(timestampSchema.parse(now)).toISOString();
  return [
    db
      .prepare(
        "DELETE FROM v2_directory_items WHERE (snapshot_id,ordinal) IN (SELECT item.snapshot_id,item.ordinal FROM v2_directory_items item JOIN v2_directory_snapshots snapshot ON snapshot.id=item.snapshot_id WHERE snapshot.expires_at<=? ORDER BY snapshot.expires_at,item.snapshot_id,item.ordinal LIMIT 1000)",
      )
      .bind(cutoff),
    db
      .prepare(
        "DELETE FROM v2_directory_snapshots WHERE id IN (SELECT id FROM v2_directory_snapshots snapshot WHERE expires_at<=? AND NOT EXISTS(SELECT 1 FROM v2_directory_items item WHERE item.snapshot_id=snapshot.id) ORDER BY expires_at,id LIMIT 100)",
      )
      .bind(cutoff),
  ];
}
export async function cleanupExpiredDirectorySnapshots(
  db: V2Core["binding"],
  now = new Date().toISOString(),
) {
  await db.batch(directoryCleanupStatements(db, now));
}
