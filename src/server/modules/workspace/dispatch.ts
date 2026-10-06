import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import type { V2Core } from "../../db/v2-core";
import { jobAlive } from "../../db/v2-jobs";
import { type WorkspaceParams, workspaceParamsSchema } from "./execution";

type Instance = { id: string; status(): Promise<{ status: string }> };
type Binding = {
  get(id: string): Promise<Instance>;
  create(input: { id: string; params: WorkspaceParams }): Promise<Instance>;
};
const joins =
  "FROM v2_outbox x JOIN v2_jobs j ON j.id=x.job_id JOIN v2_operations o ON o.id=j.operation_id";
const live = `x.kind='job_dispatch' AND x.operation_id=j.operation_id AND x.target_id=j.runtime_instance_id AND j.target_kind='workspace' AND j.kind IN ('intake_questions','intake_summary','chat_response') AND o.state='admitted' AND j.status IN ('queued','running','validating') AND ${jobAlive} AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=o.owner_id AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1)`;
const consent = [
  CURRENT_POLICY_VERSIONS.termsVersion,
  CURRENT_POLICY_VERSIONS.privacyVersion,
  CURRENT_POLICY_VERSIONS.aiNoticeVersion,
];
export function createWorkspaceDispatcher(
  core: V2Core,
  options: { binding?: Binding; clock?: () => string } = {},
) {
  const now = options.clock ?? (() => new Date().toISOString());
  return {
    async dispatch(limit = 4) {
      z.number().int().min(1).max(20).parse(limit);
      if (!options.binding) return { dispatched: 0, pending: 0, available: false };
      const rows = (
        await core
          .statement(
            `SELECT x.id,x.attempts,x.next_attempt_at,x.created_at,j.id job_id,j.runtime_instance_id,j.target_id,j.target_revision,o.owner_id ${joins} WHERE ${live} AND x.state IN ('pending','failed') AND x.next_attempt_at<=? ORDER BY x.created_at,x.id LIMIT ?`,
            [...consent, now(), limit],
          )
          .all<{
            id: string;
            attempts: number;
            next_attempt_at: string;
            created_at: string;
            job_id: string;
            runtime_instance_id: string;
            target_id: string;
            target_revision: number;
            owner_id: string;
          }>()
      ).results;
      let dispatched = 0,
        pending = 0;
      for (const row of rows) {
        const at = now(),
          until = new Date(Date.parse(at) + 60000).toISOString();
        const claim = await core
          .statement(
            `UPDATE v2_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND attempts=? AND next_attempt_at=? AND state IN ('pending','failed') AND EXISTS(SELECT 1 ${joins} WHERE x.id=v2_outbox.id AND ${live})`,
            [until, row.id, row.attempts, row.next_attempt_at, ...consent],
          )
          .run();
        if (claim.meta.changes !== 1) continue;
        const params = workspaceParamsSchema.parse({
          ownerId: row.owner_id,
          workspaceId: row.target_id,
          workspaceRevision: row.target_revision,
          jobId: row.job_id,
        });
        let known = false;
        const check = async () => {
          const instance = await options.binding?.get(row.runtime_instance_id);
          return (
            instance?.id === row.runtime_instance_id &&
            new Set([
              "queued",
              "running",
              "paused",
              "waiting",
              "complete",
              "errored",
              "terminated",
              "waitingForPause",
              "rollingBack",
            ]).has((await instance.status()).status)
          );
        };
        try {
          known = await check().catch(() => false);
          if (
            !known &&
            Date.parse(now()) < Date.parse(until) &&
            (row.attempts === 0 || Date.parse(now()) < Date.parse(row.created_at) + 86400000)
          ) {
            const active = await core
              .statement(
                `SELECT j.id ${joins} WHERE x.id=? AND x.attempts=? AND x.next_attempt_at=? AND ${live} AND j.status='queued'`,
                [row.id, row.attempts + 1, until, ...consent],
              )
              .first();
            if (active) {
              try {
                const instance = await options.binding.create({
                  id: row.runtime_instance_id,
                  params,
                });
                known = instance.id === row.runtime_instance_id;
              } catch {
                known = await check();
              }
            }
          }
        } catch {
          /* Preserve the lease and only reconcile this immutable instance ID. */
        }
        if (!known) {
          pending++;
          continue;
        }
        const ack = await core
          .statement(
            "UPDATE v2_outbox SET state='dispatched' WHERE id=? AND attempts=? AND next_attempt_at=? AND state IN ('pending','failed')",
            [row.id, row.attempts + 1, until],
          )
          .run();
        if (ack.meta.changes === 1) dispatched++;
      }
      return { dispatched, pending, available: true };
    },
  };
}
