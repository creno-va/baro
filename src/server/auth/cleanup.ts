import { AUTH_RETENTION_MS } from "./policy";

// No profile, token, SQL parameters or query results leave this maintenance boundary.
export async function cleanupAuthData(database: D1Database, now = Date.now()): Promise<void> {
  const cutoff = now - AUTH_RETENTION_MS;
  try {
    for (const table of ["session", "verification"] as const) {
      await database
        .prepare(`DELETE FROM ${table} WHERE expires_at <= ? OR created_at <= ?`)
        .bind(now, cutoff)
        .run();
    }
  } catch {
    // Cron failures must remain observable without retaining the adapter's SQL,
    // parameter values or original stack/cause in platform exception logging.
    throw new Error("AUTH_CLEANUP_FAILED");
  }
}
