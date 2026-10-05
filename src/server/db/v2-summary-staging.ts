import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import { type V2Fact, type V2Summary, v2FactSchema, v2SummarySchema } from "../../contracts/v2";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  parse,
  safe,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import {
  completeLeaseStatements,
  type JobLease,
  leasePredicate,
  referencesAuthorized,
} from "./v2-workspace";

export function createV2SummaryStagingRepository(core: V2Core) {
  return {
    stagePage(
      g: WorkspaceGuard,
      snapshotId: string,
      input: { facts: readonly V2Fact[]; parties: readonly V2Summary["parties"][number][] },
      lease: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, snapshotId);
        const facts = parse(z.array(v2FactSchema).max(4), input.facts);
        const parties = parse(v2SummarySchema.shape.parties.max(4), input.parties);
        if (utf8Bytes(JSON.stringify(input)) > 98304)
          throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
        if (
          !(await referencesAuthorized(
            core,
            g,
            facts.flatMap((f) => f.references),
          ))
        )
          return false;
        const header = await core
          .statement(
            "SELECT revision FROM v2_private_snapshots WHERE id=? AND owner_id=? AND workspace_id=? AND purpose='summary' AND target_id=? AND state='staging'",
            [snapshotId, g.ownerId, g.workspaceId, g.workspaceId],
          )
          .first<{ revision: number }>();
        if (!header) return false;
        const execution = leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now);
        const claimId = crypto.randomUUID();
        const statements = [
          core.claim(
            g,
            claimId,
            `${execution.sql} AND EXISTS(SELECT 1 FROM v2_private_snapshots WHERE id=? AND state='staging' AND workspace_revision=w.revision)`,
            [...execution.values, snapshotId],
          ),
        ];
        for (const fact of facts) {
          const old = await core
            .statement(
              "SELECT * FROM v2_facts WHERE workspace_id=? AND summary_revision=? AND entity_id=?",
              [g.workspaceId, header.revision, fact.id],
            )
            .first<{ id: string; encrypted_payload: string; snapshot_id: string }>();
          if (old) {
            if (
              old.snapshot_id !== snapshotId ||
              JSON.stringify(
                await core.decrypt(
                  "v2_facts",
                  old.id,
                  g.ownerId,
                  header.revision,
                  old.encrypted_payload,
                  v2FactSchema,
                ),
              ) !== JSON.stringify(fact)
            )
              return false;
            continue;
          }
          const id = crypto.randomUUID();
          const payload = await core.encrypt("v2_facts", id, g.ownerId, header.revision, fact);
          const references = fact.references.map((ref, ordinal) => ({
            ordinal,
            kind: ref.kind,
            sourceId:
              ref.kind === "intake_narrative"
                ? g.workspaceId
                : ref.kind === "intake_answer"
                  ? ref.questionId
                  : ref.kind === "user_message"
                    ? ref.messageId
                    : ref.kind === "user_material"
                      ? ref.fileId
                      : ref.citationId,
            revision:
              ref.kind === "intake_narrative" || ref.kind === "intake_answer"
                ? ref.intakeRevision
                : ref.kind === "user_message"
                  ? ref.workspaceRevision
                  : ref.kind === "user_material"
                    ? ref.fileRevision
                    : null,
          }));
          statements.push(
            core.statement(
              `INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(workspace_id,summary_revision,entity_id) DO NOTHING`,
              [
                id,
                fact.id,
                g.workspaceId,
                header.revision,
                header.revision,
                snapshotId,
                payload,
                claimId,
              ],
            ),
            core.statement(
              `INSERT INTO v2_fact_references(fact_id,ordinal,kind,source_id,source_revision) SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.kind'),json_extract(value,'$.sourceId'),json_extract(value,'$.revision') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM v2_facts WHERE id=?) AND ${sqlClaim}`,
              [id, JSON.stringify(references), id, claimId],
            ),
          );
        }
        for (const party of parties) {
          const old = await core
            .statement(
              "SELECT * FROM v2_parties WHERE workspace_id=? AND summary_revision=? AND entity_id=?",
              [g.workspaceId, header.revision, party.id],
            )
            .first<{ id: string; encrypted_payload: string; snapshot_id: string }>();
          if (old) {
            if (
              old.snapshot_id !== snapshotId ||
              JSON.stringify(
                await core.decrypt(
                  "v2_parties",
                  old.id,
                  g.ownerId,
                  header.revision,
                  old.encrypted_payload,
                  v2SummarySchema.shape.parties.element,
                ),
              ) !== JSON.stringify(party)
            )
              return false;
            continue;
          }
          const id = crypto.randomUUID();
          const payload = await core.encrypt("v2_parties", id, g.ownerId, header.revision, party);
          statements.push(
            core.statement(
              `INSERT INTO v2_parties(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(workspace_id,summary_revision,entity_id) DO NOTHING`,
              [
                id,
                party.id,
                g.workspaceId,
                header.revision,
                header.revision,
                snapshotId,
                payload,
                claimId,
              ],
            ),
          );
        }
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    publish(
      g: WorkspaceGuard,
      snapshotId: string,
      input: {
        summaryId: string;
        summaryRevision: number;
        intakeRevision: number;
        factCount: number;
        partyCount: number;
      },
      lease: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, input.summaryId);
        parse(z.number().int().min(0).max(300), input.factCount);
        parse(z.number().int().min(0).max(30), input.partyCount);
        const execution = leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            `${execution.sql} AND w.status='intake' AND w.intake_revision=? AND EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.target_id=w.id AND s.purpose='summary' AND s.state='sealed' AND s.revision=? AND s.workspace_revision=w.revision AND (SELECT count(*) FROM v2_facts WHERE snapshot_id=s.id)=? AND (SELECT count(*) FROM v2_parties WHERE snapshot_id=s.id)=?)`,
            [
              ...execution.values,
              input.intakeRevision,
              snapshotId,
              input.summaryRevision,
              input.factCount,
              input.partyCount,
            ],
          ),
          core.statement(
            `INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              input.summaryId,
              g.workspaceId,
              input.summaryRevision,
              input.intakeRevision,
              snapshotId,
              g.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
            [snapshotId, claimId],
          ),
          core.statement(
            `UPDATE v2_intakes SET status='reviewing_summary',summary_id=?,current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
            [input.summaryId, g.workspaceId, claimId],
          ),
          core.statement(
            `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
          ),
          ...completeLeaseStatements(core, lease, claimId, g.now),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    partiesPage(
      actor: Actor,
      workspaceId: string,
      summaryRevision: number,
      afterId?: string,
      limit = 4,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(8), limit);
        const rows = await core
          .statement(
            `SELECT f.* FROM v2_parties f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND f.summary_revision=? AND ${aliveWorkspace} AND EXISTS(SELECT 1 FROM v2_summaries s WHERE s.workspace_id=w.id AND s.revision=f.summary_revision) ${afterId ? "AND f.entity_id>?" : ""} ORDER BY f.entity_id LIMIT ?`,
            [workspaceId, actor.ownerId, summaryRevision, ...(afterId ? [afterId] : []), limit],
          )
          .all<{ id: string; revision: number; encrypted_payload: string; entity_id: string }>();
        const parties = await Promise.all(
          rows.results.map((row) =>
            core.decrypt(
              "v2_parties",
              row.id,
              actor.ownerId,
              row.revision,
              row.encrypted_payload,
              v2SummarySchema.shape.parties.element,
            ),
          ),
        );
        if (
          !(await core
            .statement(
              `SELECT id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
              [workspaceId, actor.ownerId],
            )
            .first())
        )
          return { parties: [], nextId: null };
        return {
          parties,
          nextId: rows.results.length === limit ? (rows.results.at(-1)?.entity_id ?? null) : null,
        };
      });
    },
    factsPage(
      actor: Actor,
      workspaceId: string,
      summaryRevision: number,
      afterId?: string,
      limit = 4,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(8), limit);
        const rows = await core
          .statement(
            `SELECT f.* FROM v2_facts f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.id=? AND w.owner_id=? AND f.summary_revision=? AND ${aliveWorkspace} AND EXISTS(SELECT 1 FROM v2_summaries s WHERE s.workspace_id=w.id AND s.revision=f.summary_revision) ${afterId ? "AND f.entity_id>?" : ""} ORDER BY f.entity_id LIMIT ?`,
            [workspaceId, actor.ownerId, summaryRevision, ...(afterId ? [afterId] : []), limit],
          )
          .all<{ id: string; revision: number; encrypted_payload: string; entity_id: string }>();
        const facts = await Promise.all(
          rows.results.map((row) =>
            core.decrypt(
              "v2_facts",
              row.id,
              actor.ownerId,
              row.revision,
              row.encrypted_payload,
              v2FactSchema,
            ),
          ),
        );
        if (
          !(await core
            .statement(
              `SELECT id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
              [workspaceId, actor.ownerId],
            )
            .first())
        )
          return { facts: [], nextId: null };
        return {
          facts,
          nextId: rows.results.length === limit ? (rows.results.at(-1)?.entity_id ?? null) : null,
        };
      });
    },
  };
}
