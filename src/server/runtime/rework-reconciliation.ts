import type { V2UserMessage } from "../../contracts/v2";
import {
  createV2AccountingRepository,
  operationStatements,
  quotaTransitionStatements,
} from "../db/v2-accounting";
import { aliveWorkspace, sqlClaim, type V2Core, type WorkspaceGuard } from "../db/v2-core";
import { createV2JobsRepository } from "../db/v2-jobs";
import { createV2ReworkRepository } from "../db/v2-rework";
import { prepareReworkJobAdmission } from "../db/v2-rework-jobs";
import { prepareReconciledSummary } from "../db/v2-rework-summary";
import {
  completeLeaseStatements,
  createV2WorkspaceRepository,
  type JobLease,
} from "../db/v2-workspace";
import { configuredBounds } from "../modules/budget/model-configuration";
import {
  createSummaryReconciliationService,
  type SummaryReconciliationGeneration,
} from "../modules/intake/summary-reconciliation";
import { canonicalAnalysisJson } from "../modules/legal-retrieval/analysis/context";
import { textHash } from "../modules/legal-retrieval/service";
import { capturePublicationSourceAuthority } from "../modules/legal-retrieval/v2/publication-authority";
import { GUIDE_HOSTS } from "../modules/legal-retrieval/v2/registry";
import { ModelError } from "../modules/llm-gateway/service";
import {
  summaryReconciliationOutputSchema,
  workspaceAuditOutputSchema,
} from "../modules/llm-gateway/v2/schemas";
import { ReworkError } from "../modules/rework/case-context";
import { loadReconciliationSource } from "../modules/rework/reconciliation-source";
import { reworkAccess } from "../modules/rework/state";
import { workspaceCalendar } from "../modules/workspace/context";
import type { WorkspaceParams } from "../modules/workspace/execution";
import {
  createSummaryReconciliationStorage,
  type ReconciliationMutation,
  type StoredSummaryReconciliation,
  summaryReconciliationRecordSchema,
} from "../modules/workspace/summary-reconciliation-storage";
import {
  createLeasedWorkspaceGateway,
  createWorkspaceGatewayBudget,
  gatewayAttemptRequest,
  readWorkspaceGatewayAdmission,
} from "./gateway";
import { readProcessingProofs } from "./processing-proofs";

/** Event metadata is server control, not a claimed date of the underlying case. */
export function reconciliationModelInput(
  input: SummaryReconciliationGeneration,
  createdAt: string,
) {
  return {
    request: { id: input.request.id, input: input.request.input },
    before: input.before,
    context: { ...input.context, calendar: workspaceCalendar(createdAt) },
  };
}
export function createReconciliationRuntime(
  core: V2Core,
  env: Env,
  deps: {
    clock?: () => string;
    waitUntil?: (work: Promise<void>) => void;
    confirmed?: (ownerId: string, caseId: string) => Promise<void>;
  } = {},
) {
  const clock = deps.clock ?? (() => new Date().toISOString()),
    records = createV2ReworkRepository(core, { clock }),
    accounting = createV2AccountingRepository(core),
    jobs = createV2JobsRepository(core),
    workspace = createV2WorkspaceRepository(core.binding, core.cipher);
  const leases = new Map<string, JobLease>();
  const runs = new Map<
    string,
    {
      params: WorkspaceParams;
      record: StoredSummaryReconciliation;
      initial: NonNullable<Awaited<ReturnType<typeof readWorkspaceGatewayAdmission>>>;
      gateway?: ReturnType<typeof createLeasedWorkspaceGateway>;
      authorize?: () => Promise<boolean>;
      sourceProof?: NonNullable<Awaited<ReturnType<typeof capturePublicationSourceAuthority>>>;
    }
  >();
  const gatewayFor = async (generation: SummaryReconciliationGeneration) => {
    const run = runs.get(generation.request.id),
      lease = run ? leases.get(run.params.jobId) : undefined;
    if (!run || !lease) throw new ModelError("MODEL_UNAVAILABLE");
    if (!run.gateway) {
      const actor = { ownerId: run.params.ownerId, caseId: run.params.workspaceId, now: clock() };
      const source = await loadReconciliationSource(core, actor, {
        write: true,
        requestMessage: run.record.requestMessage,
      });
      if (
        source.workspaceRevision !== run.params.workspaceRevision ||
        source.sourceDigest !== run.record.sourceDigest ||
        canonicalAnalysisJson(source.summary) !== canonicalAnalysisJson(generation.before)
      )
        throw new ReworkError("STALE_REVISION");
      const proof = await capturePublicationSourceAuthority(
        core,
        { ...actor, workspaceId: actor.caseId, expectedRevision: source.workspaceRevision },
        source.context.citations.map((c) => ({
          kind: "official_source" as const,
          citationId: c.id,
        })),
        source.context.citations,
        GUIDE_HOSTS,
      );
      if (!proof) throw new ReworkError("STALE_REVISION");
      run.sourceProof = proof;
      const authorize = async () =>
        (await reworkAccess(core, actor.ownerId, actor.caseId, true)) &&
        !!(await core
          .statement(
            `SELECT w.id FROM v2_workspaces w JOIN v2_jobs j ON j.id=w.current_job_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND (${source.authority.sql}) AND (${proof.sql})`,
            [
              actor.caseId,
              actor.ownerId,
              run.params.workspaceRevision,
              run.params.jobId,
              lease.token,
              lease.fencing,
              clock(),
              ...source.authority.values,
              ...proof.values(clock()),
            ],
          )
          .first());
      run.authorize = authorize;
      run.gateway = createLeasedWorkspaceGateway(core, env, {
        ownerId: actor.ownerId,
        caseId: actor.caseId,
        revision: run.params.workspaceRevision,
        jobId: run.params.jobId,
        operationId: run.record.requestMessage.operationId,
        lease,
        primary: "workspace_summary_reconciliation",
        admission: run.initial,
        authorize,
        clock,
        waitUntil: deps.waitUntil ?? (() => {}),
        onPhase: async (phase) => {
          const revision =
            (await core
              .statement(
                "SELECT coalesce(max(revision),0)+1 revision FROM v2_job_checkpoints WHERE job_id=?",
                [run.params.jobId],
              )
              .first<number>("revision")) ?? 1;
          if (
            !(await jobs.checkpoint({ ownerId: actor.ownerId, now: clock() }, lease, {
              id: crypto.randomUUID(),
              revision,
              phase:
                phase === "workspace_summary_reconciliation_audit" ? "validating" : "generating",
              progress: 0,
              opaqueIds: [],
            }))
          )
            throw new ModelError("MODEL_UNAVAILABLE");
        },
      });
    }
    if (!run.authorize) throw new ModelError("MODEL_UNAVAILABLE");
    return { run, gateway: run.gateway, authorize: run.authorize };
  };
  const route = (caseId: string, action: string) =>
    `/api/v2/cases/${caseId}/rework/${action === "request" ? "tasks/summary_reconciliation" : `summary-reconciliation/${action}`}`;
  const consent = async (ownerId: string, caseId: string) => {
    if (!(await reworkAccess(core, ownerId, caseId))) throw new ReworkError("NOT_FOUND");
    if (!(await reworkAccess(core, ownerId, caseId, true)))
      throw new ReworkError("CONSENT_REQUIRED");
  };
  const receipt = async <T>(args: ReconciliationMutation<T>, action: string) => {
    await consent(args.actor.ownerId, args.actor.caseId);
    const requestHash = await textHash(canonicalAnalysisJson(args.input)),
      name = route(args.actor.caseId, action);
    const found = await accounting.findOperation(
      { ownerId: args.actor.ownerId, now: clock() },
      name,
      args.key,
      requestHash,
    );
    if (found?.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
    if (found) {
      const id =
        action === "request"
          ? await core
              .statement(
                "SELECT id FROM v2_rework_records WHERE workspace_id=? AND kind='reconciliation' AND entity_id=? AND workspace_revision=? AND state='published' ORDER BY revision ASC LIMIT 1",
                [args.actor.caseId, args.actor.caseId, found.operation.revision],
              )
              .first<string>("id")
          : found.operation.id;
      const record = id
        ? await records.read(
            args.actor,
            args.actor.caseId,
            "reconciliation",
            args.actor.caseId,
            summaryReconciliationRecordSchema,
            id,
          )
        : null;
      if (!record) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      return { response: record.value.state, name, requestHash };
    }
    return { response: null, name, requestHash };
  };
  const receiptAuthority = (ownerId: string, name: string, key: string) => ({
    sql: "NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=? AND route=? AND key=? AND expires_at>?)",
    values: [ownerId, name, key, clock()],
  });
  const receiptStatements = (
    g: WorkspaceGuard,
    name: string,
    key: string,
    requestHash: string,
    claim: string,
    recordId: string,
  ) => [
    ...operationStatements(
      core,
      g,
      {
        id: recordId,
        workspaceId: g.workspaceId,
        kind: "summary",
        revision: g.expectedRevision + 1,
        route: name,
        key,
        requestHash,
      },
      claim,
    ),
    core.statement(`UPDATE v2_operations SET state='completed' WHERE id=? AND ${sqlClaim}`, [
      recordId,
      claim,
    ]),
  ];
  const adapter = createSummaryReconciliationStorage(core, {
    clock,
    authorize: (actor, options) =>
      loadReconciliationSource(core, { ...actor, now: clock() }, options),
    admitTask: async (args, commit) => {
      const r = await receipt(args, "request");
      if (r.response) return r.response;
      const a = { ...args.actor, now: clock() },
        source = await loadReconciliationSource(core, a, { write: true });
      if (
        source.workspaceRevision !== args.input.expectedRevision ||
        source.summary.revision !== args.input.summaryRevision
      )
        throw new ReworkError("STALE_REVISION");
      if (
        !env.WORKSPACE_PROCESSING ||
        !env.AI ||
        !env.AI_GATEWAY_ID?.trim() ||
        !configuredBounds(env)
      )
        throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const usage = await accounting.usage(a);
      if (usage.aiResponses.remaining < 1) throw new ReworkError("USER_QUOTA_EXCEEDED");
      await accounting.ensurePrincipal(a);
      const proofs = await readProcessingProofs(
        core,
        env.APP_ENV === "production" ? "production" : "preview",
        a.now,
        "model_input_tokens",
      );
      if (!proofs) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const operationId = crypto.randomUUID(),
        jobId = crypto.randomUUID(),
        invocationId = crypto.randomUUID();
      const message: V2UserMessage = {
        schemaVersion: "2",
        id: args.requestId,
        operationId,
        workspaceRevision: args.input.expectedRevision + 1,
        createdAt: a.now,
        role: "user",
        text: args.input.explanation,
        selectedFileIds: [],
      };
      const modelSource = await loadReconciliationSource(core, a, {
        write: true,
        requestMessage: message,
        admittingMessage: true,
      });
      const input = reconciliationModelInput(
        {
          request: { id: args.requestId, input: args.input, createdAt: message.createdAt },
          before: source.summary,
          context: modelSource.context,
        },
        a.now,
      );
      const paid = await createWorkspaceGatewayBudget(
        core,
        env,
        a.ownerId,
        input,
        clock,
      ).prepareAdmission(
        {
          ...proofs,
          operationId,
          operationRevision: message.workspaceRevision,
          requestHash: r.requestHash,
          jobId,
          targetKind: "workspace",
          targetId: a.caseId,
          targetRevision: message.workspaceRevision,
          invocationId,
          maximumAttempts: 3,
          deadlineAt: new Date(Date.parse(a.now) + 300000).toISOString(),
        },
        await gatewayAttemptRequest(
          "workspace_summary_reconciliation",
          input,
          invocationId,
          args.requestId,
        ),
      );
      if (
        !paid ||
        workspaceCalendar(paid.actor.now).localDate !== workspaceCalendar(a.now).localDate
      )
        throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      message.createdAt = paid.actor.now;
      const g = {
        ...paid.actor,
        workspaceId: a.caseId,
        expectedRevision: args.input.expectedRevision,
      };
      const plan = await prepareReworkJobAdmission(
        core,
        g,
        {
          admission: { operationId, key: args.key, requestHash: r.requestHash },
          jobId,
          kind: "summary_reconciliation",
          summaryRevision: args.input.summaryRevision,
          authority: source.authority,
          userMessage: { id: message.id, text: message.text },
        },
        paid.paid,
      );
      if (!plan) throw new ReworkError("STALE_REVISION");
      return commit({
        jobId,
        message,
        authority: plan.authority,
        statements: (claim) => plan.statements(claim),
      });
    },
    lease: async (actor, jobId) => {
      const initial = await readWorkspaceGatewayAdmission(
        core,
        env,
        jobId,
        (await workspace.findWorkspace(actor, actor.caseId))?.workspaceRevision ?? 0,
        clock(),
      );
      if (!initial) return null;
      const now = clock();
      const acquired = await jobs.acquire(
        { ownerId: actor.ownerId, now },
        jobId,
        crypto.randomUUID(),
        new Date(Date.parse(now) + 300000).toISOString(),
        initial.attempt_id,
      );
      if (acquired) leases.set(jobId, acquired.lease);
      return acquired?.lease ?? null;
    },
    generate: async (generation) => {
      const { run, gateway, authorize } = await gatewayFor(generation);
      return summaryReconciliationOutputSchema.parse(
        await gateway.call(
          "workspace_summary_reconciliation",
          reconciliationModelInput(generation, run.initial.created_at),
          generation.request.id,
          authorize,
          authorize,
          run.initial.original.plan.invocationId,
        ),
      );
    },
    audit: async (generation) => {
      const { run, gateway, authorize } = await gatewayFor(generation);
      const hash = await textHash(`baro-reconciliation-audit:${run.params.jobId}`);
      // Stable per-job UUID keeps the independent audit separately metered and
      // replay-safe without adding a public field or storing another identifier.
      const invocationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const checked = workspaceAuditOutputSchema.parse(
        await gateway.call(
          "workspace_summary_reconciliation_audit",
          {
            ...reconciliationModelInput(generation, run.initial.created_at),
            after: generation.after,
            reasons: generation.reasons,
          },
          generation.request.id,
          authorize,
          authorize,
          invocationId,
        ),
      );
      return {
        pass:
          checked.pass &&
          checked.legalClaimsSupported &&
          !checked.strategyDetected &&
          checked.unsupportedFactIds.length === 0 &&
          !checked.findings.some((f) => f.severity === "critical"),
      };
    },
    settleTask: async (args, prepare) => {
      const p = await prepare();
      const proof = args.status === "proposed" ? runs.get(args.requestId)?.sourceProof : null;
      if (args.status === "proposed" && !proof) throw new ReworkError("STALE_REVISION");
      return p.commit({
        authority: proof
          ? (now) => ({
              sql: `(${p.authority.sql}) AND (${proof.sql})`,
              values: [...p.authority.values, ...proof.values(now)],
            })
          : p.authority,
        statements: (claim) => [
          ...(args.status === "proposed"
            ? completeLeaseStatements(core, args.lease, claim, clock())
            : [
                core.statement(
                  `UPDATE v2_jobs SET status='failed',failure_code=?,retryable=0,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${sqlClaim}`,
                  [args.failure ?? "MODEL_UNAVAILABLE", clock(), args.jobId, claim],
                ),
                core.statement(
                  `UPDATE v2_operations SET state='failed' WHERE id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
                  [args.jobId, claim],
                ),
                ...quotaTransitionStatements(core, args.jobId, claim, "released", undefined, true),
              ]),
          core.statement(
            `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND current_job_id=? AND ${sqlClaim}`,
            [args.actor.caseId, args.jobId, claim],
          ),
        ],
      });
    },
    publishConfirmedSummary: async (args, prepare) => {
      const r = await receipt(args, "confirm");
      if (r.response) return r.response;
      const p = await prepare(),
        proposal = p.state.proposal;
      if (!proposal) throw new ReworkError("REVIEW_REQUIRED");
      const plan = await prepareReconciledSummary(core, p.guard, {
        snapshotId: proposal.id,
        beforeRevision: proposal.before.revision,
        summary: proposal.after,
        authority: p.authority,
      });
      if (!plan) throw new ReworkError("STALE_REVISION");
      const once = receiptAuthority(args.actor.ownerId, r.name, args.key);
      const response = await p.commit({
        authority: {
          sql: `(${plan.authority.sql}) AND (${once.sql})`,
          values: [...plan.authority.values, ...once.values],
        },
        statements: (claim, id) => [
          ...plan.statements(claim),
          ...receiptStatements(p.guard, r.name, args.key, r.requestHash, claim, id),
        ],
      });
      await deps.confirmed?.(args.actor.ownerId, args.actor.caseId);
      return response;
    },
    cancelTaskAndPublish: async (args, prepare) => {
      const r = await receipt(args, "cancel");
      if (r.response) return r.response;
      const p = await prepare(),
        jobId = p.record.value.state.currentJobId;
      const cancellation = jobId
        ? await records.prepareCancellation(p.guard, args.input.requestId)
        : null;
      if (jobId && !cancellation) throw new ReworkError("STALE_REVISION");
      const once = receiptAuthority(args.actor.ownerId, r.name, args.key);
      const saved = await records.write(p.guard, {
        kind: "reconciliation",
        expectedVersion: p.record.revision,
        value: { ...p.record.value, state: p.state },
        schema: summaryReconciliationRecordSchema,
        bumpWorkspace: true,
        ...(cancellation ? { cancellation } : {}),
        authority: once,
        statements: (claim, id) =>
          receiptStatements(p.guard, r.name, args.key, r.requestHash, claim, id),
      });
      if (!saved) throw new ReworkError("STALE_REVISION");
      return saved.value.state;
    },
  });
  const service = createSummaryReconciliationService(adapter);
  return {
    service,
    async execute(params: WorkspaceParams, instanceId: string) {
      const record = await records.read(
        { ownerId: params.ownerId, now: clock() },
        params.workspaceId,
        "reconciliation",
        params.workspaceId,
        summaryReconciliationRecordSchema,
      );
      if (!record || record.value.state.currentJobId !== params.jobId) return null;
      const runtime = await core
        .statement("SELECT runtime_instance_id FROM v2_jobs WHERE id=? AND target_revision=?", [
          params.jobId,
          params.workspaceRevision,
        ])
        .first<string>("runtime_instance_id");
      if (runtime !== instanceId) return { jobId: params.jobId, status: "stopped" as const };
      const requestId = record.value.state.request?.id;
      if (!requestId) throw new ReworkError("STALE_REVISION");
      const initial = await readWorkspaceGatewayAdmission(
        core,
        env,
        params.jobId,
        params.workspaceRevision,
        clock(),
      );
      if (!initial) return { jobId: params.jobId, status: "stopped" as const };
      runs.set(requestId, { params, record: record.value, initial });
      try {
        const result = await service.execute(
          { ownerId: params.ownerId, caseId: params.workspaceId },
          requestId,
        );
        return {
          jobId: params.jobId,
          status:
            result.status === "proposed"
              ? ("completed" as const)
              : result.status === "failed"
                ? ("failed" as const)
                : ("stopped" as const),
        };
      } finally {
        runs.delete(requestId);
        leases.delete(params.jobId);
      }
    },
  };
}
