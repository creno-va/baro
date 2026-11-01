import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import {
  type V2ConversationState,
  type V2LegalAnalysisSnapshot,
  v2ConversationIntentSchema,
  v2ConversationStateSchema,
  v2ReworkVersionSchema,
} from "../../../contracts/v2";
import { readCustomerConsentSnapshot } from "../../auth/account-type";
import { type Actor, aliveWorkspace, type V2Core } from "../../db/v2-core";
import { createV2ReworkRepository } from "../../db/v2-rework";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import {
  analysisBasis,
  canonicalAnalysisJson,
  isAnalysisCurrent,
} from "../legal-retrieval/analysis/context";
import { BOUND_SOURCE_BATCH_SIZE, readBoundSourceBatch } from "../legal-retrieval/v2/bound-sources";
import { capturePublicationSourceAuthority } from "../legal-retrieval/v2/publication-authority";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import type { WorkspaceContext } from "../workspace/pipeline";
import { type AnalysisScope, loadAnalysisInput, readAnalysisScope } from "./analysis-input";
import { createReworkCaseService, ReworkError } from "./case-context";
import {
  analysisTaskSchema,
  automaticPreparationRecordSchema,
  preparedAnalysisRecordSchema,
  reportContinuationSchema,
} from "./records";

/** Stable admission/execution projection for the incoming dialog turn. The new
 * message requires refreshing prior analysis; it never marks that analysis fresh. */
export async function readConversationModelContext(
  core: V2Core,
  a: Actor,
  id: string,
): Promise<NonNullable<WorkspaceContext["conversation"]>> {
  const context = await createReworkCaseService(core, { clock: () => a.now }).get(a.ownerId, id);
  const raw = await createV2ReworkRepository(core).read(
    a,
    id,
    "analysis",
    id,
    preparedAnalysisRecordSchema,
  );
  const report = await core
    .statement(
      "SELECT r.id FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE w.id=? AND w.owner_id=? AND r.id NOT LIKE 'export-%' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id) ORDER BY r.revision DESC LIMIT 1",
      [id, a.ownerId],
    )
    .first();
  const pending = (
    await core
      .statement(
        "SELECT id FROM v2_files WHERE workspace_id=? AND state NOT IN ('ready','failed','deleting') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=v2_files.id) ORDER BY id LIMIT 101",
        [id],
      )
      .all<{ id: string }>()
  ).results;
  if (pending.length > 100) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
  return {
    caseContext: context.context,
    preparation: raw
      ? {
          status: raw.value.failure ? "failed" : "stale",
          basis: raw.value.basis,
          currentJobId: null,
          failure: raw.value.failure,
          missingItems: [
            raw.value.failure
              ? "이전 분석을 완료하지 못했어요. 저장된 사건과 자료는 보존돼요."
              : "새 대화 내용을 반영해 분석과 리포트를 현재 기준으로 갱신해야 해요.",
          ],
        }
      : { status: "not_started", basis: null, currentJobId: null, failure: null, missingItems: [] },
    report: { status: report ? "stale" : "not_started", basis: null, currentJobId: null },
    pendingEvidenceIds: pending.map((r) => r.id),
  };
}

export async function reworkAccess(core: V2Core, ownerId: string, id: string, write = false) {
  opaqueIdSchema.parse(ownerId);
  opaqueIdSchema.parse(id);
  const owned = await core
    .statement(
      `SELECT w.id FROM v2_workspaces w JOIN user u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
      [id, ownerId],
    )
    .first();
  if (!owned) return false;
  const access = await readCustomerConsentSnapshot(core.binding, ownerId);
  return ["customer", "lawyer"].includes(access.accountType) && (!write || access.currentConsent);
}
/** Current case/scope proof plus exact official bindings. All reads remain local. */
export async function readPreparedAnalysis(
  core: V2Core,
  a: Actor,
  id: string,
  desiredScope?: AnalysisScope,
) {
  // Currentness is a local owner read. A withdrawn processing consent blocks
  // admission/publication, while the previously stored report remains readable.
  if (!(await reworkAccess(core, a.ownerId, id))) return null;
  const repo = createV2ReworkRepository(core);
  const before = await core
    .statement(
      "SELECT id FROM v2_rework_records WHERE workspace_id=? AND kind='analysis' AND entity_id=? AND state='published' ORDER BY revision DESC LIMIT 1",
      [id, id],
    )
    .first<{ id: string }>();
  if (!before) return null;
  const record = await repo.read(a, id, "analysis", id, preparedAnalysisRecordSchema);
  if (!record) throw new ReworkError("STALE_REVISION");
  if (!record.value.snapshot) return null;
  const scope = desiredScope ?? (await readAnalysisScope(core, a, id));
  const normalizedScope = (scope: AnalysisScope) => ({
    ...scope,
    excludedFileIds: [...scope.excludedFileIds].sort(),
  });
  if (
    canonicalAnalysisJson(normalizedScope(scope)) !==
    canonicalAnalysisJson(normalizedScope(record.value.scope))
  )
    return null;
  const current = await loadAnalysisInput(core, a, id, scope),
    snapshot = record.value.snapshot;
  if (
    !current.input ||
    current.pendingEvidenceIds.length ||
    !(await isAnalysisCurrent(snapshot, current.input))
  )
    return null;
  for (let index = 0; index < snapshot.citations.length; index += BOUND_SOURCE_BATCH_SIZE) {
    const expected = snapshot.citations.slice(index, index + BOUND_SOURCE_BATCH_SIZE);
    const actual = await readBoundSourceBatch(
      core,
      id,
      expected.map((c) => c.id),
      a.now,
      GUIDE_HOSTS,
    );
    if (
      actual.some(
        (s, i) => !s || canonicalAnalysisJson(s.citation) !== canonicalAnalysisJson(expected[i]),
      )
    )
      return null;
  }
  const endNow = new Date().toISOString();
  const sourceAuthority = await capturePublicationSourceAuthority(
    core,
    { ...a, now: endNow, workspaceId: id, expectedRevision: current.workspace.workspaceRevision },
    snapshot.citations.map((c) => ({ kind: "official_source" as const, citationId: c.id })),
    snapshot.citations,
    GUIDE_HOSTS,
  );
  if (
    !sourceAuthority ||
    !(await core
      .statement(
        `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND (${sourceAuthority.sql})`,
        [id, a.ownerId, current.workspace.workspaceRevision, ...sourceAuthority.values(endNow)],
      )
      .first())
  )
    return null;
  const after = await core
    .statement(
      `SELECT r.id FROM v2_rework_records r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND r.kind='analysis' AND r.entity_id=w.id AND r.state='published' ORDER BY r.revision DESC LIMIT 1`,
      [id, a.ownerId, current.workspace.workspaceRevision],
    )
    .first<{ id: string }>();
  if (
    after?.id !== record.id ||
    before.id !== record.id ||
    !(await reworkAccess(core, a.ownerId, id))
  )
    throw new ReworkError("STALE_REVISION");
  return snapshot;
}
export async function preparedAnalysisMatchesScope(
  core: V2Core,
  a: Actor,
  id: string,
  snapshot: V2LegalAnalysisSnapshot,
  scope: AnalysisScope,
) {
  const current = await readPreparedAnalysis(core, a, id, scope);
  return current !== null && canonicalAnalysisJson(current) === canonicalAnalysisJson(snapshot);
}
/** One full authoritative read, fenced by the actual current report scope. */
export async function readPreparedAnalysisForScope(
  core: V2Core,
  a: Actor,
  id: string,
  requested: { excludedFileIds: readonly string[]; maskIdentifiers: boolean },
) {
  const normalized = (scope: typeof requested) =>
    canonicalAnalysisJson({
      excludedFileIds: [...scope.excludedFileIds].sort(),
      maskIdentifiers: scope.maskIdentifiers,
    });
  const before = await readAnalysisScope(core, a, id);
  if (normalized(before) !== normalized(requested)) return null;
  const snapshot = await readPreparedAnalysis(core, a, id, before);
  if (!snapshot) return null;
  const after = await readAnalysisScope(core, a, id);
  return normalized(before) === normalized(after) ? snapshot : null;
}
type ReportSummary = {
  id: string;
  revision: number;
  stale: boolean;
  analysisReview?: { analysisId: string | null; status?: string; userEdited?: boolean } | undefined;
};
const intentSchema = z.object({
  id: opaqueIdSchema,
  operationId: opaqueIdSchema,
  role: z.literal("assistant"),
  workspaceRevision: z.number().int().positive(),
  conversationIntent: v2ConversationIntentSchema.nullable().optional(),
});
export function createReworkStateService(
  core: V2Core,
  deps: {
    clock?: () => string;
    peekReport?: (ownerId: string, id: string) => Promise<ReportSummary | null>;
  } = {},
) {
  const now = deps.clock ?? (() => new Date().toISOString()),
    records = createV2ReworkRepository(core),
    workspaces = createV2WorkspaceRepository(core.binding, core.cipher);
  return {
    async get(ownerId: string, id: string) {
      const a = { ownerId, now: now() };
      if (!(await reworkAccess(core, ownerId, id))) throw new ReworkError("NOT_FOUND");
      const w = await workspaces.findWorkspace(a, id);
      if (!w) throw new ReworkError("NOT_FOUND");
      const context = await createReworkCaseService(core, { clock: now }).get(ownerId, id);
      const scope = await readAnalysisScope(core, a, id),
        loaded = await loadAnalysisInput(core, a, id, scope);
      const raw = await records.read(a, id, "analysis", id, preparedAnalysisRecordSchema);
      const task = w.currentJobId
        ? await records.read(a, id, "task", w.currentJobId, analysisTaskSchema)
        : null;
      const job = task
        ? await core
            .statement(
              "SELECT status,failure_code FROM v2_jobs WHERE id=? AND operation_id=? AND target_revision=?",
              [task.value.jobId, task.value.operationId, w.workspaceRevision],
            )
            .first<{ status: string; failure_code: string | null }>()
        : null;
      let snapshot = raw?.value.snapshot ?? null;
      let analysis: V2ConversationState["analysis"] = {
        status: "not_started",
        basis: null,
        currentJobId: null,
        failure: null,
        missingItems: [],
      };
      if (raw) {
        const current = await readPreparedAnalysis(core, a, id, scope);
        const failureCurrent =
          loaded.input &&
          canonicalAnalysisJson(await analysisBasis(loaded.input)) ===
            canonicalAnalysisJson(raw.value.basis);
        analysis =
          raw.value.failure && failureCurrent
            ? {
                status: "failed",
                basis: raw.value.basis,
                currentJobId: null,
                failure: raw.value.failure,
                missingItems: [
                  "분석을 완료하지 못했어요. 저장된 사건과 자료는 보존돼요.",
                  ...loaded.limits,
                ],
              }
            : current
              ? {
                  status: current.status,
                  basis: current.basis,
                  currentJobId: null,
                  failure: null,
                  missingItems: current.limitations,
                }
              : {
                  status: "stale",
                  basis: raw.value.basis,
                  currentJobId: null,
                  failure: null,
                  missingItems: [
                    "사건 내용·자료·표시 범위가 바뀌었어요. 현재 기준으로 분석을 다시 준비해 주세요.",
                  ],
                };
        if (current) snapshot = current;
      }
      if (
        task &&
        job &&
        task.value.jobId === w.currentJobId &&
        task.value.targetWorkspaceRevision === w.workspaceRevision &&
        task.workspaceRevision === w.workspaceRevision &&
        ["queued", "running", "validating"].includes(job.status)
      )
        analysis = {
          status: job.status === "queued" ? "pending" : "running",
          basis: await analysisBasis(task.value.input),
          currentJobId: task.value.jobId,
          failure: null,
          missingItems: [],
        };
      const automatic = await records.read(
        a,
        id,
        "checkpoint",
        "automatic-preparation",
        automaticPreparationRecordSchema,
      );
      if (
        automatic?.value.status === "failed" &&
        automatic.value.failure &&
        loaded.input &&
        !["pending", "running"].includes(analysis.status) &&
        canonicalAnalysisJson(await analysisBasis(loaded.input)) ===
          canonicalAnalysisJson(automatic.value.basis) &&
        ["not_started", "stale"].includes(analysis.status)
      ) {
        analysis = {
          status: "failed",
          basis: automatic.value.basis,
          currentJobId: null,
          failure: automatic.value.failure,
          missingItems: [
            "분석 처리를 시작하지 못했어요. 저장된 사건과 자료는 보존돼요.",
            ...loaded.limits,
          ],
        };
      }
      const reportPending =
        !!task?.value.continueWithReport && ["pending", "running"].includes(analysis.status);
      const report = (await deps.peekReport?.(ownerId, id)) ?? null;
      const reportReady =
        !!report &&
        !report.stale &&
        report.analysisReview?.userEdited !== true &&
        analysis.basis !== null &&
        ((!!snapshot &&
          report.analysisReview?.analysisId === snapshot.id &&
          report.analysisReview.status !== "review_required" &&
          canonicalAnalysisJson(snapshot.basis) === canonicalAnalysisJson(analysis.basis) &&
          !["pending", "running", "stale", "failed"].includes(analysis.status)) ||
          (analysis.status === "failed" &&
            report.analysisReview?.analysisId === null &&
            report.analysisReview.status === "review_required"));
      const continuation = await records.read(
        a,
        id,
        "checkpoint",
        "report-continuation",
        reportContinuationSchema,
      );
      const reportFailure =
        continuation?.value.status === "failed" &&
        analysis.basis !== null &&
        !["pending", "running", "stale"].includes(analysis.status) &&
        canonicalAnalysisJson(continuation.value.basis) === canonicalAnalysisJson(analysis.basis)
          ? continuation.value.failure
          : null;
      const intents: V2ConversationState["intents"] = [];
      const messages = (
        await core
          .statement(
            "SELECT m.id,m.revision,m.workspace_revision,m.operation_id FROM v2_messages m JOIN v2_operations o ON o.id=m.operation_id JOIN v2_jobs j ON j.operation_id=o.id AND j.workspace_id=m.workspace_id AND j.target_kind='workspace' AND j.target_id=m.workspace_id AND j.target_revision=m.workspace_revision AND j.kind='chat_response' AND j.status='completed' WHERE m.workspace_id=? AND m.role='assistant' AND o.owner_id=? AND o.workspace_id=m.workspace_id AND o.kind='chat' ORDER BY m.created_at DESC,m.id DESC LIMIT 100",
            [id, ownerId],
          )
          .all<{ id: string; revision: number; workspace_revision: number; operation_id: string }>()
      ).results;
      for (const row of messages) {
        const cipher = await core
          .statement(
            "SELECT encrypted_payload FROM v2_messages WHERE id=? AND workspace_id=? AND revision=?",
            [row.id, id, row.revision],
          )
          .first<{ encrypted_payload: string }>();
        if (!cipher) throw new ReworkError("STALE_REVISION");
        const value = await core.decrypt(
          "v2_messages",
          row.id,
          ownerId,
          row.revision,
          cipher.encrypted_payload,
          intentSchema,
        );
        if (
          value.id !== row.id ||
          value.operationId !== row.operation_id ||
          value.workspaceRevision !== row.workspace_revision
        )
          throw new ReworkError("STALE_REVISION");
        if (value.conversationIntent)
          intents.push({
            messageId: value.id,
            requestId: `intent-${value.id}`,
            intent: value.conversationIntent,
            // Atomic response publication advances its admission revision once.
            // Keep this immutable publication revision; never rebase old intents.
            workspaceRevision: value.workspaceRevision + 1,
          });
      }
      // A newly published intent may belong to a later revision than the first
      // workspace read. Classify that race before validating one wire snapshot.
      const final = await workspaces.findWorkspace({ ownerId, now: now() }, id);
      if (
        final?.workspaceRevision !== w.workspaceRevision ||
        !(await reworkAccess(core, ownerId, id))
      )
        throw new ReworkError("STALE_REVISION");
      return v2ConversationStateSchema(GUIDE_HOSTS).parse({
        contractVersion: v2ReworkVersionSchema.value,
        workspaceRevision: w.workspaceRevision,
        caseContext: context.context,
        summaryConfirmed: !!w.confirmedSummaryRevision,
        pendingEvidenceIds: loaded.pendingEvidenceIds,
        analysis,
        snapshot,
        report: {
          status: reportPending
            ? "pending"
            : reportReady
              ? "ready"
              : reportFailure
                ? "failed"
                : report
                  ? "stale"
                  : "not_started",
          id: report?.id ?? null,
          revision: report?.revision ?? null,
          basis: reportReady ? analysis.basis : null,
          currentJobId: reportPending ? analysis.currentJobId : null,
          failure: reportPending || reportReady ? null : reportFailure,
        },
        intents,
      });
    },
  };
}
