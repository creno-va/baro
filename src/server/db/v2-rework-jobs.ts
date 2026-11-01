import type { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import { type V2UserMessage, v2UserMessageSchema } from "../../contracts/v2";
import { usageDateKst } from "./repository";
import { operationStatements, quotaPredicate, quotaStatements } from "./v2-accounting";
import { sqlClaim, type V2Core, type WorkspaceGuard } from "./v2-core";
import { jobInsertStatements } from "./v2-jobs";
import { isPreparedPaidHold, type PreparedPaidHold } from "./v2-paid-statements";
import { createV2ReworkRepository, type ReworkWriteGuard } from "./v2-rework";
import { type Admission, admissionSchema } from "./v2-workspace";

export type ReworkJobAdmissionInput = {
  admission: Admission;
  jobId: string;
  kind: "legal_analysis" | "summary_reconciliation";
  summaryRevision: number;
  authority: ReworkWriteGuard;
  userMessage?: { id: string; text: string };
};
/** Prepare trusted SQL capabilities; the domain record and job share one claim. */
export async function prepareReworkJobAdmission(
  core: V2Core,
  g: WorkspaceGuard,
  input: ReworkJobAdmissionInput,
  paid: PreparedPaidHold,
) {
  admissionSchema.parse(input.admission);
  opaqueIdSchema.parse(input.jobId);
  const next = g.expectedRevision + 1;
  if (
    !isPreparedPaidHold(paid) ||
    paid.request.jobId !== input.jobId ||
    paid.request.targetKind !== "workspace" ||
    paid.request.targetId !== g.workspaceId ||
    paid.request.targetRevision !== next ||
    paid.request.plan.operationId !== input.admission.operationId ||
    paid.request.plan.operationRevision !== next ||
    paid.request.plan.requestHash !== input.admission.requestHash
  )
    return null;
  const route = `/api/v2/cases/${g.workspaceId}/rework/tasks/${input.kind}`;
  const lifecycle =
    input.kind === "legal_analysis"
      ? "w.status='active' AND w.confirmed_summary_revision=?"
      : "w.status IN ('intake','active') AND EXISTS(SELECT 1 FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id WHERE i.id=w.id AND s.revision=? AND i.status IN ('reviewing_summary','confirmed') AND i.revision=w.intake_revision AND (w.confirmed_summary_revision IS NULL OR w.confirmed_summary_revision=s.revision))";
  const quota = {
    kind: "visible_ai_response" as const,
    units: 1 as const,
    responseKind: "chat" as const,
  };
  const q = quotaPredicate(quota, g.ownerId, usageDateKst(g.now));
  let message: V2UserMessage | null = null,
    encrypted: string | null = null;
  if (input.userMessage) {
    message = v2UserMessageSchema.parse({
      schemaVersion: "2",
      id: input.userMessage.id,
      operationId: input.admission.operationId,
      workspaceRevision: next,
      createdAt: g.now,
      role: "user",
      text: input.userMessage.text,
      selectedFileIds: [],
    });
    encrypted = await core.encrypt("v2_messages", message.id, g.ownerId, 1, message);
  }
  return {
    authority: {
      sql: `${lifecycle} AND (${input.authority.sql}) AND (${q.sql}) AND (${paid.predicate.sql}) AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)`,
      values: [
        input.summaryRevision,
        ...input.authority.values,
        ...q.values,
        ...paid.predicate.values,
        route,
        input.admission.key,
        g.now,
      ],
    },
    statements: (claimId: string) => [
      ...operationStatements(
        core,
        g,
        {
          id: input.admission.operationId,
          workspaceId: g.workspaceId,
          kind: "chat",
          revision: next,
          route,
          key: input.admission.key,
          requestHash: input.admission.requestHash,
        },
        claimId,
      ),
      ...quotaStatements(core, g, input.admission.operationId, quota, claimId),
      ...jobInsertStatements(
        core,
        g,
        {
          schemaVersion: "2",
          id: input.jobId,
          operationId: input.admission.operationId,
          target: { kind: "workspace", caseId: g.workspaceId, workspaceRevision: next },
          kind: "chat_response",
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
      ...paid.statements(core, g, claimId),
      core.statement(`UPDATE v2_workspaces SET current_job_id=? WHERE id=? AND ${sqlClaim}`, [
        input.jobId,
        g.workspaceId,
        claimId,
      ]),
      ...(message
        ? [
            core.statement(
              `INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,encrypted_payload,created_at) SELECT ?,?,?,?,'user',?,? WHERE ${sqlClaim}`,
              [
                message.id,
                g.workspaceId,
                next,
                input.admission.operationId,
                encrypted,
                g.now,
                claimId,
              ],
            ),
          ]
        : []),
    ],
  };
}

/** Internal task descriptors preserve the installed chat_response job DTO. */
export function createV2ReworkJobsRepository(core: V2Core, options: { clock?: () => string } = {}) {
  const records = createV2ReworkRepository(core, options);
  return {
    prepare: (g: WorkspaceGuard, input: ReworkJobAdmissionInput, paid: PreparedPaidHold) =>
      prepareReworkJobAdmission(core, g, input, paid),
    async admit<T>(
      g: WorkspaceGuard,
      input: ReworkJobAdmissionInput & { task: T; schema: z.ZodType<T> },
      paid: PreparedPaidHold,
    ) {
      const plan = await prepareReworkJobAdmission(core, g, input, paid);
      if (!plan) return null;
      return records.write(g, {
        kind: "task",
        entityId: input.jobId,
        expectedVersion: 0,
        value: input.task,
        schema: input.schema,
        bumpWorkspace: true,
        ...plan,
      });
    },
  };
}
