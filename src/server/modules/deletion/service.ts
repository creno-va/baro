import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../contracts";
import { RECENT_OAUTH_MS } from "../../auth/policy";
import { profilePublicationInstanceId } from "../lawyers/publication-execution";

const DAY = 86_400_000;
export const CLEANUP_ATTEMPTS = 8;
export const CLEANUP_SETTLE_MS = 16 * 60_000;
// Include historical attempts even after old outboxes were garbage collected.
export const workflowIdsSql = `SELECT a.id || '-' || n.attempt AS instance_id FROM analyses a
 JOIN cases c ON c.id=a.case_id JOIN (SELECT 1 AS attempt UNION SELECT 2 UNION SELECT 3) n
 ON n.attempt<=a.attempt`;

export async function deleteAccount(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  now: number,
) {
  const jobId = crypto.randomUUID(),
    at = new Date(now).toISOString();
  const live = `EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=? AND expires_at>?
    AND oauth_authenticated_at>=? AND oauth_authenticated_at<=?)`;
  const publications = (
    await db
      .prepare(
        "SELECT x.id AS outboxId,x.operation_id AS operationId,x.target_id AS profileId,x.revision AS approvedRevision FROM v2_outbox x JOIN v2_profiles p ON p.id=x.target_id WHERE x.kind='profile_publish' AND p.owner_id=?",
      )
      .bind(ownerId)
      .all<{ outboxId: string; operationId: string; profileId: string; approvedRevision: number }>()
  ).results;
  const inventory = JSON.stringify(
    publications.map((row) => ({ ...row, runtimeId: profilePublicationInstanceId(row) })),
  );
  // Freeze the complete publication inventory in the same deletion transaction.
  // A new outbox admitted between read and batch makes this request retry safely.
  const publicationGuard =
    "NOT EXISTS(SELECT 1 FROM v2_outbox x JOIN v2_profiles p ON p.id=x.target_id WHERE x.kind='profile_publish' AND p.owner_id=u.id AND NOT EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.outboxId')=x.id AND json_extract(value,'$.approvedRevision')=x.revision))";
  const result = await db.batch([
    db
      .prepare(`INSERT INTO deletion_jobs(id,target_type,target_id,deleted_at,workflow_instance_ids,primary_state,cleanup_state,attempts,expires_at)
      SELECT ?,'account',u.id,?,(SELECT json_group_array(instance_id) FROM (
        ${workflowIdsSql} WHERE c.user_id=u.id
        UNION SELECT o.instance_id FROM dispatch_outbox o JOIN analyses a ON a.id=o.analysis_id JOIN cases c ON c.id=a.case_id WHERE c.user_id=u.id
      )),'deleted','pending',0,? FROM user u WHERE u.id=? AND ${publicationGuard} AND ${live}`)
      .bind(
        jobId,
        at,
        new Date(now + 35 * DAY).toISOString(),
        ownerId,
        inventory,
        sessionId,
        ownerId,
        now,
        now - RECENT_OAUTH_MS,
        now,
      ),
    db
      .prepare(
        "DELETE FROM app_metadata WHERE key=? AND EXISTS(SELECT 1 FROM deletion_jobs WHERE id=? AND target_type='account' AND target_id=?)",
      )
      .bind(`account-type:${ownerId}`, jobId, ownerId),
    db
      .prepare(
        `DELETE FROM user WHERE id=? AND EXISTS(SELECT 1 FROM deletion_jobs WHERE id=? AND target_type='account' AND target_id=?)`,
      )
      .bind(ownerId, jobId, ownerId),
    db
      .prepare(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) SELECT j.id,'job',json_extract(value,'$.runtimeId'),coalesce((SELECT max(ordinal)+1 FROM v2_deletion_targets WHERE journal_id=j.id),0)+CAST(json_each.key AS INTEGER) FROM json_each(?) JOIN v2_deletion_journals j ON j.target_kind='account' AND j.target_id=? WHERE EXISTS(SELECT 1 FROM deletion_jobs WHERE id=? AND target_type='account' AND target_id=?) ON CONFLICT(journal_id,kind,target_id) DO NOTHING",
      )
      .bind(inventory, ownerId, jobId, ownerId),
  ]);
  return result[0]?.meta.changes === 1;
}

const journalSchema = z.strictObject({
  id: uuidSchema,
  target_type: z.enum(["case", "account"]),
  target_id: uuidSchema,
  deleted_at: timestampSchema,
  workflow_instance_ids: z.array(z.string().regex(/^[a-f0-9-]{36}-[123]$/)).max(100_000),
  expires_at: timestampSchema,
});
export const deletionJournalSchema = z.array(journalSchema).max(100_000);
export type DeletionJournal = z.infer<typeof deletionJournalSchema>;

type CleanupJob = {
  id: string;
  workflow_instance_ids: string;
  deleted_at: string;
  attempts: number;
  cleanup_cursor: number;
  next_attempt_at: string;
  cleanup_state: "pending" | "completed";
  expires_at: string;
};
/** Exact known missing-instance sentinel only. Network/auth/arbitrary errors remain failures. */
export async function removeWorkflow(env: Pick<Env, "ANALYSIS_WORKFLOW">, id: string) {
  try {
    await (await env.ANALYSIS_WORKFLOW.get(id)).delete();
  } catch (error) {
    if (!(error instanceof Error && error.message === "instance.not_found"))
      throw new Error("WORKFLOW_CLEANUP_FAILED");
  }
}

export async function reconcileDeletion(
  env: Pick<Env, "DB" | "ANALYSIS_WORKFLOW">,
  now = new Date().toISOString(),
) {
  const rows = await env.DB.prepare(
    "SELECT id,workflow_instance_ids,deleted_at,attempts,cleanup_cursor,next_attempt_at,cleanup_state,expires_at FROM deletion_jobs WHERE primary_state='deleted' AND cleanup_state IN ('pending','completed') AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 10",
  )
    .bind(now)
    .all<CleanupJob>();
  for (const row of rows.results) {
    const startCursor = row.cleanup_state === "completed" ? 0 : row.cleanup_cursor;
    const attempt = row.attempts + 1;
    const lease = new Date(Date.parse(now) + 60_000).toISOString();
    const claim = await env.DB.prepare(
      "UPDATE deletion_jobs SET cleanup_state='pending',cleanup_cursor=?,attempts=attempts+1,next_attempt_at=? WHERE id=? AND cleanup_state=? AND attempts=? AND cleanup_cursor=? AND next_attempt_at=?",
    )
      .bind(
        startCursor,
        lease,
        row.id,
        row.cleanup_state,
        row.attempts,
        row.cleanup_cursor,
        row.next_attempt_at,
      )
      .run();
    if (claim.meta.changes !== 1) continue;
    let failed = false;
    let length = 0;
    try {
      if (row.attempts >= CLEANUP_ATTEMPTS) throw new Error("CLEANUP_BUDGET_EXHAUSTED");
      const ids = z
        .array(z.string().regex(/^[a-f0-9-]{36}-[123]$/))
        .parse(JSON.parse(row.workflow_instance_ids));
      length = ids.length;
      // Bounded calls, with a durable cursor. The journal itself is never shortened.
      for (const id of ids.slice(startCursor, startCursor + 10)) await removeWorkflow(env, id);
    } catch {
      failed = true;
    }
    const cursor = Math.min(length, startCursor + 10);
    const settled = Date.parse(now) - Date.parse(row.deleted_at) >= CLEANUP_SETTLE_MS;
    const terminal = failed && attempt >= CLEANUP_ATTEMPTS;
    const complete = !failed && cursor === length && settled;
    const next = failed
      ? new Date(Date.parse(now) + Math.min(15, 2 ** row.attempts) * 60_000).toISOString()
      : cursor === length && !settled
        ? new Date(Date.parse(row.deleted_at) + CLEANUP_SETTLE_MS).toISOString()
        : complete
          ? new Date(Date.parse(now) + DAY).toISOString()
          : now;
    await env.DB.prepare(
      "UPDATE deletion_jobs SET cleanup_state=?,cleanup_cursor=?,attempts=?,next_attempt_at=? WHERE id=? AND attempts=? AND cleanup_cursor=? AND next_attempt_at=?",
    )
      .bind(
        terminal ? "failed" : complete ? "completed" : "pending",
        failed ? startCursor : cursor === length && !settled ? 0 : cursor,
        failed ? Math.min(attempt, CLEANUP_ATTEMPTS) : 0,
        next,
        row.id,
        attempt,
        startCursor,
        lease,
      )
      .run();
    if (terminal)
      console.error(
        JSON.stringify({
          event: "deletion_cleanup_failed",
          jobId: row.id,
          attempts: Math.min(attempt, CLEANUP_ATTEMPTS),
        }),
      );
    // GC only the job successfully swept in this invocation after its expiry.
    if (complete && row.expires_at <= now)
      await env.DB.prepare(
        "DELETE FROM deletion_jobs WHERE id=? AND cleanup_state='completed' AND cleanup_cursor=? AND next_attempt_at=?",
      )
        .bind(row.id, cursor, next)
        .run();
  }
}

/** Restore source journal is held separately from the backup being restored. Traffic stays closed. */
export async function replayDeletionJournal(db: D1Database, input: unknown) {
  const jobs = deletionJournalSchema.parse(input);
  for (const job of jobs) {
    await db.batch([
      db
        .prepare(`INSERT INTO deletion_jobs(id,target_type,target_id,deleted_at,workflow_instance_ids,primary_state,cleanup_state,attempts,expires_at)
        VALUES(?,?,?,?,?,'deleted','pending',0,?) ON CONFLICT(id) DO UPDATE SET cleanup_state='pending',attempts=0,cleanup_cursor=0,next_attempt_at='1970-01-01T00:00:00.000Z'`)
        .bind(
          job.id,
          job.target_type,
          job.target_id,
          job.deleted_at,
          JSON.stringify(job.workflow_instance_ids),
          job.expires_at,
        ),
      ...(job.target_type === "account"
        ? [db.prepare("DELETE FROM app_metadata WHERE key=?").bind(`account-type:${job.target_id}`)]
        : []),
      db
        .prepare(
          job.target_type === "account"
            ? "DELETE FROM user WHERE id=?"
            : "DELETE FROM cases WHERE id=?",
        )
        .bind(job.target_id),
    ]);
  }
  return { replayed: jobs.length };
}

/** Opaque owner binding for an explicit deletion confirmation; no user ID is exposed. */
export async function deletionOwnerTag(secret: string, ownerId: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`deletion-owner:${ownerId}`)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
