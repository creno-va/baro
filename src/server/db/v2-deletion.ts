import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type Actor,
  actorSchema,
  guardSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";

export interface CleanupLease {
  journalId: string;
  token: string;
  fencing: number;
}
export const cleanupLeaseSchema = z.strictObject({
  journalId: opaqueIdSchema,
  token: opaqueIdSchema,
  fencing: z.number().int().positive(),
});
export function createV2DeletionRepository(core: V2Core) {
  return {
    workspace(g: WorkspaceGuard) {
      return safe(async () => {
        g = parse(guardSchema, g);
        return Boolean(
          await core
            .statement(
              "DELETE FROM v2_workspaces WHERE id=? AND owner_id=? AND revision=? RETURNING id",
              [g.workspaceId, g.ownerId, g.expectedRevision],
            )
            .first(),
        );
      });
    },
    file(g: WorkspaceGuard, id: string, expectedFileRevision: number) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_files WHERE id=? AND workspace_id=w.id AND revision=?)",
            [id, expectedFileRevision],
          ),
          core.statement(`DELETE FROM v2_files WHERE id=? AND workspace_id=? AND ${sqlClaim}`, [
            id,
            g.workspaceId,
            claimId,
          ]),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    report(g: WorkspaceGuard, id: string, expectedReportRevision: number) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        parse(z.number().int().positive().max(Number.MAX_SAFE_INTEGER), expectedReportRevision);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_reports WHERE id=? AND workspace_id=w.id AND revision=?)",
            [id, expectedReportRevision],
          ),
          core.statement(`DELETE FROM v2_reports WHERE id=? AND workspace_id=? AND ${sqlClaim}`, [
            id,
            g.workspaceId,
            claimId,
          ]),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    profile(actor: Actor, id: string, expectedRevision: number) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        return Boolean(
          await core
            .statement(
              "DELETE FROM v2_profiles WHERE id=? AND owner_id=? AND revision=? RETURNING id",
              [id, actor.ownerId, expectedRevision],
            )
            .first(),
        );
      });
    },
    asset(actor: Actor, id: string, expectedRevision: number) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        return Boolean(
          await core
            .statement(
              "DELETE FROM v2_assets WHERE id=? AND owner_id=? AND revision=? RETURNING id",
              [id, actor.ownerId, expectedRevision],
            )
            .first(),
        );
      });
    },
    account(actor: Actor, sessionId: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, sessionId);
        const time = Date.parse(actor.now);
        const sessionGuard =
          "EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=? AND expires_at>? AND oauth_authenticated_at BETWEEN ? AND ?)";
        const args = [sessionId, actor.ownerId, time, time - 600000, time];
        // Metadata is not covered by user cascades. The same authenticated
        // predicate and atomic batch preserve it on rejection or SQL failure.
        const rows = await core.binding.batch<{ id: string }>([
          core.statement(
            `DELETE FROM app_metadata WHERE key=? AND EXISTS(SELECT 1 FROM user WHERE id=?) AND ${sessionGuard}`,
            [`account-type:${actor.ownerId}`, actor.ownerId, ...args],
          ),
          core.statement(`DELETE FROM user WHERE id=? AND ${sessionGuard} RETURNING id`, [
            actor.ownerId,
            ...args,
          ]),
        ]);
        return rows[1]?.results[0]?.id === actor.ownerId;
      });
    },
    findByTarget(kind: string, id: string) {
      return safe(async () => {
        parse(
          z.enum([
            "account",
            "workspace",
            "file",
            "profile",
            "asset",
            "report",
            "blob",
            "publication",
          ]),
          kind,
        );
        parse(opaqueIdSchema, id);
        return core
          .statement(
            "SELECT id,state,revision,cursor,attempts,created_at,completed_at FROM v2_deletion_journals WHERE target_kind=? AND target_id=?",
            [kind, id],
          )
          .first<{
            id: string;
            state: string;
            revision: number;
            cursor: number;
            attempts: number;
            created_at: string;
            completed_at: string | null;
          }>();
      });
    },
    pending(now: string, limit = 20) {
      return safe(async () => {
        parse(timestampSchema, now);
        parse(z.number().int().min(1).max(50), limit);
        return (
          await core
            .statement(
              "SELECT id,target_kind,target_id,state,revision,attempts,created_at FROM v2_deletion_journals WHERE state IN ('pending','failed','running') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at,id LIMIT ?",
              [new Date(now).toISOString(), new Date(now).toISOString(), limit],
            )
            .all<{
              id: string;
              target_kind: string;
              target_id: string;
              state: string;
              revision: number;
              attempts: number;
              created_at: string;
            }>()
        ).results;
      });
    },
    acquire(id: string, token: string, now: string, until: string) {
      return safe(async () => {
        parse(opaqueIdSchema, id);
        parse(opaqueIdSchema, token);
        parse(timestampSchema, now);
        parse(timestampSchema, until);
        now = new Date(now).toISOString();
        until = new Date(until).toISOString();
        if (Date.parse(until) <= Date.parse(now) || Date.parse(until) - Date.parse(now) > 300000)
          return null;
        const row = await core
          .statement(
            "UPDATE v2_deletion_journals SET state='running',lease_token=?,lease_until=?,fencing=fencing+1,attempts=attempts+1 WHERE id=? AND state IN ('pending','failed','running') AND (lease_until IS NULL OR lease_until<=?) RETURNING fencing",
            [token, until, id, now],
          )
          .first<{ fencing: number }>();
        return row ? { journalId: id, token, fencing: row.fencing } : null;
      });
    },
    targets(lease: CleanupLease, now: string, limit = 8) {
      return safe(async () => {
        parse(cleanupLeaseSchema, lease);
        parse(timestampSchema, now);
        parse(z.number().int().min(1).max(20), limit);
        return (
          await core
            .statement(
              "SELECT t.ordinal,t.kind,t.target_id,t.state,b.object_key FROM v2_deletion_targets t JOIN v2_deletion_journals j ON j.id=t.journal_id LEFT JOIN v2_blobs b ON t.kind='blob' AND b.id=t.target_id WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running' AND t.state='pending' ORDER BY CASE t.kind WHEN 'job' THEN 0 WHEN 'legacy_workflow' THEN 0 WHEN 'blob' THEN 1 ELSE 2 END,t.ordinal LIMIT ?",
              [lease.journalId, lease.token, lease.fencing, new Date(now).toISOString(), limit],
            )
            .all<{
              ordinal: number;
              kind: "blob" | "job" | "legacy_workflow" | "reservation";
              target_id: string;
              state: string;
              object_key: string | null;
            }>()
        ).results;
      });
    },
    recordReceipt(
      lease: CleanupLease,
      input: {
        receiptId: string;
        kind: "blob" | "job" | "legacy_workflow" | "reservation";
        targetId: string;
        now: string;
      },
    ) {
      return safe(async () => {
        parse(cleanupLeaseSchema, lease);
        parse(opaqueIdSchema, input.receiptId);
        parse(opaqueIdSchema, input.targetId);
        parse(timestampSchema, input.now);
        const now = new Date(input.now).toISOString();
        const rows = await core.binding.batch([
          core.statement(
            "INSERT INTO v2_cleanup_receipts(id,journal_id,kind,target_id,confirmed_at) SELECT ?,j.id,?,?,? FROM v2_deletion_journals j JOIN v2_deletion_targets t ON t.journal_id=j.id WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running' AND t.kind=? AND t.target_id=? AND t.state='pending' AND (?!='blob' OR EXISTS(SELECT 1 FROM v2_blobs WHERE id=t.target_id AND state='deleted')) AND (?!='reservation' OR EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=t.target_id AND state='released')) ON CONFLICT(journal_id,kind,target_id) DO NOTHING",
            [
              input.receiptId,
              input.kind,
              input.targetId,
              now,
              lease.journalId,
              lease.token,
              lease.fencing,
              now,
              input.kind,
              input.targetId,
              input.kind,
              input.kind,
            ],
          ),
          core.statement(
            "UPDATE v2_deletion_targets SET state='completed' WHERE journal_id=? AND kind=? AND target_id=? AND EXISTS(SELECT 1 FROM v2_cleanup_receipts r JOIN v2_deletion_journals j ON j.id=r.journal_id WHERE r.id=? AND r.journal_id=v2_deletion_targets.journal_id AND r.kind=v2_deletion_targets.kind AND r.target_id=v2_deletion_targets.target_id AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running')",
            [
              lease.journalId,
              input.kind,
              input.targetId,
              input.receiptId,
              lease.token,
              lease.fencing,
              now,
            ],
          ),
          core.statement(
            "UPDATE v2_deletion_journals SET cursor=(SELECT count(*) FROM v2_deletion_targets WHERE journal_id=? AND state='completed') WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND state='running'",
            [lease.journalId, lease.journalId, lease.token, lease.fencing, now],
          ),
        ]);
        return rows[0]?.meta.changes === 1;
      });
    },
    finish(lease: CleanupLease, now: string) {
      return safe(async () => {
        parse(cleanupLeaseSchema, lease);
        parse(timestampSchema, now);
        return (
          (
            await core
              .statement(
                "UPDATE v2_deletion_journals SET state='completed',completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND state='running' AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets WHERE journal_id=v2_deletion_journals.id AND state='pending')",
                [
                  new Date(now).toISOString(),
                  lease.journalId,
                  lease.token,
                  lease.fencing,
                  new Date(now).toISOString(),
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    fail(lease: CleanupLease, now: string, nextAttemptAt: string) {
      return safe(async () => {
        parse(cleanupLeaseSchema, lease);
        parse(timestampSchema, now);
        parse(timestampSchema, nextAttemptAt);
        return (
          (
            await core
              .statement(
                "UPDATE v2_deletion_journals SET state='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=? WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND state='running'",
                [
                  new Date(nextAttemptAt).toISOString(),
                  lease.journalId,
                  lease.token,
                  lease.fencing,
                  new Date(now).toISOString(),
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
  };
}
