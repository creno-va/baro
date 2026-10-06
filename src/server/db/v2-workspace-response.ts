import { z } from "zod";
import {
  type V2Action,
  type V2AssistantMessage,
  type V2Fact,
  type V2Summary,
  type V2TimelineEntry,
  v2ActionSchema,
  v2FactSchema,
  v2MessageSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
} from "../../contracts/v2";
import { guardSchema, parse, safe, sqlClaim, type V2Core, type WorkspaceGuard } from "./v2-core";
import {
  completeLeaseStatements,
  type JobLease,
  leasePredicate,
  referenceCommitPredicate,
  referencesAuthorized,
} from "./v2-workspace";

/** A validated response and all proposed factual updates become visible atomically. */
export function createV2WorkspaceResponseRepository(
  core: V2Core,
  guideHosts: readonly string[] = [],
) {
  return {
    commit(
      g: WorkspaceGuard,
      lease: JobLease,
      input: {
        message: V2AssistantMessage;
        facts: V2Fact[];
        parties: V2Summary["parties"];
        actions: V2Action[];
        timeline: V2TimelineEntry[];
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const message = parse(v2MessageSchema(guideHosts), input.message);
        if (message.role !== "assistant" || message.workspaceRevision !== g.expectedRevision)
          return false;
        const facts = parse(z.array(v2FactSchema).max(5), input.facts);
        const parties = parse(v2SummarySchema.shape.parties.max(5), input.parties);
        const actions = parse(z.array(v2ActionSchema).max(5), input.actions);
        const timeline = parse(z.array(v2TimelineEntrySchema).max(5), input.timeline);
        const current = await core
          .statement(
            "SELECT confirmed_summary_revision FROM v2_workspaces WHERE id=? AND owner_id=?",
            [g.workspaceId, g.ownerId],
          )
          .first<{ confirmed_summary_revision: number | null }>();
        const revision = current?.confirmed_summary_revision;
        if (!revision) return false;
        const references = [
          ...message.references,
          ...facts.flatMap((f) => f.references),
          ...actions.flatMap((a) => a.references),
          ...timeline.flatMap((t) => t.references),
        ];
        if (!(await referencesAuthorized(core, g, references))) return false;
        const existing = (
          await core
            .statement(
              "SELECT entity_id FROM v2_facts WHERE workspace_id=? AND summary_revision=?",
              [g.workspaceId, revision],
            )
            .all<{ entity_id: string }>()
        ).results;
        const ids = new Set(existing.map((f) => f.entity_id));
        if (
          new Set(facts.map((f) => f.id)).size !== facts.length ||
          facts.some((f) => ids.has(f.id))
        )
          return false;
        for (const fact of facts) ids.add(fact.id);
        if (
          facts.some((f) => f.conflictingFactIds.some((id) => !ids.has(id))) ||
          actions.some(
            (a) => a.revision !== 1 || a.status !== "todo" || a.factIds.some((id) => !ids.has(id)),
          ) ||
          timeline.some(
            (t) => t.revision !== 1 || t.userEdited || t.factIds.some((id) => !ids.has(id)),
          )
        )
          return false;
        for (const values of [parties, actions, timeline])
          if (new Set(values.map((v) => v.id)).size !== values.length) return false;
        const claimId = crypto.randomUUID(),
          execution = leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now),
          refs = referenceCommitPredicate(references);
        const statements = [
          core.claim(
            g,
            claimId,
            `${execution.sql} AND w.status='active' AND w.current_job_id=? AND w.confirmed_summary_revision=? AND EXISTS(SELECT 1 FROM v2_jobs WHERE id=? AND operation_id=? AND kind='chat_response') AND ${refs.sql}
          AND (SELECT count(*) FROM v2_facts WHERE workspace_id=w.id AND summary_revision=?) + ? <= 300
          AND (SELECT count(*) FROM v2_parties WHERE workspace_id=w.id AND summary_revision=?) + ? <= 30
          AND NOT EXISTS(SELECT 1 FROM v2_facts WHERE workspace_id=w.id AND summary_revision=? AND entity_id IN (SELECT value FROM json_each(?)))
          AND NOT EXISTS(SELECT 1 FROM v2_parties WHERE workspace_id=w.id AND summary_revision=? AND entity_id IN (SELECT value FROM json_each(?)))
          AND NOT EXISTS(SELECT 1 FROM v2_actions WHERE workspace_id=w.id AND entity_id IN (SELECT value FROM json_each(?)))
          AND NOT EXISTS(SELECT 1 FROM v2_timeline WHERE workspace_id=w.id AND entity_id IN (SELECT value FROM json_each(?)))`,
            [
              ...execution.values,
              lease.jobId,
              revision,
              lease.jobId,
              message.operationId,
              ...refs.values,
              revision,
              facts.length,
              revision,
              parties.length,
              revision,
              JSON.stringify(facts.map((f) => f.id)),
              revision,
              JSON.stringify(parties.map((p) => p.id)),
              JSON.stringify(actions.map((a) => a.id)),
              JSON.stringify(timeline.map((t) => t.id)),
            ],
          ),
        ];
        for (const fact of facts) {
          const id = crypto.randomUUID(),
            payload = await core.encrypt("v2_facts", id, g.ownerId, revision, fact);
          const rows = fact.references.map((ref, ordinal) => ({
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
              `INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
              [id, fact.id, g.workspaceId, revision, revision, payload, claimId],
            ),
            core.statement(
              `INSERT INTO v2_fact_references(fact_id,ordinal,kind,source_id,source_revision) SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.kind'),json_extract(value,'$.sourceId'),json_extract(value,'$.revision') FROM json_each(?) WHERE ${sqlClaim}`,
              [id, JSON.stringify(rows), claimId],
            ),
          );
        }
        for (const party of parties) {
          const id = crypto.randomUUID(),
            payload = await core.encrypt("v2_parties", id, g.ownerId, revision, party);
          statements.push(
            core.statement(
              `INSERT INTO v2_parties(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
              [id, party.id, g.workspaceId, revision, revision, payload, claimId],
            ),
          );
        }
        for (const action of actions) {
          const id = crypto.randomUUID(),
            payload = await core.encrypt("v2_actions", id, g.ownerId, 1, action);
          statements.push(
            core.statement(
              `INSERT INTO v2_actions(id,entity_id,workspace_id,revision,kind,status,encrypted_payload) SELECT ?,?,?,1,?,?,? WHERE ${sqlClaim}`,
              [id, action.id, g.workspaceId, action.kind, action.status, payload, claimId],
            ),
          );
        }
        for (const entry of timeline) {
          const id = crypto.randomUUID(),
            payload = await core.encrypt("v2_timeline", id, g.ownerId, 1, entry);
          statements.push(
            core.statement(
              `INSERT INTO v2_timeline(id,entity_id,workspace_id,revision,encrypted_payload) SELECT ?,?,?,1,? WHERE ${sqlClaim}`,
              [id, entry.id, g.workspaceId, payload, claimId],
            ),
          );
        }
        const payload = await core.encrypt("v2_messages", message.id, g.ownerId, 1, message);
        statements.push(
          core.statement(
            `INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,safety,encrypted_payload,created_at) SELECT ?,?,?,?,'assistant','validated',?,? WHERE ${sqlClaim}`,
            [
              message.id,
              g.workspaceId,
              g.expectedRevision,
              message.operationId,
              payload,
              g.now,
              claimId,
            ],
          ),
          ...completeLeaseStatements(core, lease, claimId, g.now),
          core.statement(
            `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
          ),
          core.bump(g, claimId),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
  };
}
