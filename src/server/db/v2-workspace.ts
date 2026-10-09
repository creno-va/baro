import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import {
  V2_INTAKE_POLICY,
  type V2Action,
  type V2CreateCaseRequest,
  type V2FactReference,
  type V2Intake,
  type V2Message,
  type V2QuestionBatch,
  type V2ReferenceContext,
  type V2Summary,
  type V2SummaryEditRequest,
  type V2TimelineEntry,
  type V2Workspace,
  v2ActionSchema,
  v2AnswersForBatchSchema,
  v2CreateCaseRequestSchema,
  v2FileProbeSchema,
  v2IntakeSchema,
  v2MessageSchema,
  v2QuestionBatchSchema,
  v2ReferenceIsAuthorized,
  v2SummaryConfirmationRequestSchema,
  v2SummaryEditForFactsSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
  v2UserMessageSchema,
  v2WorkspaceSchema,
} from "../../contracts/v2";
import type { EnvelopeCipher } from "../crypto";
import { usageDateKst } from "./repository";
import {
  createV2AccountingRepository,
  operationStatements,
  quotaPredicate,
  quotaStatements,
  quotaTransitionStatements,
} from "./v2-accounting";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  createV2Core,
  guardSchema,
  hashSchema,
  parse,
  readSnapshot,
  safe,
  snapshotStatements,
  sqlClaim,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { appendSummaryEntities, summaryAdditions } from "./v2-current-summary";
import { type MutationReceipt, mutationTools } from "./v2-mutation-receipts";
import { createV2StagingRepository } from "./v2-staging";

export interface Admission {
  operationId: string;
  key: string;
  requestHash: string;
}
export const admissionSchema = z.strictObject({
  operationId: opaqueIdSchema,
  key: z.string().min(1).max(128),
  requestHash: hashSchema,
});
export interface JobLease {
  jobId: string;
  token: string;
  fencing: number;
}
export const leaseSchema = z.strictObject({
  jobId: opaqueIdSchema,
  token: opaqueIdSchema,
  fencing: z.number().int().positive(),
});
export function leasePredicate(
  lease: JobLease,
  targetId: string,
  targetRevision: number,
  now: string,
): { sql: string; values: unknown[] } {
  parse(leaseSchema, lease);
  return {
    sql: "EXISTS(SELECT 1 FROM v2_jobs j WHERE j.id=? AND j.target_id=? AND j.target_revision=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating'))",
    values: [lease.jobId, targetId, targetRevision, lease.token, lease.fencing, now],
  };
}
export function completeLeaseStatements(
  core: V2Core,
  lease: JobLease,
  claimId: string,
  now: string,
): D1PreparedStatement[] {
  return [
    core.statement(
      `UPDATE v2_jobs SET status='completed',phase='finished',progress=100,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${sqlClaim}`,
      [now, lease.jobId, claimId],
    ),
    core.statement(
      `UPDATE v2_operations SET state='completed' WHERE id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
      [lease.jobId, claimId],
    ),
    ...quotaTransitionStatements(core, lease.jobId, claimId, "consumed", undefined, true),
  ];
}

export async function referencesAuthorized(
  core: V2Core,
  g: WorkspaceGuard,
  references: readonly V2FactReference[],
): Promise<boolean> {
  const intake = await core
    .statement(
      `SELECT i.revision FROM v2_intakes i JOIN v2_workspaces w ON w.id=i.id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
      [g.workspaceId, g.ownerId],
    )
    .first<{ revision: number }>();
  if (!intake) return false;
  const answers = await core
    .statement(
      "SELECT a.question_id FROM v2_answers a JOIN v2_question_batches b ON b.id=a.batch_id WHERE b.workspace_id=? AND a.status='answered'",
      [g.workspaceId],
    )
    .all<{ question_id: string }>();
  const messageIds = [
    ...new Set(references.flatMap((r) => (r.kind === "user_message" ? [r.messageId] : []))),
  ];
  const fileIds = [
    ...new Set(references.flatMap((r) => (r.kind === "user_material" ? [r.fileId] : []))),
  ];
  const citationIds = [
    ...new Set(references.flatMap((r) => (r.kind === "official_source" ? [r.citationId] : []))),
  ];
  const messages = await core
    .statement(
      "SELECT id,workspace_revision FROM v2_messages WHERE workspace_id=? AND role='user' AND id IN (SELECT value FROM json_each(?))",
      [g.workspaceId, JSON.stringify(messageIds)],
    )
    .all<{ id: string; workspace_revision: number }>();
  const rows = await core
    .statement(
      "SELECT id,revision,encrypted_payload FROM v2_files WHERE workspace_id=? AND state='ready' AND id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=v2_files.id)",
      [g.workspaceId, JSON.stringify(fileIds)],
    )
    .all<{ id: string; revision: number; encrypted_payload: string }>();
  const citations = await core
    .statement(
      "SELECT id FROM v2_citation_bindings WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?))",
      [g.workspaceId, JSON.stringify(citationIds)],
    )
    .all<{ id: string }>();
  const files: V2ReferenceContext["files"][number][] = [];
  for (const row of rows.results) {
    const metadata = await core.decrypt(
      "v2_files",
      row.id,
      g.ownerId,
      row.revision,
      row.encrypted_payload,
      z.strictObject({
        name: z.string(),
        declaredMediaType: z.string(),
        probe: v2FileProbeSchema.nullable(),
      }),
    );
    const probe = metadata.probe;
    if (!probe) continue;
    files.push({
      id: row.id,
      revision: row.revision,
      category: probe.category,
      ...("pageCount" in probe ? { pageCount: probe.pageCount } : {}),
      ...("durationSeconds" in probe ? { durationSeconds: probe.durationSeconds } : {}),
      ...("hasAudio" in probe ? { hasAudio: probe.hasAudio } : {}),
    });
  }
  const context = {
    intakeRevision: intake.revision,
    answeredQuestionIds: answers.results.map((a) => a.question_id),
    messages: messages.results.map((m) => ({ id: m.id, workspaceRevision: m.workspace_revision })),
    files,
    verifiedCitationIds: citations.results.map((c) => c.id),
  };
  return references.every((ref) => v2ReferenceIsAuthorized(ref, context));
}

export function referenceCommitPredicate(references: readonly V2FactReference[]): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT ((json_extract(ref.value,'$.kind')='intake_narrative' AND json_extract(ref.value,'$.intakeRevision')=w.intake_revision) OR (json_extract(ref.value,'$.kind')='intake_answer' AND json_extract(ref.value,'$.intakeRevision')=w.intake_revision AND EXISTS(SELECT 1 FROM v2_answers a JOIN v2_question_batches b ON b.id=a.batch_id WHERE b.workspace_id=w.id AND a.question_id=json_extract(ref.value,'$.questionId') AND a.status='answered')) OR (json_extract(ref.value,'$.kind')='user_message' AND EXISTS(SELECT 1 FROM v2_messages m WHERE m.id=json_extract(ref.value,'$.messageId') AND m.workspace_id=w.id AND m.role='user' AND m.workspace_revision=json_extract(ref.value,'$.workspaceRevision'))) OR (json_extract(ref.value,'$.kind')='user_material' AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=json_extract(ref.value,'$.fileId') AND f.workspace_id=w.id AND f.revision=json_extract(ref.value,'$.fileRevision') AND f.state='ready' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))) OR (json_extract(ref.value,'$.kind')='official_source' AND EXISTS(SELECT 1 FROM v2_citation_bindings c WHERE c.id=json_extract(ref.value,'$.citationId') AND c.workspace_id=w.id))))`,
    values: [JSON.stringify(references)],
  };
}

export function createV2WorkspaceRepository(
  binding: D1Database,
  cipher: EnvelopeCipher,
  guideHosts: readonly string[] = [],
) {
  const core = createV2Core(binding, cipher);
  const accounting = createV2AccountingRepository(core);
  const findWorkspace = async (actor: Actor, id: string): Promise<V2Workspace | null> => {
    actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
    parse(opaqueIdSchema, id);
    const row = await core
      .statement(
        `SELECT w.* FROM v2_workspaces w WHERE w.owner_id=? AND w.id=? AND ${aliveWorkspace}`,
        [actor.ownerId, id],
      )
      .first<{
        id: string;
        revision: number;
        intake_revision: number;
        status: string;
        archived_from: string | null;
        confirmed_summary_revision: number | null;
        current_job_id: string | null;
        legacy_snapshot_id: string | null;
        encrypted_payload: string;
        created_at: string;
        updated_at: string;
      }>();
    if (!row) return null;
    const content = await core.decrypt(
      "v2_workspaces",
      id,
      actor.ownerId,
      1,
      row.encrypted_payload,
      z.strictObject({
        subjectContext: z.enum(["individual", "company"]),
        jurisdiction: z.literal("KR"),
      }),
    );
    const value = parse(v2WorkspaceSchema, {
      schemaVersion: "2",
      id,
      title: "사건 작업 공간",
      ...content,
      status: row.status,
      archivedFrom: row.archived_from,
      workspaceRevision: row.revision,
      intakeRevision: row.intake_revision,
      confirmedSummaryRevision: row.confirmed_summary_revision,
      currentJobId: row.current_job_id,
      legacySnapshotId: row.legacy_snapshot_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return (await core
      .statement(
        `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}`,
        [id, actor.ownerId, row.revision],
      )
      .first())
      ? value
      : null;
  };
  const readIntake = async (actor: Actor, id: string): Promise<V2Intake | null> => {
    const currentWorkspace = await findWorkspace(actor, id);
    if (!currentWorkspace) return null;
    const row = await core.statement("SELECT * FROM v2_intakes WHERE id=?", [id]).first<{
      revision: number;
      status: string;
      summary_id: string | null;
      confirmed_summary_revision: number | null;
      current_job_id: string | null;
      encrypted_payload: string;
    }>();
    if (!row) return null;
    const narrative = await core.decrypt(
      "v2_intakes",
      id,
      actor.ownerId,
      1,
      row.encrypted_payload,
      z.strictObject({ narrative: v2CreateCaseRequestSchema.shape.narrative }),
    );
    const batches = await core
      .statement("SELECT * FROM v2_question_batches WHERE workspace_id=? ORDER BY ordinal", [id])
      .all<{ id: string; revision: number; encrypted_payload: string }>();
    const decoded: V2QuestionBatch[] = [];
    for (const batch of batches.results) {
      const body = await core.decrypt(
        "v2_question_batches",
        batch.id,
        actor.ownerId,
        batch.revision,
        batch.encrypted_payload,
        v2QuestionBatchSchema,
      );
      const answers = await core
        .statement("SELECT * FROM v2_answers WHERE batch_id=? ORDER BY question_id", [batch.id])
        .all<{ id: string; revision: number; encrypted_payload: string }>();
      body.answers = [];
      for (const answer of answers.results)
        body.answers.push(
          await core.decrypt(
            "v2_answers",
            answer.id,
            actor.ownerId,
            answer.revision,
            answer.encrypted_payload,
            v2QuestionBatchSchema.shape.answers.element,
          ),
        );
      decoded.push(parse(v2QuestionBatchSchema, body));
    }
    let summary: V2Summary | null = null;
    if (row.summary_id) {
      const header = await core
        .statement("SELECT * FROM v2_summaries WHERE id=? AND workspace_id=?", [row.summary_id, id])
        .first<{ snapshot_id: string; revision: number }>();
      if (!header) throw new V2RepositoryError("SNAPSHOT_INVALID");
      summary = await readSnapshot(
        core,
        actor,
        header.snapshot_id,
        "summary",
        id,
        header.revision,
        v2SummarySchema,
      );
    }
    if (summary) {
      // Compatibility snapshots written before staging have no normalized snapshot_id.
      const factIds = new Set(summary.facts.map((fact) => fact.id));
      const partyIds = new Set(summary.parties.map((party) => party.id));
      for await (const value of summaryAdditions(core, actor, id, summary.revision, "facts"))
        if (!factIds.has(value.id))
          summary.facts.push(parse(v2SummarySchema.shape.facts.element, value));
      for await (const value of summaryAdditions(core, actor, id, summary.revision, "parties"))
        if (!partyIds.has(value.id))
          summary.parties.push(parse(v2SummarySchema.shape.parties.element, value));
    }
    const value = parse(v2IntakeSchema, {
      schemaVersion: "2",
      revision: row.revision,
      status: row.status,
      narrative: narrative.narrative,
      batches: decoded,
      summary,
      confirmedSummaryRevision: row.confirmed_summary_revision,
      currentJobId: row.current_job_id,
    });
    return (await core
      .statement(
        `SELECT i.id FROM v2_intakes i JOIN v2_workspaces w ON w.id=i.id WHERE i.id=? AND w.owner_id=? AND i.revision=? AND i.status=? AND i.summary_id IS ? AND w.revision=? AND ${aliveWorkspace}`,
        [
          id,
          actor.ownerId,
          row.revision,
          row.status,
          row.summary_id,
          currentWorkspace.workspaceRevision,
        ],
      )
      .first())
      ? value
      : null;
  };
  const writeSummary = async (
    g: WorkspaceGuard,
    summary: V2Summary,
    lease: JobLease | null,
    ownerEdit = false,
    receipt?: MutationReceipt,
  ) => {
    g = parse(guardSchema, g);
    const mutation = mutationTools(core, g, receipt);
    const value = parse(v2SummarySchema, summary);
    const current = await readIntake(g, g.workspaceId);
    if (
      !current ||
      current.revision !== value.intakeRevision ||
      (ownerEdit && !current.summary) ||
      (!ownerEdit && !lease)
    )
      return false;
    const maxSummary = await core
      .statement("SELECT coalesce(max(revision),0) FROM v2_summaries WHERE workspace_id=?", [
        g.workspaceId,
      ])
      .first<number>("coalesce(max(revision),0)");
    if (
      value.revision !== (maxSummary ?? 0) + 1 ||
      !(await referencesAuthorized(
        core,
        g,
        value.facts.flatMap((f) => f.references),
      ))
    )
      return false;
    const claimId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const summaryId = crypto.randomUUID();
    const execution = lease
      ? leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now)
      : { sql: "w.current_job_id IS NULL", values: [] };
    const refGuard = referenceCommitPredicate(value.facts.flatMap((f) => f.references));
    const statements = [
      mutation.claim(
        claimId,
        `${execution.sql} AND w.status='intake' AND w.intake_revision=? AND ${refGuard.sql}`,
        [...execution.values, value.intakeRevision, ...refGuard.values],
      ),
      ...(await snapshotStatements(
        core,
        {
          id: snapshotId,
          ownerId: g.ownerId,
          workspaceId: g.workspaceId,
          targetId: g.workspaceId,
          revision: value.revision,
          purpose: "summary",
          now: g.now,
        },
        value,
        claimId,
      )),
      core.statement(
        `INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) SELECT ?,?,?,?,?,? WHERE ${sqlClaim}`,
        [
          summaryId,
          g.workspaceId,
          value.revision,
          value.intakeRevision,
          snapshotId,
          g.now,
          claimId,
        ],
      ),
    ];
    for (const fact of value.facts) {
      const rowId = crypto.randomUUID();
      const envelope = await core.encrypt("v2_facts", rowId, g.ownerId, value.revision, fact);
      statements.push(
        core.statement(
          `INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
          [
            rowId,
            fact.id,
            g.workspaceId,
            value.revision,
            value.revision,
            snapshotId,
            envelope,
            claimId,
          ],
        ),
      );
      for (const [ordinal, ref] of fact.references.entries()) {
        const sourceId =
          ref.kind === "intake_narrative"
            ? g.workspaceId
            : ref.kind === "intake_answer"
              ? ref.questionId
              : ref.kind === "user_message"
                ? ref.messageId
                : ref.kind === "user_material"
                  ? ref.fileId
                  : ref.citationId;
        const revision =
          ref.kind === "intake_narrative" || ref.kind === "intake_answer"
            ? ref.intakeRevision
            : ref.kind === "user_message"
              ? ref.workspaceRevision
              : ref.kind === "user_material"
                ? ref.fileRevision
                : null;
        statements.push(
          core.statement(
            `INSERT INTO v2_fact_references(fact_id,ordinal,kind,source_id,source_revision) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [rowId, ordinal, ref.kind, sourceId, revision, claimId],
          ),
        );
      }
    }
    for (const party of value.parties) {
      const rowId = crypto.randomUUID();
      const envelope = await core.encrypt("v2_parties", rowId, g.ownerId, value.revision, party);
      statements.push(
        core.statement(
          `INSERT INTO v2_parties(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
          [
            rowId,
            party.id,
            g.workspaceId,
            value.revision,
            value.revision,
            snapshotId,
            envelope,
            claimId,
          ],
        ),
      );
    }
    statements.push(
      core.statement(
        `UPDATE v2_intakes SET status='reviewing_summary',summary_id=?,current_job_id=NULL,confirmed_summary_revision=NULL WHERE id=? AND ${sqlClaim}`,
        [summaryId, g.workspaceId, claimId],
      ),
      core.statement(`UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`, [
        g.workspaceId,
        claimId,
      ]),
      core.bump(g, claimId),
    );
    if (lease) statements.push(...completeLeaseStatements(core, lease, claimId, g.now));
    statements.push(...mutation.complete(claimId), core.finish(claimId));
    return core.changed(statements);
  };
  return {
    core,
    accounting,
    findWorkspace: (actor: Actor, id: string) => safe(() => findWorkspace(actor, id)),
    readIntake: (actor: Actor, id: string) => safe(() => readIntake(actor, id)),
    create(actor: Actor, id: string, request: V2CreateCaseRequest, admission: Admission) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        const body = parse(v2CreateCaseRequestSchema, request);
        parse(admissionSchema, admission);
        const replay = await accounting.findOperation(
          actor,
          "/api/v2/cases",
          admission.key,
          admission.requestHash,
        );
        if (replay) return replay;
        const claimId = crypto.randomUUID();
        const quota = { kind: "new_case" as const, units: 1 as const };
        const predicate = quotaPredicate(quota, actor.ownerId, usageDateKst(actor.now));
        const workspaceCipher = await core.encrypt("v2_workspaces", id, actor.ownerId, 1, {
          subjectContext: body.subjectContext,
          jurisdiction: body.jurisdiction,
        });
        const narrativeCipher = await core.encrypt("v2_intakes", id, actor.ownerId, 1, {
          narrative: body.narrative,
        });
        const success = await core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,id,?,1 FROM user WHERE id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE ((target_kind='account' AND target_id=?) OR (target_kind='workspace' AND target_id=?))) AND (${predicate.sql}) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=? AND route='/api/v2/cases' AND key=? AND expires_at>?)`,
            [
              claimId,
              id,
              actor.ownerId,
              actor.ownerId,
              id,
              ...predicate.values,
              actor.ownerId,
              admission.key,
              actor.now,
            ],
          ),
          core.statement(
            `INSERT INTO v2_workspaces(id,owner_id,encrypted_payload,created_at,updated_at) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [id, actor.ownerId, workspaceCipher, actor.now, actor.now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_intakes(id,status,encrypted_payload,updated_at) SELECT ?,'collecting',?,? WHERE ${sqlClaim}`,
            [id, narrativeCipher, actor.now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_case_original_usage(workspace_id) SELECT ? WHERE ${sqlClaim}`,
            [id, claimId],
          ),
          ...operationStatements(
            core,
            actor,
            {
              id: admission.operationId,
              workspaceId: id,
              kind: "new_case",
              revision: 1,
              route: "/api/v2/cases",
              key: admission.key,
              requestHash: admission.requestHash,
            },
            claimId,
          ),
          ...quotaStatements(core, actor, admission.operationId, quota, claimId),
          core.statement(
            `UPDATE v2_daily_usage SET cases_reserved=cases_reserved-1,cases_used=cases_used+1 WHERE owner_id=? AND day=? AND ${sqlClaim}`,
            [actor.ownerId, usageDateKst(actor.now), claimId],
          ),
          core.statement(
            `UPDATE v2_quota_reservations SET state='consumed' WHERE operation_id=? AND ${sqlClaim}`,
            [admission.operationId, claimId],
          ),
          core.finish(claimId),
        ]);
        return success
          ? {
              kind: "created" as const,
              workspace: await findWorkspace(actor, id),
              operationId: admission.operationId,
            }
          : ((await accounting.findOperation(
              actor,
              "/api/v2/cases",
              admission.key,
              admission.requestHash,
            )) ?? { kind: "rejected" as const });
      });
    },
    metadata(actor: Actor, id: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        const row = await core
          .statement(
            `SELECT i.*,s.revision AS summary_revision,s.snapshot_id,p.byte_length,p.part_count FROM v2_intakes i JOIN v2_workspaces w ON w.id=i.id LEFT JOIN v2_summaries s ON s.id=i.summary_id LEFT JOIN v2_private_snapshots p ON p.id=s.snapshot_id WHERE i.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
            [id, actor.ownerId],
          )
          .first<{
            revision: number;
            status: V2Intake["status"];
            summary_id: string | null;
            summary_revision: number | null;
            snapshot_id: string | null;
            byte_length: number | null;
            part_count: number | null;
            current_job_id: string | null;
            confirmed_summary_revision: number | null;
            encrypted_payload: string;
          }>();
        if (!row) return null;
        const narrative = await core.decrypt(
          "v2_intakes",
          id,
          actor.ownerId,
          1,
          row.encrypted_payload,
          z.strictObject({ narrative: v2CreateCaseRequestSchema.shape.narrative }),
        );
        const batchRows = await core
          .statement("SELECT * FROM v2_question_batches WHERE workspace_id=? ORDER BY ordinal", [
            id,
          ])
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        const answerRows = await core
          .statement(
            "SELECT a.* FROM v2_answers a JOIN v2_question_batches b ON b.id=a.batch_id WHERE b.workspace_id=? ORDER BY a.question_id",
            [id],
          )
          .all<{ id: string; batch_id: string; revision: number; encrypted_payload: string }>();
        const batches = [];
        for (const batch of batchRows.results) {
          const body = await core.decrypt(
            "v2_question_batches",
            batch.id,
            actor.ownerId,
            batch.revision,
            batch.encrypted_payload,
            v2QuestionBatchSchema,
          );
          body.answers = [];
          for (const answer of answerRows.results.filter((answer) => answer.batch_id === batch.id))
            body.answers.push(
              await core.decrypt(
                "v2_answers",
                answer.id,
                actor.ownerId,
                answer.revision,
                answer.encrypted_payload,
                v2QuestionBatchSchema.shape.answers.element,
              ),
            );
          batches.push(parse(v2QuestionBatchSchema, body));
        }
        const alive = await core
          .statement(
            `SELECT i.id FROM v2_intakes i JOIN v2_workspaces w ON w.id=i.id WHERE i.id=? AND w.owner_id=? AND i.revision=? AND i.status=? AND i.summary_id IS ? AND i.encrypted_payload=? AND ${aliveWorkspace}`,
            [id, actor.ownerId, row.revision, row.status, row.summary_id, row.encrypted_payload],
          )
          .first();
        return alive
          ? {
              schemaVersion: "2" as const,
              revision: row.revision,
              status: row.status,
              ...narrative,
              batches,
              confirmedSummaryRevision: row.confirmed_summary_revision,
              currentJobId: row.current_job_id,
              summary: row.summary_id
                ? {
                    id: row.summary_id,
                    revision: row.summary_revision,
                    snapshotId: row.snapshot_id,
                    byteLength: row.byte_length,
                    partCount: row.part_count,
                  }
                : null,
            }
          : null;
      });
    },
    async *summaryFragments(actor: Actor, id: string) {
      actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
      const row = await core
        .statement(
          `SELECT i.summary_id,s.snapshot_id,s.revision,w.revision AS workspace_revision FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id JOIN v2_workspaces w ON w.id=i.id WHERE i.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
          [id, actor.ownerId],
        )
        .first<{
          summary_id: string;
          snapshot_id: string;
          revision: number;
          workspace_revision: number;
        }>();
      if (!row) return;
      for await (const part of appendSummaryEntities(
        createV2StagingRepository(core).fragments(actor, row.snapshot_id),
        (kind) => summaryAdditions(core, actor, id, row.revision, kind),
      )) {
        if (
          !(await core
            .statement(
              `SELECT i.id FROM v2_intakes i JOIN v2_workspaces w ON w.id=i.id WHERE i.id=? AND w.owner_id=? AND i.summary_id=? AND w.revision=? AND ${aliveWorkspace}`,
              [id, actor.ownerId, row.summary_id, row.workspace_revision],
            )
            .first())
        )
          return;
        yield part;
      }
    },
    list(actor: Actor, limit = 20, before?: { createdAt: string; id: string }) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(50), limit);
        const rows = await core
          .statement(
            `SELECT w.* FROM v2_workspaces w WHERE w.owner_id=? AND ${aliveWorkspace}${before ? " AND (w.created_at<? OR (w.created_at=? AND w.id<?))" : ""} ORDER BY w.created_at DESC,w.id DESC LIMIT ?`,
            [
              actor.ownerId,
              ...(before ? [before.createdAt, before.createdAt, before.id] : []),
              limit,
            ],
          )
          .all<{
            id: string;
            revision: number;
            intake_revision: number;
            status: string;
            archived_from: string | null;
            confirmed_summary_revision: number | null;
            current_job_id: string | null;
            legacy_snapshot_id: string | null;
            encrypted_payload: string;
            created_at: string;
            updated_at: string;
          }>();
        const values = [];
        for (const row of rows.results) {
          const content = await core.decrypt(
            "v2_workspaces",
            row.id,
            actor.ownerId,
            1,
            row.encrypted_payload,
            z.strictObject({
              subjectContext: z.enum(["individual", "company"]),
              jurisdiction: z.literal("KR"),
            }),
          );
          values.push(
            parse(v2WorkspaceSchema, {
              schemaVersion: "2",
              id: row.id,
              title: "사건 작업 공간",
              ...content,
              status: row.status,
              archivedFrom: row.archived_from,
              workspaceRevision: row.revision,
              intakeRevision: row.intake_revision,
              confirmedSummaryRevision: row.confirmed_summary_revision,
              currentJobId: row.current_job_id,
              legacySnapshotId: row.legacy_snapshot_id,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }),
          );
        }
        const current = await core
          .statement(
            `SELECT w.id,w.revision,w.encrypted_payload FROM v2_workspaces w WHERE w.owner_id=? AND ${aliveWorkspace} AND w.id IN (SELECT value FROM json_each(?))`,
            [actor.ownerId, JSON.stringify(rows.results.map((row) => row.id))],
          )
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        return values.filter((value) => {
          const row = rows.results.find((row) => row.id === value.id);
          return current.results.some(
            (now) =>
              now.id === value.id &&
              now.revision === value.workspaceRevision &&
              now.encrypted_payload === row?.encrypted_payload,
          );
        });
      });
    },
    changeState(g: WorkspaceGuard, action: "archive" | "resume", receipt?: MutationReceipt) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const mutation = mutationTools(core, g, receipt);
        parse(z.enum(["archive", "resume"]), action);
        const claimId = crypto.randomUUID();
        return core.changed([
          mutation.claim(
            claimId,
            action === "archive"
              ? "w.status IN ('intake','active') AND w.current_job_id IS NULL"
              : "w.status='archived'",
          ),
          core.statement(
            action === "archive"
              ? `UPDATE v2_workspaces SET archived_from=status,status='archived' WHERE id=? AND ${sqlClaim}`
              : `UPDATE v2_workspaces SET status=archived_from,archived_from=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
          ),
          core.bump(g, claimId),
          ...mutation.complete(claimId),
          core.finish(claimId),
        ]);
      });
    },
    writeBatch(g: WorkspaceGuard, batch: V2QuestionBatch, lease: JobLease) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const value = parse(v2QuestionBatchSchema, batch);
        const current = await readIntake(g, g.workspaceId);
        if (
          !current ||
          current.revision !== value.generatedForIntakeRevision ||
          current.batches.length + 1 !== value.ordinal ||
          value.questions.length > V2_INTAKE_POLICY.questionsPerBatch ||
          current.batches.length >= V2_INTAKE_POLICY.followupRounds ||
          value.answers.length !== 0 ||
          value.questions.some((q) =>
            current.batches.some((b) => b.questions.some((old) => old.id === q.id)),
          )
        )
          return false;
        const envelope = await core.encrypt("v2_question_batches", value.id, g.ownerId, 1, value);
        const claimId = crypto.randomUUID();
        const execution = leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now);
        return core.changed([
          core.claim(g, claimId, `${execution.sql} AND w.status='intake' AND w.intake_revision=?`, [
            ...execution.values,
            value.generatedForIntakeRevision,
          ]),
          core.statement(
            `INSERT INTO v2_question_batches(id,workspace_id,ordinal,intake_revision,question_count,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              value.id,
              g.workspaceId,
              value.ordinal,
              value.generatedForIntakeRevision,
              value.questions.length,
              envelope,
              g.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_intakes SET status='collecting',current_job_id=NULL,summary_id=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
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
    answer(g: WorkspaceGuard, batchId: string, request: unknown, receipt?: MutationReceipt) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const mutation = mutationTools(core, g, receipt);
        parse(opaqueIdSchema, batchId);
        const current = await readIntake(g, g.workspaceId);
        const batch = current?.batches.find((b) => b.id === batchId);
        if (!current || !batch) return false;
        const body = parse(v2AnswersForBatchSchema(batch), request);
        if (body.expectedRevision !== current.revision) return false;
        const claimId = crypto.randomUUID();
        const statements = [
          mutation.claim(
            claimId,
            "w.status='intake' AND w.current_job_id IS NULL AND w.intake_revision=?",
            [current.revision],
          ),
        ];
        for (const answer of body.answers) {
          const old = await core
            .statement("SELECT id,revision FROM v2_answers WHERE batch_id=? AND question_id=?", [
              batchId,
              answer.questionId,
            ])
            .first<{ id: string; revision: number }>();
          const id = old?.id ?? crypto.randomUUID();
          const rev = (old?.revision ?? 0) + 1;
          const envelope = await core.encrypt("v2_answers", id, g.ownerId, rev, answer);
          statements.push(
            core.statement(
              `INSERT INTO v2_answers(id,batch_id,question_id,revision,status,encrypted_payload,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(batch_id,question_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at`,
              [id, batchId, answer.questionId, rev, answer.status, envelope, g.now, claimId],
            ),
          );
        }
        statements.push(
          core.statement(
            `UPDATE v2_intakes SET revision=revision+1,status='collecting',summary_id=NULL,confirmed_summary_revision=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
          ),
          core.statement(
            `UPDATE v2_workspaces SET intake_revision=intake_revision+1,confirmed_summary_revision=NULL WHERE id=? AND ${sqlClaim}`,
            [g.workspaceId, claimId],
          ),
          core.bump(g, claimId),
          ...mutation.complete(claimId),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    writeSummary: (g: WorkspaceGuard, value: V2Summary, lease: JobLease) =>
      safe(() => writeSummary(g, value, lease)),
    editSummary(g: WorkspaceGuard, request: V2SummaryEditRequest, receipt?: MutationReceipt) {
      return safe(async () => {
        const current = await readIntake(g, g.workspaceId);
        if (!current?.summary) return false;
        const edit = parse(
          v2SummaryEditForFactsSchema(
            current.summary.facts.map((f) => f.id),
            current.summary.revision,
          ),
          request,
        );
        const facts = current.summary.facts.map((fact) => {
          const change = edit.factEdits?.find((e) => e.factId === fact.id);
          if (!change) return fact;
          if (fact.attribution === "official_source")
            throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
          return {
            ...fact,
            text: change.text,
            userEdited: true,
            certainty: fact.certainty === "observed" ? ("uncertain" as const) : fact.certainty,
          };
        });
        return writeSummary(
          g,
          {
            ...current.summary,
            revision: current.summary.revision + 1,
            createdAt: g.now,
            overview: edit.overview ?? current.summary.overview,
            unknowns: edit.unknowns ?? current.summary.unknowns,
            facts,
          },
          null,
          true,
          receipt,
        );
      });
    },
    confirmSummary(g: WorkspaceGuard, request: unknown, receipt?: MutationReceipt) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const mutation = mutationTools(core, g, receipt);
        const value = parse(v2SummaryConfirmationRequestSchema, request);
        const claimId = crypto.randomUUID();
        return core.changed([
          mutation.claim(
            claimId,
            "w.status IN ('intake','active') AND w.current_job_id IS NULL AND w.intake_revision=? AND EXISTS(SELECT 1 FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id WHERE i.id=w.id AND i.status='reviewing_summary' AND s.revision=? AND s.intake_revision=i.revision)",
            [value.expectedRevision, value.summaryRevision],
          ),
          core.statement(
            `UPDATE v2_intakes SET status='confirmed',confirmed_summary_revision=? WHERE id=? AND ${sqlClaim}`,
            [value.summaryRevision, g.workspaceId, claimId],
          ),
          core.statement(
            `UPDATE v2_workspaces SET status='active',confirmed_summary_revision=? WHERE id=? AND ${sqlClaim}`,
            [value.summaryRevision, g.workspaceId, claimId],
          ),
          core.bump(g, claimId),
          ...mutation.complete(claimId),
          core.finish(claimId),
        ]);
      });
    },
    writeMessage(g: WorkspaceGuard, message: V2Message, lease?: JobLease) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const value = parse(v2MessageSchema(guideHosts), message);
        if (value.workspaceRevision !== g.expectedRevision) return false;
        if (
          value.role === "assistant" &&
          (!lease || !(await referencesAuthorized(core, g, value.references)))
        )
          return false;
        const execution = lease
          ? leasePredicate(lease, g.workspaceId, g.expectedRevision, g.now)
          : { sql: "w.current_job_id IS NULL", values: [] };
        if (value.role === "user")
          for (const id of value.selectedFileIds)
            if (
              !(await core
                .statement(
                  "SELECT id FROM v2_files WHERE workspace_id=? AND id=? AND state='ready'",
                  [g.workspaceId, id],
                )
                .first())
            )
              return false;
        const envelope = await core.encrypt("v2_messages", value.id, g.ownerId, 1, value);
        const claimId = crypto.randomUUID();
        const refGuard = referenceCommitPredicate(
          value.role === "assistant" ? value.references : [],
        );
        const statements = [
          core.claim(
            g,
            claimId,
            `${execution.sql} AND w.status='active' AND EXISTS(SELECT 1 FROM v2_operations WHERE id=? AND owner_id=w.owner_id AND workspace_id=w.id) AND (? IS NULL OR (w.current_job_id=? AND EXISTS(SELECT 1 FROM v2_jobs j WHERE j.id=? AND j.operation_id=? AND j.kind='chat_response'))) AND ${refGuard.sql}`,
            [
              ...execution.values,
              value.operationId,
              lease?.jobId ?? null,
              lease?.jobId ?? null,
              lease?.jobId ?? null,
              value.operationId,
              ...refGuard.values,
            ],
          ),
          core.statement(
            `INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,safety,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              value.id,
              g.workspaceId,
              value.workspaceRevision,
              value.operationId,
              value.role,
              value.role === "assistant" ? "validated" : null,
              envelope,
              g.now,
              claimId,
            ],
          ),
          core.bump(g, claimId),
        ];
        if (lease)
          statements.push(
            ...completeLeaseStatements(core, lease, claimId, g.now),
            core.statement(
              `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
              [g.workspaceId, claimId],
            ),
          );
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    userMessage(actor: Actor, workspaceId: string, operationId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(opaqueIdSchema, operationId);
        const current = await findWorkspace(actor, workspaceId);
        if (!current) return null;
        const row = await core
          .statement(
            "SELECT id,revision,encrypted_payload FROM v2_messages WHERE workspace_id=? AND operation_id=? AND role='user' LIMIT 1",
            [workspaceId, operationId],
          )
          .first<{ id: string; revision: number; encrypted_payload: string }>();
        if (!row) return null;
        const message = await core.decrypt(
          "v2_messages",
          row.id,
          actor.ownerId,
          row.revision,
          row.encrypted_payload,
          v2UserMessageSchema,
        );
        return (await findWorkspace(actor, workspaceId))?.workspaceRevision ===
          current.workspaceRevision
          ? message
          : null;
      });
    },
    messages(
      actor: Actor,
      workspaceId: string,
      limit = 20,
      before?: { createdAt: string; id: string },
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const current = await findWorkspace(actor, workspaceId);
        if (!current) return [];
        parse(z.number().int().min(1).max(50), limit);
        const rows = await core
          .statement(
            `SELECT * FROM v2_messages WHERE workspace_id=? ${before ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
            [
              workspaceId,
              ...(before ? [before.createdAt, before.createdAt, before.id] : []),
              limit,
            ],
          )
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        const values = await Promise.all(
          rows.results.map((row) =>
            core.decrypt(
              "v2_messages",
              row.id,
              actor.ownerId,
              row.revision,
              row.encrypted_payload,
              v2MessageSchema(guideHosts),
            ),
          ),
        );
        return (await findWorkspace(actor, workspaceId))?.workspaceRevision ===
          current.workspaceRevision
          ? values
          : [];
      });
    },
    writeAction(
      g: WorkspaceGuard,
      action: V2Action,
      expectedEntityRevision: number | null,
      receipt?: MutationReceipt,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const mutation = mutationTools(core, g, receipt);
        const value = parse(v2ActionSchema, action);
        if (
          value.revision !== (expectedEntityRevision ?? 0) + 1 ||
          !(await referencesAuthorized(core, g, value.references))
        )
          return false;
        const old = await core
          .statement("SELECT id,revision FROM v2_actions WHERE workspace_id=? AND entity_id=?", [
            g.workspaceId,
            value.id,
          ])
          .first<{ id: string; revision: number }>();
        if ((old?.revision ?? null) !== expectedEntityRevision) return false;
        const id = old?.id ?? crypto.randomUUID();
        const envelope = await core.encrypt("v2_actions", id, g.ownerId, value.revision, value);
        const claimId = crypto.randomUUID();
        const refGuard = referenceCommitPredicate(value.references);
        return core.changed([
          mutation.claim(
            claimId,
            `w.status='active' AND w.current_job_id IS NULL AND ${refGuard.sql} AND (SELECT count(*) FROM v2_facts WHERE workspace_id=w.id AND summary_revision=w.confirmed_summary_revision AND entity_id IN (SELECT value FROM json_each(?)))=? AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM v2_actions WHERE workspace_id=w.id AND entity_id=?)) OR EXISTS(SELECT 1 FROM v2_actions WHERE workspace_id=w.id AND entity_id=? AND revision=?))`,
            [
              ...refGuard.values,
              JSON.stringify(value.factIds),
              value.factIds.length,
              expectedEntityRevision,
              value.id,
              value.id,
              expectedEntityRevision,
            ],
          ),
          core.statement(
            `INSERT INTO v2_actions(id,entity_id,workspace_id,revision,kind,status,encrypted_payload) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(workspace_id,entity_id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,status=excluded.status,encrypted_payload=excluded.encrypted_payload`,
            [
              id,
              value.id,
              g.workspaceId,
              value.revision,
              value.kind,
              value.status,
              envelope,
              claimId,
            ],
          ),
          core.bump(g, claimId),
          ...mutation.complete(claimId),
          core.finish(claimId),
        ]);
      });
    },
    writeTimeline(
      g: WorkspaceGuard,
      entry: V2TimelineEntry,
      expectedEntityRevision: number | null,
      receipt?: MutationReceipt,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const mutation = mutationTools(core, g, receipt);
        const value = parse(v2TimelineEntrySchema, entry);
        if (
          value.revision !== (expectedEntityRevision ?? 0) + 1 ||
          !(await referencesAuthorized(core, g, value.references))
        )
          return false;
        const old = await core
          .statement("SELECT id,revision FROM v2_timeline WHERE workspace_id=? AND entity_id=?", [
            g.workspaceId,
            value.id,
          ])
          .first<{ id: string; revision: number }>();
        if ((old?.revision ?? null) !== expectedEntityRevision) return false;
        const id = old?.id ?? crypto.randomUUID();
        const envelope = await core.encrypt("v2_timeline", id, g.ownerId, value.revision, value);
        const claimId = crypto.randomUUID();
        const refGuard = referenceCommitPredicate(value.references);
        return core.changed([
          mutation.claim(
            claimId,
            `w.status='active' AND w.current_job_id IS NULL AND ${refGuard.sql} AND (SELECT count(*) FROM v2_facts WHERE workspace_id=w.id AND summary_revision=w.confirmed_summary_revision AND entity_id IN (SELECT value FROM json_each(?)))=? AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM v2_timeline WHERE workspace_id=w.id AND entity_id=?)) OR EXISTS(SELECT 1 FROM v2_timeline WHERE workspace_id=w.id AND entity_id=? AND revision=?))`,
            [
              ...refGuard.values,
              JSON.stringify(value.factIds),
              value.factIds.length,
              expectedEntityRevision,
              value.id,
              value.id,
              expectedEntityRevision,
            ],
          ),
          core.statement(
            `INSERT INTO v2_timeline(id,entity_id,workspace_id,revision,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim} ON CONFLICT(workspace_id,entity_id) DO UPDATE SET revision=excluded.revision,encrypted_payload=excluded.encrypted_payload`,
            [id, value.id, g.workspaceId, value.revision, envelope, claimId],
          ),
          core.bump(g, claimId),
          ...mutation.complete(claimId),
          core.finish(claimId),
        ]);
      });
    },
    actions(actor: Actor, workspaceId: string, afterId?: string, limit = 4) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(8), limit);
        const current = await findWorkspace(actor, workspaceId);
        if (!current) return [];
        const rows = await core
          .statement(
            `SELECT * FROM v2_actions WHERE workspace_id=? ${afterId ? "AND entity_id>?" : ""} ORDER BY entity_id LIMIT ?`,
            [workspaceId, ...(afterId ? [afterId] : []), limit],
          )
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        const values = await Promise.all(
          rows.results.map((r) =>
            core.decrypt(
              "v2_actions",
              r.id,
              actor.ownerId,
              r.revision,
              r.encrypted_payload,
              v2ActionSchema,
            ),
          ),
        );
        return (await findWorkspace(actor, workspaceId))?.workspaceRevision ===
          current.workspaceRevision
          ? values
          : [];
      });
    },
    timeline(actor: Actor, workspaceId: string, afterId?: string, limit = 4) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(1).max(8), limit);
        const current = await findWorkspace(actor, workspaceId);
        if (!current) return [];
        const rows = await core
          .statement(
            `SELECT * FROM v2_timeline WHERE workspace_id=? ${afterId ? "AND entity_id>?" : ""} ORDER BY entity_id LIMIT ?`,
            [workspaceId, ...(afterId ? [afterId] : []), limit],
          )
          .all<{ id: string; revision: number; encrypted_payload: string }>();
        const values = await Promise.all(
          rows.results.map((r) =>
            core.decrypt(
              "v2_timeline",
              r.id,
              actor.ownerId,
              r.revision,
              r.encrypted_payload,
              v2TimelineEntrySchema,
            ),
          ),
        );
        return (await findWorkspace(actor, workspaceId))?.workspaceRevision ===
          current.workspaceRevision
          ? values
          : [];
      });
    },
  };
}
