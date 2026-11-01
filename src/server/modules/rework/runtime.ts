import { z } from "zod";
import {
  type V2ConversationActionRequest,
  type V2ConversationActionResult,
  v2ConversationActionResultSchema,
  v2FailureCodeSchema,
  v2ReworkVersionSchema,
} from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { createV2ReworkRepository } from "../../db/v2-rework";
import { createV2WorkspaceRepository } from "../../db/v2-workspace";
import { createLegalAnalysisJobs } from "../../runtime/rework-analysis";
import { createReconciliationRuntime } from "../../runtime/rework-reconciliation";
import { configuredBounds } from "../budget/model-configuration";
import { analysisBasis, canonicalAnalysisJson } from "../legal-retrieval/analysis/context";
import { textHash } from "../legal-retrieval/service";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import type { Transport } from "../legal-retrieval/v2/transport";
import { createCaseReportDependencies } from "../reports/runtime";
import { createReportsService } from "../reports/service";
import type { ReportDependencies } from "../reports/storage";
import { createConversationAgent } from "../workspace/conversation-agent";
import { loadAnalysisInput, readAnalysisScope } from "./analysis-input";
import { createReworkCaseService, ReworkError } from "./case-context";
import {
  automaticPreparationRecordSchema as automaticSchema,
  preparedAnalysisRecordSchema,
} from "./records";
import { createReportContinuation } from "./report-continuation";
import { createReworkResolutionRuntime } from "./resolution-runtime";
import { createReworkStateService, readPreparedAnalysis, reworkAccess } from "./state";

const actionReceiptSchema = z.strictObject({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: v2ConversationActionResultSchema,
});
const headerReceiptSchema = z.strictObject({ requestHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type ReworkRuntimeOptions = {
  clock?: () => string;
  waitUntil?: (work: Promise<void>) => void;
  admissionAllowed?: () => Promise<boolean>;
  sessionId?: string;
  /** Constructor-only upstream/test bindings; never HTTP-selected implementations. */
  transport?: Transport;
  reportDependencies?: (ownerId: string, caseId: string) => Promise<ReportDependencies>;
};
/** The single production composition is also used by the signed Hono fixture. */
export function createReworkRuntime(core: V2Core, env: Env, options: ReworkRuntimeOptions = {}) {
  const clock = options.clock ?? (() => new Date().toISOString()),
    actor = (ownerId: string) => ({ ownerId, now: clock() });
  const records = createV2ReworkRepository(core, { clock }),
    workspaces = createV2WorkspaceRepository(core.binding, core.cipher);
  const reportDependencies = async (owner: string, id: string) => ({
    ...(await (options.reportDependencies?.(owner, id) ??
      createCaseReportDependencies(env, core, owner, id, undefined, clock))),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  });
  const reports = async (owner: string, id: string) =>
    createReportsService(core, await reportDependencies(owner, id));
  const peekReport = async (owner: string, id: string) =>
    (await reports(owner, id)).peek(owner, id);
  const state = createReworkStateService(core, { clock, peekReport });
  const reportContinuation = createReportContinuation(core, env, {
    clock,
    reportDependencies,
  });
  const analysis = createLegalAnalysisJobs(core, env, {
    clock,
    ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
    ...(options.transport ? { transport: options.transport } : {}),
    prepareReport: async (owner, id, key, expected) => {
      await reportContinuation.prepare(owner, id, key, expected);
    },
  });
  const resolution = createReworkResolutionRuntime(core, {
    clock,
    peekReport,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  });
  async function authorize(owner: string, id: string, write = true) {
    if (!(await reworkAccess(core, owner, id))) throw new ReworkError("NOT_FOUND");
    if (write && !(await reworkAccess(core, owner, id, true)))
      throw new ReworkError("CONSENT_REQUIRED");
  }
  /** Called only after a user mutation, trusted Workflow completion or existing
   * bounded dispatch recovery. GET/poll never admits paid work. */
  async function resume(owner: string, id: string) {
    await authorize(owner, id);
    if (
      (await createReworkCaseService(core, { clock }).get(owner, id)).context.casePurpose ===
      "unconfirmed"
    )
      return { status: "waiting" as const };
    const a = actor(owner),
      scope = await readAnalysisScope(core, a, id),
      loaded = await loadAnalysisInput(core, a, id, scope);
    if (
      loaded.context.casePurpose === "unconfirmed" ||
      !loaded.input ||
      loaded.pendingEvidenceIds.length ||
      loaded.workspace.currentJobId
    )
      return { status: "waiting" as const };
    const basis = await analysisBasis(loaded.input),
      bounds = configuredBounds(env);
    // Technical configuration and actual daily capacity can change. Price/FX,
    // funding/allocation/observation dates are deliberately absent.
    const fingerprint = await textHash(
      canonicalAnalysisJson({
        basis,
        technical: {
          ai: !!env.AI,
          gateway: env.AI_GATEWAY_ID ?? null,
          workflow: !!env.WORKSPACE_PROCESSING,
          law: !!env.LAW_API_OC,
          context: bounds?.bounds.modelContextTokenLimit ?? null,
          input: bounds?.bounds.modelInputTokenLimit ?? null,
          output: bounds?.bounds.modelOutputTokenLimit ?? null,
        },
      }),
    );
    const attemptDay = new Date(Date.parse(a.now) + 9 * 3600000).toISOString().slice(0, 10);
    let prior = await records.read(a, id, "checkpoint", "automatic-preparation", automaticSchema);
    if (
      prior?.value.fingerprint === fingerprint &&
      ["complete", "failed"].includes(prior.value.status) &&
      !(prior.value.failure === "USER_QUOTA_EXCEEDED" && prior.value.attemptDay !== attemptDay)
    )
      return { status: prior.value.status };
    const retryDailyQuota =
      prior?.value.fingerprint === fingerprint &&
      prior.value.failure === "USER_QUOTA_EXCEEDED" &&
      prior.value.attemptDay !== attemptDay;
    if (prior?.value.fingerprint !== fingerprint || retryDailyQuota) {
      const report = await peekReport(owner, id);
      const requestId = `auto-${retryDailyQuota ? await textHash(`${fingerprint}:${attemptDay}`) : fingerprint}`;
      const next = await records.write(
        { ...a, workspaceId: id, expectedRevision: loaded.workspace.workspaceRevision },
        {
          kind: "checkpoint",
          entityId: "automatic-preparation",
          expectedVersion: prior?.revision ?? 0,
          schema: automaticSchema,
          value: {
            format: "automatic-preparation-v1",
            attemptDay,
            fingerprint,
            basis,
            requestId,
            expectedReportRevision: report?.revision ?? null,
            status: "registered",
            failure: null,
          },
          authority: loaded.authority,
        },
      );
      if (!next) return { status: "waiting" as const };
      prior = next;
    }
    if (!prior) throw new ReworkError("STALE_REVISION");
    const intent = prior.value;
    const mark = async (
      status: z.infer<typeof automaticSchema>["status"],
      failure: z.infer<typeof v2FailureCodeSchema> | null = null,
    ) => {
      const latest = await records.read(
          actor(owner),
          id,
          "checkpoint",
          "automatic-preparation",
          automaticSchema,
        ),
        w = await workspaces.findWorkspace(actor(owner), id);
      if (!latest || !w || latest.value.fingerprint !== fingerprint) return;
      await records.write(
        { ...actor(owner), workspaceId: id, expectedRevision: w.workspaceRevision },
        {
          kind: "checkpoint",
          entityId: "automatic-preparation",
          expectedVersion: latest.revision,
          schema: automaticSchema,
          value: { ...intent, attemptDay, status, failure },
          ...(w.currentJobId ? { metadataJobId: w.currentJobId } : {}),
        },
      );
    };
    try {
      const raw = await records.read(a, id, "analysis", id, preparedAnalysisRecordSchema),
        current = await readPreparedAnalysis(core, a, id, scope);
      const failed =
        raw?.value.failure &&
        canonicalAnalysisJson(raw.value.basis) === canonicalAnalysisJson(basis);
      if (current || failed) {
        const existing = await peekReport(owner, id);
        if (
          existing &&
          !existing.stale &&
          ((current && existing.analysisReview?.analysisId === current.id) ||
            (failed && existing.analysisReview?.analysisId === null))
        ) {
          await mark("complete");
          return { status: "complete" as const };
        }
        await mark("report");
        await reportContinuation.prepare(
          owner,
          id,
          intent.requestId,
          intent.expectedReportRevision,
        );
        await mark("complete");
        return { status: "complete" as const };
      }
      // A registered intent can recover an ACK loss before dispatch; the same
      // full request always resolves the original immutable admission.
      const admitted = await analysis.admit(owner, id, {
        requestId: intent.requestId,
        expectedRevision: loaded.workspace.workspaceRevision,
        continueWithReport: true,
        reportExpectedRevision: intent.expectedReportRevision,
      });
      await mark("analysis");
      await analysis.dispatch();
      return { status: "analysis" as const, ...admitted };
    } catch (error) {
      const code = v2FailureCodeSchema.safeParse((error as { code?: string })?.code);
      const failure = code.success ? code.data : "MODEL_UNAVAILABLE";
      // Preserve an honest bounded failure; an unchanged source/configuration
      // never starts a new automatic provider retry. Explicit actions can retry.
      try {
        await mark("failed", failure);
        await reportContinuation.prepare(
          owner,
          id,
          intent.requestId,
          intent.expectedReportRevision,
        );
      } catch {
        /* original authority loss is preserved */
      }
      return { status: "failed" as const };
    }
  }
  const reconciliation = createReconciliationRuntime(core, env, {
    clock,
    ...(options.admissionAllowed ? { admissionAllowed: options.admissionAllowed } : {}),
    ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
    confirmed: async (owner, id) => {
      await resume(owner, id);
    },
  });
  const agent = createConversationAgent({
    guideHosts: GUIDE_HOSTS,
    authorize: async (owner, id) => await reworkAccess(core, owner, id, true),
    load: async (owner, id) => {
      const w = await workspaces.findWorkspace(actor(owner), id);
      if (!w) return null;
      return {
        state: await state.get(owner, id),
        canMutate: await reworkAccess(core, owner, id, true),
        archived: w.status === "archived",
        workspaceJobId: w.currentJobId,
      };
    },
    once: async (input, work) => {
      const { ownerId: owner, caseId: id, request } = input;
      await authorize(owner, id);
      const hash = await textHash(canonicalAnalysisJson(request));
      const saved = await records.read(
        actor(owner),
        id,
        "action_receipt",
        request.requestId,
        actionReceiptSchema,
      );
      if (saved) {
        if (saved.value.requestHash !== hash) throw new ReworkError("IDEMPOTENCY_CONFLICT");
        return saved.value.result;
      }
      // Paid admission itself is the atomic receipt. It precedes expectedRevision
      // checks even if its public response was lost before a secondary UI receipt.
      const paid = await analysis.replay(owner, id, request.requestId, hash);
      if (paid)
        return v2ConversationActionResultSchema.parse({
          contractVersion: v2ReworkVersionSchema.value,
          requestId: request.requestId,
          pane: request.action === "prepare_report" ? "report" : "analysis",
          status: "pending",
          missingItems: [],
          ...paid,
        });
      if (request.action === "resolve_followup" && request.choice) {
        const replay = await resolution.replay(
          owner,
          id,
          `/api/v2/cases/${id}/rework/actions`,
          request.requestId,
          hash,
        );
        if (replay)
          return {
            contractVersion: v2ReworkVersionSchema.value,
            requestId: request.requestId,
            pane: "followup",
            status: "ready",
            missingItems: [],
            operationId: null,
            workspaceRevision: replay.basis?.workspaceRevision ?? request.expectedRevision,
          };
      }
      if (options.admissionAllowed && !(await options.admissionAllowed()))
        throw new ReworkError("RATE_LIMITED");
      const result = await work();
      const w = await workspaces.findWorkspace(actor(owner), id);
      if (!w) throw new ReworkError("NOT_FOUND");
      const receipt = await records.write(
        { ...actor(owner), workspaceId: id, expectedRevision: w.workspaceRevision },
        {
          kind: "action_receipt",
          entityId: request.requestId,
          expectedVersion: 0,
          schema: actionReceiptSchema,
          value: { requestHash: hash, result },
          ...(w.currentJobId ? { metadataJobId: w.currentJobId } : {}),
        },
      );
      if (!receipt) {
        const won = await records.read(
          actor(owner),
          id,
          "action_receipt",
          request.requestId,
          actionReceiptSchema,
        );
        if (won?.value.requestHash === hash) return won.value.result;
        throw new ReworkError("STALE_REVISION");
      }
      return result;
    },
    analyze: async (input) => {
      const current = await state.get(input.ownerId, input.caseId);
      if (current.analysis.currentJobId)
        return {
          operationId: current.analysis.currentJobId,
          workspaceRevision: current.workspaceRevision,
        };
      const admitted = await analysis.admit(input.ownerId, input.caseId, {
        requestId: input.request.requestId,
        expectedRevision: input.request.expectedRevision,
        // This opted-in conversation always retains a model-free report continuation.
        continueWithReport: true,
        actionRequest: input.request,
      });
      await analysis.dispatch();
      return admitted;
    },
    prepareReport: async (input) => {
      const prior = await peekReport(input.ownerId, input.caseId);
      await reportContinuation.prepare(
        input.ownerId,
        input.caseId,
        input.request.requestId,
        prior?.revision ?? null,
        await textHash(canonicalAnalysisJson(input.request)),
      );
      const w = await workspaces.findWorkspace(actor(input.ownerId), input.caseId);
      if (!w) throw new ReworkError("NOT_FOUND");
      return { operationId: null, workspaceRevision: w.workspaceRevision };
    },
    selectResolution: async (input) => {
      await resolution.select(
        input.ownerId,
        input.caseId,
        input.request.requestId,
        input.request.choice,
        await textHash(canonicalAnalysisJson(input.request)),
      );
      const w = await workspaces.findWorkspace(actor(input.ownerId), input.caseId);
      if (!w) throw new ReworkError("NOT_FOUND");
      return { operationId: null, workspaceRevision: w.workspaceRevision };
    },
  });
  return {
    state,
    analysis,
    reconciliation,
    resolution,
    reports,
    reportContinuation,
    resume,
    actions: agent,
    async act(
      owner: string,
      id: string,
      request: V2ConversationActionRequest,
      key: string = request.requestId,
    ): Promise<V2ConversationActionResult> {
      await authorize(owner, id);
      const requestHash = await textHash(canonicalAnalysisJson(request));
      const entityId = `action-key-${await textHash(key)}`;
      const previous = await records.read(
        actor(owner),
        id,
        "checkpoint",
        entityId,
        headerReceiptSchema,
      );
      if (previous && previous.value.requestHash !== requestHash)
        throw new ReworkError("IDEMPOTENCY_CONFLICT");
      if (!previous) {
        const w = await workspaces.findWorkspace(actor(owner), id);
        if (!w) throw new ReworkError("NOT_FOUND");
        const registered = await records.write(
          { ...actor(owner), workspaceId: id, expectedRevision: w.workspaceRevision },
          {
            kind: "checkpoint",
            entityId,
            expectedVersion: 0,
            schema: headerReceiptSchema,
            value: { requestHash },
            ...(w.currentJobId ? { metadataJobId: w.currentJobId } : {}),
          },
        );
        if (!registered) {
          const won = await records.read(
            actor(owner),
            id,
            "checkpoint",
            entityId,
            headerReceiptSchema,
          );
          if (won?.value.requestHash !== requestHash) throw new ReworkError("IDEMPOTENCY_CONFLICT");
        }
      }
      const result = await agent.execute(owner, id, request);
      // A report requested before confirmation/material readiness remains desired
      // by the persisted opt-in case; mutation/dispatch recovery resumes it.
      return result;
    },
  };
}
