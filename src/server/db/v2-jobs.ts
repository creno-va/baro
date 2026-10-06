import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type V2Job,
  type V2MessageRequest,
  type V2OperationQuota,
  type V2UserMessage,
  v2FileProbeSchema,
  v2JobSchema,
  v2MessageRequestSchema,
  v2OperationQuotaSchema,
  v2UserMessageSchema,
} from "../../contracts/v2";
import { usageDateKst } from "./repository";
import {
  operationStatements,
  quotaPredicate,
  quotaRetryPredicate,
  quotaRetryStatements,
  quotaStatements,
  quotaTransitionStatements,
} from "./v2-accounting";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";
import {
  isPreparedPaidHold,
  type PreparedPaidHold,
  paidAcquirePredicate,
} from "./v2-paid-statements";
import { type Admission, admissionSchema, type JobLease, leaseSchema } from "./v2-workspace";

export const jobAlive = `NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (t.target_kind='account' AND t.target_id=o.owner_id) OR (t.target_kind=CASE j.target_kind WHEN 'profile_asset' THEN 'asset' ELSE j.target_kind END AND t.target_id=j.target_id)) AND
  ((j.target_kind='workspace' AND EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=j.target_id AND w.owner_id=o.owner_id AND w.current_job_id=j.id AND w.revision=j.target_revision AND ${aliveWorkspace})) OR
   (j.target_kind='file' AND EXISTS(SELECT 1 FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=j.target_id AND f.revision=j.target_revision AND f.current_job_id=j.id AND w.owner_id=o.owner_id AND ${aliveWorkspace})) OR
   (j.target_kind='report' AND EXISTS(SELECT 1 FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE r.id=j.target_id AND r.workspace_revision=j.target_revision AND r.current_job_id=j.id AND w.owner_id=o.owner_id AND ${aliveWorkspace})) OR
   (j.target_kind='profile_asset' AND EXISTS(SELECT 1 FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.id=j.target_id AND a.revision=j.target_revision AND a.current_job_id=j.id AND p.owner_id=o.owner_id AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='profile' AND target_id=p.id))))`;
type JobRow = {
  id: string;
  operation_id: string;
  workspace_id: string | null;
  profile_id: string | null;
  target_kind: "workspace" | "file" | "report" | "profile_asset";
  target_id: string;
  target_revision: number;
  kind: V2Job["kind"];
  status: V2Job["status"];
  phase: V2Job["phase"];
  progress: number;
  attempts: number;
  failure_code: V2Job["failure"];
  retryable: number;
  updated_at: string;
  fencing: number;
  lease_token: string | null;
  lease_until: string | null;
};
function jobDto(row: JobRow): V2Job {
  const target =
    row.target_kind === "workspace"
      ? { kind: "workspace", caseId: row.target_id, workspaceRevision: row.target_revision }
      : row.target_kind === "file"
        ? {
            kind: "file",
            caseId: row.workspace_id,
            fileId: row.target_id,
            fileRevision: row.target_revision,
          }
        : row.target_kind === "report"
          ? {
              kind: "report",
              caseId: row.workspace_id,
              reportId: row.target_id,
              snapshotRevision: row.target_revision,
            }
          : {
              kind: "profile_asset",
              profileId: row.profile_id,
              assetId: row.target_id,
              assetRevision: row.target_revision,
            };
  return parse(v2JobSchema, {
    schemaVersion: "2",
    id: row.id,
    operationId: row.operation_id,
    target,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    progressPercent: row.progress,
    attempts: row.attempts,
    failure: row.failure_code,
    retryable: row.retryable === 1,
    updatedAt: row.updated_at,
  });
}
export function jobInsertStatements(
  core: V2Core,
  actor: Actor,
  job: V2Job,
  claimId: string,
): D1PreparedStatement[] {
  const value = parse(v2JobSchema, job);
  if (value.status !== "queued" || value.attempts !== 0) throw new Error("INVALID_JOB_INSERT");
  const targetId =
    value.target.kind === "workspace"
      ? value.target.caseId
      : value.target.kind === "file"
        ? value.target.fileId
        : value.target.kind === "report"
          ? value.target.reportId
          : value.target.assetId;
  const targetRevision =
    value.target.kind === "workspace"
      ? value.target.workspaceRevision
      : value.target.kind === "file"
        ? value.target.fileRevision
        : value.target.kind === "report"
          ? value.target.snapshotRevision
          : value.target.assetRevision;
  return [
    core.statement(
      `INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,profile_id,target_kind,target_id,target_revision,kind,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
      [
        value.id,
        value.operationId,
        parse(opaqueIdSchema, `${value.id}-1`),
        value.target.kind === "profile_asset" ? null : value.target.caseId,
        value.target.kind === "profile_asset" ? value.target.profileId : null,
        value.target.kind,
        targetId,
        targetRevision,
        value.kind,
        actor.now,
        actor.now,
        claimId,
      ],
    ),
    core.statement(
      `INSERT INTO v2_outbox(id,operation_id,job_id,kind,target_id,revision,next_attempt_at,created_at) SELECT ?,?,?,'job_dispatch',?,?,?,? WHERE ${sqlClaim}`,
      [
        crypto.randomUUID(),
        value.operationId,
        value.id,
        `${value.id}-1`,
        1,
        actor.now,
        actor.now,
        claimId,
      ],
    ),
  ];
}
export function createV2JobsRepository(core: V2Core) {
  return {
    admitAsset(
      actor: Actor,
      input: { assetId: string; assetRevision: number; jobId: string },
      paid?: PreparedPaidHold,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        for (const id of [input.assetId, input.jobId]) parse(opaqueIdSchema, id);
        parse(z.number().int().positive(), input.assetRevision);
        if (
          paid &&
          (!isPreparedPaidHold(paid) ||
            paid.request.jobId !== input.jobId ||
            paid.request.targetKind !== "profile_asset" ||
            paid.request.targetId !== input.assetId ||
            paid.request.targetRevision !== input.assetRevision)
        )
          return false;
        const claimId = crypto.randomUUID();
        const row = await core
          .statement(
            "SELECT a.profile_id,r.operation_id FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_storage_reservations r ON r.entity_id=a.id JOIN v2_blobs b ON b.reservation_id=r.id JOIN v2_operations o ON o.id=r.operation_id WHERE a.id=? AND a.owner_id=? AND a.revision=? AND a.state IN ('reserved','uploaded') AND a.current_job_id IS NULL AND a.purpose IN ('portfolio','profile_photo') AND r.kind='lawyer_asset' AND b.state='stored' AND b.visibility='private' AND b.kind IN ('portfolio_original','profile_photo_original') AND o.owner_id=a.owner_id AND o.kind='profile_asset' AND o.state='admitted' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id)) LIMIT 1",
            [input.assetId, actor.ownerId, input.assetRevision],
          )
          .first<{ profile_id: string; operation_id: string }>();
        if (!row) return false;
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.id=? AND a.owner_id=? AND a.revision=? AND a.state IN ('reserved','uploaded') AND a.current_job_id IS NULL AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id)) AND EXISTS(SELECT 1 FROM v2_storage_reservations r JOIN v2_blobs b ON b.reservation_id=r.id JOIN v2_operations o ON o.id=r.operation_id WHERE r.entity_id=a.id AND r.operation_id=? AND b.state='stored' AND b.visibility='private' AND ((a.purpose='portfolio' AND b.kind='portfolio_original') OR (a.purpose='profile_photo' AND b.kind='profile_photo_original')) AND o.state='admitted') AND (${paid?.predicate.sql ?? "NOT EXISTS(SELECT 1 FROM v2_runtime_controls)"})`,
            [
              claimId,
              input.assetId,
              actor.ownerId,
              input.assetRevision,
              row.operation_id,
              ...(paid?.predicate.values ?? []),
            ],
          ),
          ...jobInsertStatements(
            core,
            actor,
            {
              schemaVersion: "2",
              id: input.jobId,
              operationId: row.operation_id,
              target: {
                kind: "profile_asset",
                profileId: row.profile_id,
                assetId: input.assetId,
                assetRevision: input.assetRevision,
              },
              kind: "portfolio_sanitize",
              status: "queued",
              phase: "admission",
              progressPercent: 0,
              attempts: 0,
              failure: null,
              retryable: false,
              updatedAt: actor.now,
            },
            claimId,
          ),
          core.statement(
            `UPDATE v2_assets SET state='sanitizing',current_job_id=? WHERE id=? AND ${sqlClaim}`,
            [input.jobId, input.assetId, claimId],
          ),
          ...(paid ? paid.statements(core, actor, claimId) : []),
          core.finish(claimId),
        ]);
      });
    },
    retryAsset(actor: Actor, jobId: string, paid?: PreparedPaidHold) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, jobId);
        const row = await core
          .statement(
            "SELECT j.* FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.target_kind='profile_asset' AND j.status='failed' AND j.retryable=1 AND j.attempts<10",
            [jobId, actor.ownerId],
          )
          .first<JobRow>();
        if (!row) return false;
        const bound = await core
          .statement("SELECT attempt_id FROM v2_paid_holds WHERE job_id=? LIMIT 1", [jobId])
          .first();
        if (bound && !paid) return false;
        if (
          paid &&
          (!isPreparedPaidHold(paid) ||
            paid.request.jobId !== jobId ||
            paid.request.plan.operationId !== row.operation_id ||
            paid.request.targetKind !== row.target_kind ||
            paid.request.targetId !== row.target_id ||
            paid.request.targetRevision !== row.target_revision)
        )
          return false;
        const runtime = parse(opaqueIdSchema, `${jobId}-${row.attempts + 1}`);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_assets a ON a.id=j.target_id JOIN v2_profiles p ON p.id=a.profile_id WHERE j.id=? AND o.owner_id=? AND j.target_kind='profile_asset' AND j.status='failed' AND j.retryable=1 AND j.attempts<10 AND a.owner_id=o.owner_id AND a.revision=j.target_revision AND a.current_job_id IS NULL AND a.state='failed' AND ${quotaRetryPredicate} AND (${paid?.predicate.sql ?? "NOT EXISTS(SELECT 1 FROM v2_runtime_controls)"}) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=o.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`,
            [claimId, jobId, actor.ownerId, ...(paid?.predicate.values ?? [])],
          ),
          ...quotaRetryStatements(core, jobId, claimId),
          core.statement(
            `UPDATE v2_jobs SET status='queued',phase='admission',progress=0,failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1,runtime_instance_id=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [runtime, actor.now, jobId, claimId],
          ),
          core.statement(`UPDATE v2_operations SET state='admitted' WHERE id=? AND ${sqlClaim}`, [
            row.operation_id,
            claimId,
          ]),
          core.statement(
            `UPDATE v2_assets SET state='sanitizing',failure_code=NULL,current_job_id=? WHERE id=? AND ${sqlClaim}`,
            [jobId, row.target_id, claimId],
          ),
          core.statement(
            `INSERT INTO v2_outbox(id,operation_id,job_id,kind,target_id,revision,next_attempt_at,created_at) SELECT ?,?,?,'job_dispatch',?,?,?,? WHERE ${sqlClaim}`,
            [
              crypto.randomUUID(),
              row.operation_id,
              jobId,
              runtime,
              row.attempts + 1,
              actor.now,
              actor.now,
              claimId,
            ],
          ),
          ...(paid ? paid.statements(core, actor, claimId) : []),
          core.finish(claimId),
        ]);
      });
    },
    admitFile(
      g: WorkspaceGuard,
      input: {
        fileId: string;
        fileRevision: number;
        jobId: string;
        admission: Admission;
        quotas: readonly V2OperationQuota[];
      },
      paid?: PreparedPaidHold,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(admissionSchema, input.admission);
        for (const id of [input.fileId, input.jobId]) parse(opaqueIdSchema, id);
        parse(z.number().int().positive(), input.fileRevision);
        if (
          paid &&
          (!isPreparedPaidHold(paid) ||
            paid.request.plan.operationId !== input.admission.operationId ||
            paid.request.plan.operationRevision !== g.expectedRevision + 1 ||
            paid.request.plan.requestHash !== input.admission.requestHash ||
            paid.request.jobId !== input.jobId ||
            paid.request.targetKind !== "file" ||
            paid.request.targetId !== input.fileId ||
            paid.request.targetRevision !== input.fileRevision)
        )
          return false;
        const quotas = parse(z.array(v2OperationQuotaSchema).max(2), input.quotas);
        if (
          quotas.some(
            (q) =>
              q.kind === "new_case" ||
              (q.kind === "visible_ai_response" && q.responseKind !== "file_interpretation"),
          ) ||
          new Set(quotas.map((q) => q.kind)).size !== quotas.length
        )
          return false;
        const row = await core
          .statement(
            "SELECT encrypted_payload FROM v2_files WHERE id=? AND workspace_id=? AND revision=? AND state='uploaded' AND current_job_id IS NULL",
            [input.fileId, g.workspaceId, input.fileRevision],
          )
          .first<{ encrypted_payload: string }>();
        if (!row) return false;
        const metadata = await core.decrypt(
          "v2_files",
          input.fileId,
          g.ownerId,
          input.fileRevision,
          row.encrypted_payload,
          z.strictObject({
            name: z.string(),
            declaredMediaType: z.string(),
            probe: v2FileProbeSchema.nullable(),
          }),
        );
        if (!metadata.probe) return false;
        const media = quotas.find((q) => q.kind === "media_processing");
        if (
          "durationSeconds" in metadata.probe
            ? media?.kind !== "media_processing" ||
              media.originalDurationSeconds !== metadata.probe.durationSeconds
            : media !== undefined
        )
          return false;
        const predicates = quotas.map((q) => quotaPredicate(q, g.ownerId, usageDateKst(g.now)));
        const claimId = crypto.randomUUID();
        const route = `/api/v2/cases/${g.workspaceId}/files/${input.fileId}/processing`;
        return core.changed([
          core.claim(
            g,
            claimId,
            `${predicates.map((p) => `(${p.sql})`).join(" AND ") || "1"} AND (${paid?.predicate.sql ?? "NOT EXISTS(SELECT 1 FROM v2_runtime_controls)"}) AND w.status!='archived' AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=? AND f.workspace_id=w.id AND f.revision=? AND f.encrypted_payload=? AND f.state='uploaded' AND f.current_job_id IS NULL) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=?) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
            [
              ...predicates.flatMap((p) => p.values),
              ...(paid?.predicate.values ?? []),
              input.fileId,
              input.fileRevision,
              row.encrypted_payload,
              input.fileId,
              route,
              input.admission.key,
              g.now,
            ],
          ),
          ...operationStatements(
            core,
            g,
            {
              id: input.admission.operationId,
              workspaceId: g.workspaceId,
              kind: quotas.some((q) => q.kind === "visible_ai_response")
                ? "file_interpretation"
                : "file_extract",
              revision: g.expectedRevision + 1,
              route,
              key: input.admission.key,
              requestHash: input.admission.requestHash,
            },
            claimId,
          ),
          ...quotas.flatMap((q) =>
            quotaStatements(core, g, input.admission.operationId, q, claimId),
          ),
          ...jobInsertStatements(
            core,
            g,
            {
              schemaVersion: "2",
              id: input.jobId,
              operationId: input.admission.operationId,
              target: {
                kind: "file",
                caseId: g.workspaceId,
                fileId: input.fileId,
                fileRevision: input.fileRevision,
              },
              kind: "file_processing",
              status: "queued",
              phase: "admission",
              progressPercent: 0,
              attempts: 0,
              failure: null,
              retryable: false,
              updatedAt: g.now,
            },
            claimId,
          ),
          core.statement(
            `UPDATE v2_files SET state='queued',current_job_id=?,operation_id=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [input.jobId, input.admission.operationId, g.now, input.fileId, claimId],
          ),
          core.bump(g, claimId),
          ...(paid ? paid.statements(core, g, claimId) : []),
          core.finish(claimId),
        ]);
      });
    },
    admitWorkspace(
      g: WorkspaceGuard,
      admission: Admission,
      jobId: string,
      kind: "intake_questions" | "intake_summary" | "chat_response",
      chat?: { id: string; request: V2MessageRequest },
      paid?: PreparedPaidHold,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(admissionSchema, admission);
        parse(opaqueIdSchema, jobId);
        parse(z.enum(["intake_questions", "intake_summary", "chat_response"]), kind);
        const nextRevision = g.expectedRevision + 1;
        if (
          paid &&
          (!isPreparedPaidHold(paid) ||
            paid.request.plan.operationId !== admission.operationId ||
            paid.request.plan.operationRevision !== nextRevision ||
            paid.request.plan.requestHash !== admission.requestHash ||
            paid.request.jobId !== jobId ||
            paid.request.targetKind !== "workspace" ||
            paid.request.targetId !== g.workspaceId ||
            paid.request.targetRevision !== nextRevision)
        )
          return false;
        const responseKind: "question_batch" | "summary" | "chat" =
          kind === "intake_questions"
            ? "question_batch"
            : kind === "intake_summary"
              ? "summary"
              : "chat";
        const quota = { kind: "visible_ai_response" as const, units: 1 as const, responseKind };
        const predicate = quotaPredicate(quota, g.ownerId, usageDateKst(g.now));
        const claimId = crypto.randomUUID();
        let message: V2UserMessage | undefined;
        let envelope: string | undefined;
        if (kind === "chat_response") {
          if (!chat) return false;
          const request = parse(v2MessageRequestSchema, chat.request);
          if (request.expectedRevision !== g.expectedRevision) return false;
          for (const id of request.selectedFileIds)
            if (
              !(await core
                .statement(
                  "SELECT id FROM v2_files WHERE id=? AND workspace_id=? AND state='ready'",
                  [id, g.workspaceId],
                )
                .first())
            )
              return false;
          message = parse(v2UserMessageSchema, {
            schemaVersion: "2",
            id: chat.id,
            operationId: admission.operationId,
            workspaceRevision: nextRevision,
            createdAt: g.now,
            role: "user",
            text: request.text,
            selectedFileIds: request.selectedFileIds,
          });
          envelope = await core.encrypt("v2_messages", message.id, g.ownerId, 1, message);
        } else if (chat) return false;
        const route = `/api/v2/cases/${g.workspaceId}/${responseKind}`;
        const answered =
          "NOT EXISTS(SELECT 1 FROM v2_question_batches b WHERE b.workspace_id=w.id AND (SELECT count(*) FROM v2_answers a WHERE a.batch_id=b.id)!=b.question_count)";
        const lifecycle =
          kind === "chat_response"
            ? "w.status='active'"
            : kind === "intake_questions"
              ? `w.status='intake' AND (SELECT count(*) FROM v2_question_batches WHERE workspace_id=w.id)<3 AND ${answered}`
              : `w.status='intake' AND EXISTS(SELECT 1 FROM v2_question_batches WHERE workspace_id=w.id) AND ${answered}`;
        const statements = [
          core.claim(
            g,
            claimId,
            `${predicate.sql} AND (${paid?.predicate.sql ?? "NOT EXISTS(SELECT 1 FROM v2_runtime_controls)"}) AND ${lifecycle} AND w.current_job_id IS NULL AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
            [...predicate.values, ...(paid?.predicate.values ?? []), route, admission.key, g.now],
          ),
          ...operationStatements(
            core,
            g,
            {
              id: admission.operationId,
              workspaceId: g.workspaceId,
              kind: responseKind,
              revision: nextRevision,
              route,
              key: admission.key,
              requestHash: admission.requestHash,
            },
            claimId,
          ),
          ...quotaStatements(core, g, admission.operationId, quota, claimId),
          ...jobInsertStatements(
            core,
            g,
            {
              schemaVersion: "2",
              id: jobId,
              operationId: admission.operationId,
              target: { kind: "workspace", caseId: g.workspaceId, workspaceRevision: nextRevision },
              kind,
              status: "queued",
              phase: "admission",
              progressPercent: 0,
              attempts: 0,
              failure: null,
              retryable: false,
              updatedAt: g.now,
            },
            claimId,
          ),
          core.statement(`UPDATE v2_workspaces SET current_job_id=? WHERE id=? AND ${sqlClaim}`, [
            jobId,
            g.workspaceId,
            claimId,
          ]),
          core.bump(g, claimId),
        ];
        if (message)
          statements.push(
            core.statement(
              `INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,encrypted_payload,created_at) SELECT ?,?,?,?,'user',?,? WHERE ${sqlClaim}`,
              [
                message.id,
                g.workspaceId,
                nextRevision,
                admission.operationId,
                envelope,
                g.now,
                claimId,
              ],
            ),
          );
        else
          statements.push(
            core.statement(
              `UPDATE v2_intakes SET status=?,summary_id=NULL,confirmed_summary_revision=NULL,current_job_id=? WHERE id=? AND ${sqlClaim}`,
              ["generating_questions", jobId, g.workspaceId, claimId],
            ),
          );
        if (paid) statements.push(...paid.statements(core, g, claimId));
        statements.push(core.finish(claimId));
        return core.changed(statements);
      });
    },
    find(actor: Actor, jobId: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, jobId);
        const row = await core
          .statement(
            "SELECT j.* FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=o.owner_id)",
            [jobId, actor.ownerId],
          )
          .first<JobRow>();
        return row ? jobDto(row) : null;
      });
    },
    acquire(
      actor: Actor,
      jobId: string,
      token: string,
      leaseUntil: string,
      paidAttemptId: string | null = null,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, jobId);
        parse(opaqueIdSchema, token);
        parse(timestampSchema, leaseUntil);
        leaseUntil = new Date(leaseUntil).toISOString();
        if (
          Date.parse(leaseUntil) <= Date.parse(actor.now) ||
          Date.parse(leaseUntil) - Date.parse(actor.now) > 300000
        )
          return null;
        if (paidAttemptId) parse(opaqueIdSchema, paidAttemptId);
        const paid = paidAcquirePredicate(paidAttemptId, actor.now);
        const claimId = crypto.randomUUID();
        const acquired = await core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.attempts<10 AND (j.status='queued' OR (j.status IN ('running','validating') AND j.lease_until<=?)) AND (${paid.sql}) AND ${jobAlive}`,
            [claimId, jobId, actor.ownerId, actor.now, ...paid.values],
          ),
          core.statement(
            `UPDATE v2_jobs SET status='running',lease_token=?,lease_until=?,fencing=fencing+1,attempts=attempts+1,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [token, leaseUntil, actor.now, jobId, claimId],
          ),
          ...quotaTransitionStatements(core, jobId, claimId, "consumed", "media", true),
          core.finish(claimId),
        ]);
        const row = acquired
          ? await core
              .statement(
                "SELECT * FROM v2_jobs WHERE id=? AND lease_token=? AND status='running'",
                [jobId, token],
              )
              .first<JobRow>()
          : null;
        return row
          ? { job: jobDto(row), lease: { jobId: row.id, token, fencing: row.fencing } }
          : null;
      });
    },
    renew(actor: Actor, lease: JobLease, leaseUntil: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(leaseSchema, lease);
        leaseUntil = new Date(parse(timestampSchema, leaseUntil)).toISOString();
        if (
          Date.parse(leaseUntil) <= Date.parse(actor.now) ||
          Date.parse(leaseUntil) - Date.parse(actor.now) > 300000
        )
          return false;
        return (
          (
            await core
              .statement(
                `UPDATE v2_jobs SET lease_until=?,updated_at=? WHERE id IN (SELECT j.id FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND o.state IN ('admitted','ambiguous') AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.lease_until<=? AND j.status IN ('running','validating') AND ${jobAlive} AND (j.target_kind!='file' OR EXISTS(SELECT 1 FROM v2_consents c WHERE c.file_id=j.target_id AND c.owner_id=o.owner_id AND c.kind='auto_processing')))`,
                [
                  leaseUntil,
                  actor.now,
                  lease.jobId,
                  actor.ownerId,
                  lease.token,
                  lease.fencing,
                  actor.now,
                  leaseUntil,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    checkpoint(
      actor: Actor,
      lease: JobLease,
      input: {
        id: string;
        revision: number;
        phase: V2Job["phase"];
        progress: number;
        opaqueIds: readonly string[];
      },
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(leaseSchema, lease);
        parse(opaqueIdSchema, input.id);
        parse(z.number().int().positive(), input.revision);
        parse(v2JobSchema.shape.phase, input.phase);
        parse(z.number().int().min(0).max(99), input.progress);
        parse(z.array(opaqueIdSchema).max(100), input.opaqueIds);
        const claimId = crypto.randomUUID();
        const envelope = await core.encrypt(
          "v2_job_checkpoints",
          input.id,
          actor.ownerId,
          input.revision,
          { opaqueIds: input.opaqueIds },
        );
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND ${jobAlive}`,
            [claimId, lease.jobId, actor.ownerId, lease.token, lease.fencing, actor.now],
          ),
          core.statement(
            `INSERT INTO v2_job_checkpoints(id,job_id,revision,fencing,phase,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,? WHERE ${sqlClaim}`,
            [
              input.id,
              lease.jobId,
              input.revision,
              lease.fencing,
              input.phase,
              envelope,
              actor.now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_jobs SET phase=?,progress=?,status=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [
              input.phase,
              input.progress,
              input.phase === "validating" ? "validating" : "running",
              actor.now,
              lease.jobId,
              claimId,
            ],
          ),
          core.finish(claimId),
        ]);
      });
    },
    fail(
      actor: Actor,
      lease: JobLease,
      failure: NonNullable<V2Job["failure"]>,
      retryable: boolean,
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(leaseSchema, lease);
        parse(v2JobSchema.shape.failure, failure);
        parse(z.boolean(), retryable);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND ${jobAlive}`,
            [claimId, lease.jobId, actor.ownerId, lease.token, lease.fencing, actor.now],
          ),
          core.statement(
            `UPDATE v2_jobs SET status='failed',failure_code=?,retryable=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [failure, retryable ? 1 : 0, actor.now, lease.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_operations SET state='failed' WHERE id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
            [lease.jobId, claimId],
          ),
          ...quotaTransitionStatements(core, lease.jobId, claimId, "released", undefined, true),
          core.statement(
            `UPDATE v2_workspaces SET current_job_id=CASE WHEN current_job_id=? THEN NULL ELSE current_job_id END,revision=revision+1,updated_at=? WHERE id=(SELECT workspace_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
            [lease.jobId, actor.now, lease.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_intakes SET status='collecting',summary_id=NULL,current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
            [lease.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_files SET state='failed',failure_code=?,current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
            [failure, lease.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_reports SET state='failed',failure_code=?,current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
            [failure, lease.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_assets SET state='failed',failure_code=?,current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
            [failure, lease.jobId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    retry(g: WorkspaceGuard, jobId: string, paid?: PreparedPaidHold) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, jobId);
        const row = await core
          .statement(
            "SELECT j.* FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND j.workspace_id=? AND j.status='failed' AND j.retryable=1",
            [jobId, g.ownerId, g.workspaceId],
          )
          .first<JobRow>();
        if (!row || row.attempts >= 10) return false;
        const bound = await core
          .statement("SELECT attempt_id FROM v2_paid_holds WHERE job_id=? LIMIT 1", [jobId])
          .first();
        if (bound && !paid) return false;
        if (
          paid &&
          (!isPreparedPaidHold(paid) ||
            paid.request.jobId !== jobId ||
            paid.request.plan.operationId !== row.operation_id ||
            paid.request.targetKind !== row.target_kind ||
            paid.request.targetId !== row.target_id ||
            paid.request.targetRevision !==
              (row.target_kind === "workspace" ? g.expectedRevision + 1 : row.target_revision))
        )
          return false;
        const target =
          row.target_kind === "workspace"
            ? "w.current_job_id IS NULL AND w.status IN ('intake','active')"
            : row.target_kind === "file"
              ? "EXISTS(SELECT 1 FROM v2_files f WHERE f.id=j.target_id AND f.workspace_id=w.id AND f.revision=j.target_revision AND f.state='failed' AND f.current_job_id IS NULL)"
              : row.target_kind === "report"
                ? "EXISTS(SELECT 1 FROM v2_reports r WHERE r.id=j.target_id AND r.workspace_id=w.id AND r.workspace_revision=j.target_revision AND r.state='failed' AND r.current_job_id IS NULL)"
                : "0";
        const claimId = crypto.randomUUID();
        const runtime = parse(opaqueIdSchema, `${jobId}-${row.attempts + 1}`);
        return core.changed([
          core.claim(
            g,
            claimId,
            `EXISTS(SELECT 1 FROM v2_jobs j WHERE j.id=? AND j.status='failed' AND j.retryable=1 AND ${quotaRetryPredicate} AND (${paid?.predicate.sql ?? "NOT EXISTS(SELECT 1 FROM v2_runtime_controls)"}) AND ${target} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind=j.target_kind AND target_id=j.target_id))`,
            [jobId, ...(paid?.predicate.values ?? [])],
          ),
          ...quotaRetryStatements(core, jobId, claimId),
          core.statement(
            `UPDATE v2_jobs SET status='queued',phase='admission',progress=0,failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1,runtime_instance_id=?,target_revision=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [
              runtime,
              row.target_kind === "workspace" ? g.expectedRevision + 1 : row.target_revision,
              g.now,
              jobId,
              claimId,
            ],
          ),
          core.statement(`UPDATE v2_operations SET state='admitted' WHERE id=? AND ${sqlClaim}`, [
            row.operation_id,
            claimId,
          ]),
          core.statement(
            `UPDATE v2_workspaces SET current_job_id=? WHERE id=? AND ${sqlClaim} AND ?='workspace'`,
            [jobId, g.workspaceId, claimId, row.target_kind],
          ),
          core.statement(
            `UPDATE v2_intakes SET current_job_id=?,status='generating_questions' WHERE id=? AND ${sqlClaim} AND ? IN ('intake_questions','intake_summary')`,
            [jobId, g.workspaceId, claimId, row.kind],
          ),
          core.statement(
            `UPDATE v2_files SET current_job_id=?,state='queued',failure_code=NULL WHERE id=? AND ${sqlClaim} AND ?='file'`,
            [jobId, row.target_id, claimId, row.target_kind],
          ),
          core.statement(
            `UPDATE v2_reports SET current_job_id=?,state='queued',failure_code=NULL WHERE id=? AND ${sqlClaim} AND ?='report'`,
            [jobId, row.target_id, claimId, row.target_kind],
          ),
          core.statement(
            `INSERT INTO v2_outbox(id,operation_id,job_id,kind,target_id,revision,next_attempt_at,created_at) SELECT ?,?,?,'job_dispatch',?,?,?,? WHERE ${sqlClaim}`,
            [
              crypto.randomUUID(),
              row.operation_id,
              jobId,
              runtime,
              row.attempts + 1,
              g.now,
              g.now,
              claimId,
            ],
          ),
          core.bump(g, claimId),
          ...(paid ? paid.statements(core, g, claimId) : []),
          core.finish(claimId),
        ]);
      });
    },
    pendingOutbox(now: string, limit = 25) {
      return safe(async () => {
        parse(timestampSchema, now);
        parse(z.number().int().min(1).max(100), limit);
        return (
          await core
            .statement(
              "SELECT id,kind,target_id,revision,job_id,operation_id,attempts FROM v2_outbox WHERE state IN ('pending','failed') AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?",
              [new Date(now).toISOString(), limit],
            )
            .all<{
              id: string;
              kind: string;
              target_id: string;
              revision: number;
              job_id: string | null;
              operation_id: string;
              attempts: number;
            }>()
        ).results;
      });
    },
    acknowledgeOutbox(
      id: string,
      expectedAttempts: number,
      outcome: "dispatched" | "failed",
      nextAttemptAt: string,
    ) {
      return safe(async () => {
        parse(opaqueIdSchema, id);
        parse(z.number().int().min(0), expectedAttempts);
        parse(z.enum(["dispatched", "failed"]), outcome);
        parse(timestampSchema, nextAttemptAt);
        return (
          (
            await core
              .statement(
                "UPDATE v2_outbox SET state=?,attempts=attempts+1,next_attempt_at=? WHERE id=? AND attempts=? AND state IN ('pending','failed')",
                [outcome, new Date(nextAttemptAt).toISOString(), id, expectedAttempts],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
  };
}
