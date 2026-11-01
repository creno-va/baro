import type { V2SummaryReconciliation, V2UserMessage } from "../../src/contracts/v2";
import {
  createV2AccountingRepository,
  quotaTransitionStatements,
} from "../../src/server/db/v2-accounting";
import { createV2Core, sqlClaim } from "../../src/server/db/v2-core";
import { runtimeDigest } from "../../src/server/db/v2-paid-runtime";
import { createV2ReworkRepository, reworkConsentGuard } from "../../src/server/db/v2-rework";
import { prepareReworkJobAdmission } from "../../src/server/db/v2-rework-jobs";
import { prepareReconciledSummary } from "../../src/server/db/v2-rework-summary";
import { completeLeaseStatements, type JobLease } from "../../src/server/db/v2-workspace";
import { createGatewayExecutionPlanner } from "../../src/server/modules/budget/execution-plan";
import { createGatewayBudgetService } from "../../src/server/modules/budget/gateway-ledger";
import { MODEL_ID } from "../../src/server/modules/llm-gateway/prompts";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../../src/server/modules/llm-gateway/service";
import { ReworkError } from "../../src/server/modules/rework/case-context";
import type { WorkspaceContext } from "../../src/server/modules/workspace/pipeline";
import {
  type ReconciliationMutation,
  type ReconciliationWritePlan,
  type SummaryReconciliationStoragePorts,
  summaryReconciliationRecordSchema,
} from "../../src/server/modules/workspace/summary-reconciliation-storage";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./customer-workspace";

/** Native D1/encryption/source reader; generation and external processing remain synthetic. */
export async function nativeReconciliationFixture(confirmed = true) {
  const f = await customerWorkspaceFixture();
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  const question = intake?.batches[0]?.questions[0];
  if (!intake || !question) throw new Error("Missing synthetic question");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: [{ questionId: question.id, status: "unknown" }],
  });
  await runCustomerJob(f, "intake_summary");
  if (confirmed) await confirmCustomerSummary(f);
  const core = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
  const actor = { ownerId: f.owner.userId, caseId: f.workspace.id, now: f.now };
  let sourceDigest = "a".repeat(64);
  let authorizeHook: (() => Promise<void>) | undefined;
  const authorize: SummaryReconciliationStoragePorts["authorize"] = async (a, options) => {
    const workspace = await f.repository.findWorkspace(a, a.caseId);
    if (!workspace) throw new ReworkError("NOT_FOUND");
    if (options.write) {
      const consent = reworkConsentGuard(a.ownerId);
      if (!(await f.core.statement(`SELECT 1 WHERE ${consent.sql}`, consent.values).first()))
        throw new ReworkError("CONSENT_REQUIRED");
    }
    const current = await f.repository.readIntake(a, a.caseId);
    if (!current?.summary) throw new ReworkError("REVIEW_REQUIRED");
    const row = await f.core
      .statement(
        "SELECT i.summary_id,s.snapshot_id FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id WHERE i.id=?",
        [a.caseId],
      )
      .first<{ summary_id: string; snapshot_id: string }>();
    if (!row) throw new ReworkError("NOT_FOUND");
    const all = (await f.repository.readMessages(a, a.caseId, 50)) ?? [];
    const messages = all.filter((m): m is V2UserMessage => m.role === "user");
    const issued = options.requestMessage;
    const latest = issued ? messages.find((m) => m.id === issued.id) : null;
    const context: WorkspaceContext = {
      subjectContext: workspace.subjectContext,
      intake: current,
      confirmedSummary: current.confirmedSummaryRevision === null ? null : current.summary,
      facts: current.summary.facts,
      messages,
      latestMessage: latest ?? null,
      citations: [],
      materials: [],
      references: {
        intakeRevision: current.revision,
        answeredQuestionIds: current.batches.flatMap((b) =>
          b.answers.filter((answer) => answer.status === "answered").map((a) => a.questionId),
        ),
        messages: messages.map((m) => ({ id: m.id, workspaceRevision: m.workspaceRevision })),
        files: [],
        verifiedCitationIds: [],
      },
    };
    await authorizeHook?.();
    return {
      workspaceRevision: workspace.workspaceRevision,
      summaryId: row.summary_id,
      summarySnapshotId: row.snapshot_id,
      summary: current.summary,
      context,
      sourceDigest,
      authority: {
        sql: "EXISTS(SELECT 1 FROM v2_intakes ri WHERE ri.id=w.id AND ri.summary_id=? AND ri.revision=w.intake_revision)",
        values: [row.summary_id],
      },
    };
  };
  return {
    ...f,
    core,
    actor,
    authorize,
    changeSources() {
      sourceDigest = "b".repeat(64);
    },
    onAuthorize(hook?: () => Promise<void>) {
      authorizeHook = hook;
    },
  };
}

type Fixture = Awaited<ReturnType<typeof nativeReconciliationFixture>>;
/** Root port harness. Real common atomic helpers, fake provider outputs, no runtime registrations. */
export function nativeReconciliationPorts(f: Fixture) {
  const records = createV2ReworkRepository(f.core, { clock: () => f.now });
  const leases = new Map<string, JobLease>();
  let generateCalls = 0;
  let beforeGenerate: (() => Promise<void>) | undefined;
  let auditPass = true;
  let beforeConfirm: (() => Promise<void>) | undefined;
  const receipt = async <T>(args: ReconciliationMutation<T>, action: string) => {
    await f.authorize(args.actor, { write: false });
    const name = `synthetic-reconciliation-${await runtimeDigest({ owner: args.actor.ownerId, caseId: args.actor.caseId, key: args.key, action })}`;
    const inputHash = await runtimeDigest(args.input);
    const replay = async () => {
      const row = await f.core
        .statement("SELECT value FROM app_metadata WHERE key=?", [name])
        .first<{ value: string }>();
      if (!row) return null;
      const saved = JSON.parse(row.value) as { inputHash: string; recordId: string };
      if (saved.inputHash !== inputHash) throw new ReworkError("IDEMPOTENCY_CONFLICT");
      const record = await records.read(
        args.actor,
        args.actor.caseId,
        "reconciliation",
        args.actor.caseId,
        summaryReconciliationRecordSchema,
        saved.recordId,
      );
      if (!record) throw new ReworkError("NOT_FOUND");
      return record.value.state;
    };
    return {
      replay,
      plan: {
        authority: { sql: "NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?)", values: [name] },
        statements: (claimId: string, recordId: string) => [
          f.core.statement(
            `INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? WHERE ${sqlClaim}`,
            [name, JSON.stringify({ inputHash, recordId }), f.now, claimId],
          ),
        ],
      } satisfies ReconciliationWritePlan,
    };
  };
  const replayOrRun = async (
    r: Awaited<ReturnType<typeof receipt>>,
    run: () => Promise<V2SummaryReconciliation>,
  ) => {
    const replay = await r.replay();
    if (replay) return replay;
    try {
      return await run();
    } catch (cause) {
      const retry = await r.replay();
      if (retry) return retry;
      throw cause;
    }
  };
  const acquire = async (ownerId: string, jobId: string) => {
    const acquired = await f.jobs.acquire(
      { ownerId, now: f.now },
      jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.now) + 300000).toISOString(),
    );
    if (acquired) leases.set(jobId, acquired.lease);
    return acquired?.lease ?? null;
  };
  const ports: SummaryReconciliationStoragePorts = {
    clock: () => f.now,
    authorize: f.authorize,
    generate: async ({ before, request, context }) => {
      generateCalls++;
      await beforeGenerate?.();
      const message = context.latestMessage;
      if (!message) throw new Error("Missing persisted synthetic explanation");
      return {
        after: {
          ...before,
          revision: before.revision + 1,
          overview: `${before.overview} 추가 진술을 함께 확인했습니다.`,
          facts: [
            ...before.facts,
            {
              id: `fact-${request.id}`,
              text: message.text,
              attribution: "user_statement",
              certainty: "reported",
              significance: "neutral",
              references: [
                {
                  kind: "user_message",
                  messageId: message.id,
                  workspaceRevision: message.workspaceRevision,
                },
              ],
              conflictingFactIds: [],
              userEdited: false,
            },
          ],
        },
        reasons: ["새 사용자 진술을 기존 원문과 구분해 보존했습니다."],
      };
    },
    audit: async () => ({ pass: auditPass }),
    admitTask: async (args, commit) => {
      const r = await receipt(args, "request");
      return replayOrRun(r, async () => {
        const source = await f.authorize(args.actor, { write: true });
        const g = {
          ownerId: args.actor.ownerId,
          workspaceId: args.actor.caseId,
          expectedRevision: args.input.expectedRevision,
          now: f.now,
        };
        await createV2AccountingRepository(f.core).ensurePrincipal(g);
        const jobId = crypto.randomUUID(),
          operationId = crypto.randomUUID(),
          invocationId = crypto.randomUUID();
        const requestHash = await runtimeDigest(args.input);
        const planner = createGatewayExecutionPlanner({
          applicationCostLimitsEnabled: false,
          input: async () => ({}),
          bounds: async () => ({
            basis: "verified_model_context_limit",
            tokenizerRevision: "synthetic-only",
            textTokensUpperBound: 10000,
            framingTokensUpperBound: 0,
            vision: null,
            modelInputTokenLimit: 10000,
            modelContextTokenLimit: 20000,
            modelOutputTokenLimit: 10000,
            checkedAt: f.now,
            validUntil: "2026-10-07T00:00:00.000Z",
          }),
          verifyBounds: async (_d, digest) => ({
            digest,
            evidenceHash: "a".repeat(64),
            verifiedAt: f.now,
          }),
        });
        const wire = prepareGatewayWireInput("workspace_legal_plan", {});
        const paid = await createGatewayBudgetService({
          core: f.core,
          environment: "preview",
          ownerId: args.actor.ownerId,
          clock: () => f.now,
          execution: planner.verify,
        }).prepareAdmission(
          {
            operationId,
            operationRevision: g.expectedRevision + 1,
            requestHash,
            jobId,
            targetKind: "workspace",
            targetId: g.workspaceId,
            targetRevision: g.expectedRevision + 1,
            invocationId,
            maximumAttempts: 3,
            deadlineAt: "2026-10-06T00:04:00.000Z",
            pricingProofId: null,
            fundingProofId: null,
            allocationProofId: null,
          },
          {
            invocationId,
            requestId: jobId,
            phase: "workspace_legal_plan",
            model: MODEL_ID,
            attemptOrdinal: 1,
            correction: false,
            ...(await gatewayWireIdentity(wire)),
            outputTokenUpperBound: wire.max_completion_tokens,
          },
        );
        if (!paid) throw new Error("Missing synthetic paid admission");
        const plan = await prepareReworkJobAdmission(
          f.core,
          g,
          {
            admission: { operationId, key: args.key, requestHash },
            jobId,
            kind: "summary_reconciliation",
            summaryRevision: args.input.summaryRevision,
            authority: source.authority,
            userMessage: { id: args.requestId, text: args.input.explanation },
          },
          paid.paid,
        );
        if (!plan) throw new ReworkError("STALE_REVISION");
        const message: V2UserMessage = {
          schemaVersion: "2",
          id: args.requestId,
          operationId,
          workspaceRevision: g.expectedRevision + 1,
          createdAt: f.now,
          role: "user",
          text: args.input.explanation,
          selectedFileIds: [],
        };
        const publication = {
          jobId,
          message,
          admissionSource: {
            ...source,
            context: {
              ...source.context,
              latestMessage: message,
              messages: [...source.context.messages, message],
              references: {
                ...source.context.references,
                messages: [
                  ...source.context.references.messages,
                  { id: message.id, workspaceRevision: message.workspaceRevision },
                ],
              },
            },
          },
          authority: {
            sql: `(${plan.authority.sql}) AND (${r.plan.authority.sql})`,
            values: [...plan.authority.values, ...r.plan.authority.values],
          },
          statements: (claim: string, id: string) => [
            ...plan.statements(claim),
            ...r.plan.statements(claim, id),
          ],
        };
        return commit(publication);
      });
    },
    lease: async (a, jobId) => acquire(a.ownerId, jobId),
    settleTask: async (args, prepare) => {
      const p = await prepare();
      return p.commit({
        authority: p.authority,
        statements: (claim) => [
          ...completeLeaseStatements(f.core, args.lease, claim, f.now),
          f.core.statement(
            `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND current_job_id=? AND ${sqlClaim}`,
            [args.actor.caseId, args.jobId, claim],
          ),
        ],
      });
    },
    publishConfirmedSummary: async (args, prepare) => {
      const r = await receipt(args, "confirm");
      return replayOrRun(r, async () => {
        const p = await prepare();
        const proposal = p.state.proposal;
        if (!proposal) throw new Error("Missing synthetic proposal");
        const plan = await prepareReconciledSummary(f.core, p.guard, {
          snapshotId: proposal.id,
          beforeRevision: proposal.before.revision,
          summary: proposal.after,
          authority: p.authority,
        });
        if (!plan) throw new ReworkError("STALE_REVISION");
        await beforeConfirm?.();
        return p.commit({
          authority: {
            sql: `(${plan.authority.sql}) AND (${r.plan.authority.sql})`,
            values: [...plan.authority.values, ...r.plan.authority.values],
          },
          statements: (claim, id) => [...plan.statements(claim), ...r.plan.statements(claim, id)],
        });
      });
    },
    cancelTaskAndPublish: async (args, prepare) => {
      const r = await receipt(args, "cancel");
      return replayOrRun(r, async () => {
        const p = await prepare();
        const jobId = p.record.value.state.currentJobId;
        const lease = jobId
          ? (leases.get(jobId) ?? (await acquire(args.actor.ownerId, jobId)))
          : null;
        if (jobId && !lease) throw new ReworkError("STALE_REVISION");
        const saved = await records.write(p.guard, {
          kind: "reconciliation",
          entityId: args.actor.caseId,
          expectedVersion: p.record.revision,
          value: { ...p.record.value, state: p.state },
          schema: summaryReconciliationRecordSchema,
          bumpWorkspace: true,
          ...(lease ? { lease } : {}),
          authority: {
            sql: `(${p.authority.sql}) AND (${r.plan.authority.sql})`,
            values: [...p.authority.values, ...r.plan.authority.values],
          },
          statements: (claim, id) => [
            ...(jobId
              ? [
                  f.core.statement(
                    `UPDATE v2_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,fencing=fencing+1,updated_at=? WHERE id=? AND ${sqlClaim}`,
                    [f.now, jobId, claim],
                  ),
                  ...quotaTransitionStatements(f.core, jobId, claim, "released", undefined, true),
                  f.core.statement(
                    `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND current_job_id=? AND ${sqlClaim}`,
                    [args.actor.caseId, jobId, claim],
                  ),
                ]
              : []),
            ...r.plan.statements(claim, id),
          ],
        });
        if (!saved) throw new ReworkError("STALE_REVISION");
        return saved.value.state;
      });
    },
  };
  return {
    ports,
    records,
    get generateCalls() {
      return generateCalls;
    },
    onGenerate(hook?: () => Promise<void>) {
      beforeGenerate = hook;
    },
    onConfirm(hook?: () => Promise<void>) {
      beforeConfirm = hook;
    },
    rejectAudit() {
      auditPass = false;
    },
  };
}
