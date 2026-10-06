import { z } from "zod";
import { timestampSchema } from "../../../contracts";
import type { V2Core } from "../../db/v2-core";
import {
  type ProfilePublicationParams,
  profilePublicationInstanceId,
} from "./publication-execution";

type Instance = { id: string; status(): Promise<{ status: string }> };
export type ProfilePublicationBinding = {
  create(options: { id: string; params: ProfilePublicationParams }): Promise<Instance>;
  get(id: string): Promise<Instance>;
};
const statuses = new Set([
  "queued",
  "running",
  "paused",
  "errored",
  "terminated",
  "complete",
  "waiting",
  "waitingForPause",
  "rollingBack",
]);
export function createProfilePublicationDispatcher(
  core: V2Core,
  options: { binding?: ProfilePublicationBinding; clock?: () => string; leaseMs?: number } = {},
) {
  const now = () =>
    new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const leaseMs = z
    .number()
    .int()
    .min(1000)
    .max(300000)
    .parse(options.leaseMs ?? 60000);
  return {
    async dispatch(limit = 8) {
      z.number().int().min(1).max(20).parse(limit);
      if (!options.binding) return { dispatched: 0, pending: 0, available: false };
      const at = now();
      const rows = (
        await core
          .statement(
            "SELECT id,operation_id,target_id,revision,attempts,next_attempt_at,created_at FROM v2_outbox WHERE kind='profile_publish' AND state IN ('pending','failed') AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?",
            [at, limit],
          )
          .all<{
            id: string;
            operation_id: string;
            target_id: string;
            revision: number;
            attempts: number;
            next_attempt_at: string;
            created_at: string;
          }>()
      ).results;
      let dispatched = 0,
        pending = 0;
      for (const row of rows) {
        const claimedAt = now(),
          until = new Date(Date.parse(claimedAt) + leaseMs).toISOString();
        const claim = await core
          .statement(
            "UPDATE v2_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND kind='profile_publish' AND operation_id=? AND target_id=? AND revision=? AND attempts=? AND next_attempt_at=? AND next_attempt_at<=? AND state IN ('pending','failed') AND EXISTS(SELECT 1 FROM v2_profiles p JOIN v2_profile_revisions revision ON revision.profile_id=p.id AND revision.revision=v2_outbox.revision JOIN v2_operations operation ON operation.id=v2_outbox.operation_id AND operation.owner_id=p.owner_id WHERE p.id=v2_outbox.target_id AND revision.status='approved' AND EXISTS(SELECT 1 FROM v2_moderation_decisions WHERE target_kind='profile' AND target_id=revision.id AND target_revision=revision.revision AND decision='approve') AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions newer WHERE newer.profile_id=p.id AND newer.status='approved' AND newer.revision>revision.revision) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=revision.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id)))",
            [
              until,
              row.id,
              row.operation_id,
              row.target_id,
              row.revision,
              row.attempts,
              row.next_attempt_at,
              claimedAt,
            ],
          )
          .run();
        if (claim.meta.changes !== 1) continue;
        const params = {
          outboxId: row.id,
          profileId: row.target_id,
          approvedRevision: row.revision,
          operationId: row.operation_id,
        };
        const id = profilePublicationInstanceId(params);
        let known = false;
        try {
          try {
            const instance = await options.binding.get(id);
            known = instance.id === id && statuses.has((await instance.status()).status);
          } catch {
            /* Absence and lookup ambiguity share the same safe create ID. */
          }
          // Platform instance IDs stop deduplicating after retention expiry.
          // Beyond a bounded creation window we only reconcile an existing ID.
          const canCreate =
            row.attempts === 0 || Date.parse(now()) < Date.parse(row.created_at) + 86400000;
          if (!known && canCreate && Date.parse(now()) < Date.parse(until)) {
            const live = await core
              .statement(
                "SELECT outbox.id FROM v2_outbox outbox JOIN v2_profiles p ON p.id=outbox.target_id JOIN v2_profile_revisions revision ON revision.profile_id=p.id AND revision.revision=outbox.revision WHERE outbox.id=? AND outbox.kind='profile_publish' AND outbox.operation_id=? AND outbox.target_id=? AND outbox.revision=? AND outbox.attempts=? AND outbox.next_attempt_at=? AND outbox.next_attempt_at>? AND outbox.state IN ('pending','failed') AND revision.status='approved' AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions newer WHERE newer.profile_id=p.id AND newer.status='approved' AND newer.revision>revision.revision) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=revision.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))",
                [
                  row.id,
                  row.operation_id,
                  row.target_id,
                  row.revision,
                  row.attempts + 1,
                  until,
                  now(),
                ],
              )
              .first();
            if (!live) {
              pending++;
              continue;
            }
            try {
              const instance = await options.binding.create({ id, params });
              known = instance.id === id && statuses.has((await instance.status()).status);
            } catch {
              const instance = await options.binding.get(id);
              known = instance.id === id && statuses.has((await instance.status()).status);
            }
          }
        } catch {
          /* Keep the durable lease; recovery only reconciles the same ID. */
        }
        if (!known) {
          pending++;
          continue;
        }
        const ack = await core
          .statement(
            "UPDATE v2_outbox SET state='dispatched' WHERE id=? AND kind='profile_publish' AND operation_id=? AND target_id=? AND revision=? AND attempts=? AND next_attempt_at=? AND state IN ('pending','failed')",
            [row.id, row.operation_id, row.target_id, row.revision, row.attempts + 1, until],
          )
          .run();
        if (ack.meta.changes === 1) dispatched++;
        else pending++;
      }
      return { dispatched, pending, available: true };
    },
  };
}
