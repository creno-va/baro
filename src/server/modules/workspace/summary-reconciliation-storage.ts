import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import {
  type V2FailureCode,
  type V2Summary,
  type V2SummaryReconciliation,
  type V2SummaryReconciliationCancel,
  type V2SummaryReconciliationConfirm,
  type V2SummaryReconciliationProposal,
  type V2SummaryReconciliationRequest,
  type V2UserMessage,
  v2HashSchema,
  v2ReworkVersionSchema,
  v2SummaryReconciliationProposalSchema,
  v2SummaryReconciliationSchema,
  v2SummarySchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";
import { guardSchema, type V2Core, type WorkspaceGuard } from "../../db/v2-core";
import {
  createV2ReworkRepository,
  type ReworkRecord,
  type ReworkWriteGuard,
} from "../../db/v2-rework";
import type { JobLease } from "../../db/v2-workspace";
import type {
  SummaryReconciliationActor,
  SummaryReconciliationDependencies,
} from "../intake/summary-reconciliation";
import { ReworkError } from "../rework/case-context";
import type { WorkspaceContext } from "./pipeline";

/** Private encrypted record. The public DTO never contains the issued message or source proof. */
export const summaryReconciliationRecordSchema = z
  .strictObject({
    format: z.literal("summary-reconciliation-v1"),
    state: v2SummaryReconciliationSchema,
    baseSummary: v2SummarySchema.nullable(),
    baseSummaryId: opaqueIdSchema,
    sourceDigest: v2HashSchema,
    requestMessage: v2UserMessageSchema,
  })
  .refine((r) => {
    const request = r.state.request;
    const before = r.baseSummary ?? r.state.proposal?.before;
    return (
      r.state.status !== "idle" &&
      r.state.status !== "stale" &&
      request !== null &&
      before !== undefined &&
      before !== null &&
      before.revision === request.input.summaryRevision &&
      r.requestMessage.id === request.id &&
      r.requestMessage.text === request.input.explanation &&
      r.requestMessage.workspaceRevision === request.input.expectedRevision + 1 &&
      r.requestMessage.selectedFileIds.length === 0 &&
      (!["pending", "running", "failed"].includes(r.state.status) ||
        (r.state.proposal === null && r.baseSummary !== null)) &&
      (r.state.proposal === null ||
        (r.state.proposal.baseWorkspaceRevision === request.input.expectedRevision &&
          JSON.stringify(before) === JSON.stringify(r.state.proposal.before))) &&
      (!["proposed", "confirmed"].includes(r.state.status) || r.baseSummary === null)
    );
  }, "Reconciliation must retain its exact issued explanation and immutable base");
export type StoredSummaryReconciliation = z.infer<typeof summaryReconciliationRecordSchema>;

export type ReconciliationAuthority = {
  workspaceRevision: number;
  summaryId: string;
  summarySnapshotId: string;
  summary: V2Summary;
  context: WorkspaceContext;
  /** Semantic source/context digest, excluding canonical summary and this request's metadata. */
  sourceDigest: string;
  /** SQL predicates for the exact current summary, sources and account policy. */
  authority: ReworkWriteGuard;
};
export type ReconciliationWritePlan = {
  /** Time-sensitive proof values are resolved by the repository's final publication clock. */
  authority: ReworkWriteGuard | ((now: string) => ReworkWriteGuard);
  statements: (claimId: string, recordId: string, revision: number) => D1PreparedStatement[];
};
export type ReconciliationStoredRecord = ReworkRecord<StoredSummaryReconciliation>;
export type ReconciliationPublication = {
  guard: WorkspaceGuard;
  authority: ReworkWriteGuard;
  record: ReconciliationStoredRecord;
  state: V2SummaryReconciliation;
  /** Same final publication claim as the root's job/receipt or canonical-summary statements. */
  commit(plan: ReconciliationWritePlan): Promise<V2SummaryReconciliation>;
};
export type ReconciliationMutation<T> = {
  actor: SummaryReconciliationActor;
  key: string;
  input: T;
};
export type SummaryReconciliationStoragePorts = {
  authorize(
    actor: SummaryReconciliationActor,
    options: { write: boolean; requestMessage?: V2UserMessage },
  ): Promise<ReconciliationAuthority>;
  /** Root checks a durable receipt before invoking commit, reserves AI200 and admits one job. */
  admitTask(
    args: ReconciliationMutation<V2SummaryReconciliationRequest> & { requestId: string },
    commit: (
      plan: ReconciliationWritePlan & { jobId: string; message: V2UserMessage },
    ) => Promise<V2SummaryReconciliation>,
  ): Promise<V2SummaryReconciliation>;
  lease(
    actor: SummaryReconciliationActor,
    jobId: string,
    requestId: string,
  ): Promise<JobLease | null>;
  /** Root settles the exact operation/hold/quota and lease in the same publication claim. */
  settleTask(
    args: {
      actor: SummaryReconciliationActor;
      requestId: string;
      jobId: string;
      lease: JobLease;
      status: "proposed" | "failed";
      failure?: V2FailureCode;
    },
    prepare: () => Promise<ReconciliationPublication>,
  ): Promise<V2SummaryReconciliation>;
  /** Replay first, then prepareReconciledSummary and commit its canonical statements together. */
  publishConfirmedSummary(
    args: ReconciliationMutation<V2SummaryReconciliationConfirm>,
    prepare: () => Promise<ReconciliationPublication>,
  ): Promise<V2SummaryReconciliation>;
  /** Root alone atomically fences/releases a queued or running job and stores the cancel receipt. */
  cancelTaskAndPublish(
    args: ReconciliationMutation<V2SummaryReconciliationCancel>,
    prepare: () => Promise<Omit<ReconciliationPublication, "commit">>,
  ): Promise<V2SummaryReconciliation>;
  generate: SummaryReconciliationDependencies["generate"];
  audit: SummaryReconciliationDependencies["audit"];
  clock?: () => string;
  newId?: () => string;
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const together = (
  left: ReworkWriteGuard,
  right: ReconciliationWritePlan["authority"],
): ReconciliationWritePlan["authority"] => {
  const combine = (proof: ReworkWriteGuard): ReworkWriteGuard => ({
    sql: `(${left.sql}) AND (${proof.sql})`,
    values: [...left.values, ...proof.values],
  });
  return typeof right === "function" ? (now) => combine(right(now)) : combine(right);
};
const idle = (workspaceRevision: number): V2SummaryReconciliation => ({
  contractVersion: v2ReworkVersionSchema.value,
  workspaceRevision,
  status: "idle",
  request: null,
  proposal: null,
  currentJobId: null,
  failure: null,
  confirmedSummaryRevision: null,
  confirmedWorkspaceRevision: null,
});
const stale = (): never => {
  throw new ReworkError("STALE_REVISION");
};

/** Durable encrypted lifecycle; root retains all admission, payment and job/canonical SQL. */
export function createSummaryReconciliationStorage(
  core: V2Core,
  ports: SummaryReconciliationStoragePorts,
): SummaryReconciliationDependencies {
  const records = createV2ReworkRepository(core, ports.clock ? { clock: ports.clock } : {});
  const leases = new Map<string, JobLease>();
  const g = (actor: SummaryReconciliationActor, source: ReconciliationAuthority) =>
    guardSchema.parse({
      ownerId: actor.ownerId,
      workspaceId: actor.caseId,
      expectedRevision: source.workspaceRevision,
      now: (ports.clock ?? (() => new Date().toISOString()))(),
    });
  async function load(actor: SummaryReconciliationActor, write: boolean) {
    // read() may return null after a decrypt race. Check opaque heads on both sides;
    // a replaced record must never be mistaken for a new, idle reconciliation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = await records.head(actor, actor.caseId, "reconciliation", actor.caseId);
      const record = await records.read(
        actor,
        actor.caseId,
        "reconciliation",
        actor.caseId,
        summaryReconciliationRecordSchema,
      );
      const source = await ports.authorize(actor, {
        write,
        ...(record ? { requestMessage: record.value.requestMessage } : {}),
      });
      const end = await records.head(actor, actor.caseId, "reconciliation", actor.caseId);
      if (!same(start, end) || (record?.id ?? null) !== (end?.id ?? null)) continue;
      v2HashSchema.parse(source.sourceDigest);
      opaqueIdSchema.parse(source.summaryId);
      opaqueIdSchema.parse(source.summarySnapshotId);
      const summary = v2SummarySchema.parse(source.summary);
      if (
        source.context.intake.revision !== summary.intakeRevision ||
        !same(source.context.intake.summary, summary) ||
        (record && record.workspaceRevision > source.workspaceRevision)
      )
        stale();
      let state = record ? structuredClone(record.value.state) : idle(source.workspaceRevision);
      if (record) {
        const value = record.value;
        const before = value.baseSummary ?? value.state.proposal?.before;
        const current =
          value.state.status === "confirmed"
            ? source.summarySnapshotId === value.state.proposal?.id &&
              same(summary, value.state.proposal.after)
            : source.summaryId === value.baseSummaryId && same(summary, before);
        // Retiring an obsolete request is final even when the case keeps changing.
        // Its prior proposal/confirmation remains in immutable history.
        if (
          value.state.status !== "cancelled" &&
          (!current || value.sourceDigest !== source.sourceDigest)
        ) {
          state = {
            ...state,
            status: "stale",
            currentJobId: null,
            failure: null,
            confirmedSummaryRevision: null,
            confirmedWorkspaceRevision: null,
          };
        }
      }
      state.workspaceRevision = source.workspaceRevision;
      return { source, record, state: v2SummaryReconciliationSchema.parse(state) };
    }
    return stale();
  }
  const issuedSource = (source: ReconciliationAuthority, value: StoredSummaryReconciliation) => {
    const issued = value.requestMessage;
    // Existing model contexts redact event-like timestamps. Authorization binds
    // the issued statement, while its original timestamp stays in the encrypted record.
    const identity = (message: V2UserMessage) => {
      const { createdAt: _createdAt, ...statement } = v2UserMessageSchema.parse(message);
      return statement;
    };
    const message = [source.context.latestMessage, ...source.context.messages].find(
      (m) => m?.id === issued.id,
    );
    if (
      !message ||
      !same(identity(message), identity(issued)) ||
      !source.context.references.messages.some(
        (ref) => ref.id === issued.id && ref.workspaceRevision === issued.workspaceRevision,
      )
    )
      stale();
  };
  const currentRecord = (
    loaded: Awaited<ReturnType<typeof load>>,
    requestId: string,
    statuses: V2SummaryReconciliation["status"][],
  ) => {
    if (
      !loaded.record ||
      loaded.state.request?.id !== requestId ||
      !statuses.includes(loaded.state.status)
    )
      return stale();
    return loaded.record;
  };
  async function write(
    actor: SummaryReconciliationActor,
    source: ReconciliationAuthority,
    previous: ReconciliationStoredRecord | null,
    value: StoredSummaryReconciliation,
    plan: ReconciliationWritePlan,
    options: { lease?: JobLease; bumpWorkspace?: boolean } = {},
  ) {
    const saved = await records.write(g(actor, source), {
      kind: "reconciliation",
      entityId: actor.caseId,
      expectedVersion: previous?.revision ?? 0,
      value,
      schema: summaryReconciliationRecordSchema,
      authority: together(source.authority, plan.authority),
      statements: plan.statements,
      bumpWorkspace: options.bumpWorkspace ?? true,
      ...(options.lease ? { lease: options.lease } : {}),
    });
    if (!saved) return stale();
    return saved.value.state;
  }
  const publication = (
    actor: SummaryReconciliationActor,
    loaded: Awaited<ReturnType<typeof load>>,
    record: ReconciliationStoredRecord,
    state: V2SummaryReconciliation,
    lease?: JobLease,
  ): ReconciliationPublication => ({
    guard: g(actor, loaded.source),
    authority: loaded.source.authority,
    record,
    state,
    commit: (plan) =>
      write(
        actor,
        loaded.source,
        record,
        { ...record.value, state, ...(state.proposal ? { baseSummary: null } : {}) },
        plan,
        lease ? { lease } : {},
      ),
  });
  async function settle(
    actor: SummaryReconciliationActor,
    requestId: string,
    proposal: V2SummaryReconciliationProposal | null,
    failure: V2FailureCode | null,
  ) {
    const lease = leases.get(requestId);
    if (!lease) return stale();
    try {
      const result = await ports.settleTask(
        {
          actor,
          requestId,
          jobId: lease.jobId,
          lease,
          status: proposal ? "proposed" : "failed",
          ...(failure ? { failure } : {}),
        },
        async () => {
          const loaded = await load(actor, true);
          const record = currentRecord(loaded, requestId, ["running"]);
          if (loaded.state.currentJobId !== lease.jobId) stale();
          issuedSource(loaded.source, record.value);
          if (proposal) {
            const parsed = v2SummaryReconciliationProposalSchema.parse(proposal);
            if (
              parsed.requestId !== requestId ||
              parsed.baseWorkspaceRevision !== record.value.state.request?.input.expectedRevision ||
              !same(parsed.before, record.value.baseSummary)
            )
              stale();
          }
          const state = v2SummaryReconciliationSchema.parse({
            ...loaded.state,
            workspaceRevision: loaded.source.workspaceRevision + 1,
            status: proposal ? "proposed" : "failed",
            currentJobId: null,
            proposal,
            failure,
          });
          return publication(actor, loaded, record, state, lease);
        },
      );
      leases.delete(requestId);
      return result;
    } catch (cause) {
      // A failed proposal write may still be settled as a failure under this
      // lease. Authority loss instead belongs to the root's stale-job cleanup.
      const code = (cause as { code?: string })?.code;
      if (!proposal || ["STALE_REVISION", "NOT_FOUND", "CONSENT_REQUIRED"].includes(code ?? ""))
        leases.delete(requestId);
      throw cause;
    }
  }
  return {
    ...(ports.clock ? { clock: ports.clock } : {}),
    ...(ports.newId ? { newId: ports.newId } : {}),
    generate: ports.generate,
    audit: ports.audit,
    async read(actor) {
      const loaded = await load(actor, false);
      return {
        summary: loaded.source.summary,
        context: loaded.source.context,
        state: loaded.state,
      };
    },
    async admit(actor, key, input) {
      const requestId = opaqueIdSchema.parse((ports.newId ?? (() => crypto.randomUUID()))());
      return ports.admitTask({ actor, key, input, requestId }, async (plan) => {
        const loaded = await load(actor, true);
        if (
          loaded.source.workspaceRevision !== input.expectedRevision ||
          loaded.source.summary.revision !== input.summaryRevision ||
          ["pending", "running", "proposed"].includes(loaded.state.status)
        )
          stale();
        const message = v2UserMessageSchema.parse(plan.message);
        const state = v2SummaryReconciliationSchema.parse({
          ...idle(input.expectedRevision + 1),
          status: "pending",
          request: { id: requestId, input, createdAt: message.createdAt },
          currentJobId: plan.jobId,
        });
        return write(
          actor,
          loaded.source,
          loaded.record,
          summaryReconciliationRecordSchema.parse({
            format: "summary-reconciliation-v1",
            state,
            baseSummary: loaded.source.summary,
            baseSummaryId: loaded.source.summaryId,
            sourceDigest: loaded.source.sourceDigest,
            requestMessage: message,
          }),
          plan,
        );
      });
    },
    async claim(actor, requestId) {
      const initial = await load(actor, true);
      if (
        initial.state.request?.id !== requestId ||
        !["pending", "running"].includes(initial.state.status) ||
        !initial.state.currentJobId
      )
        return null;
      const jobId = initial.state.currentJobId;
      const lease = await ports.lease(actor, jobId, requestId);
      if (!lease) return null;
      if (lease.jobId !== jobId) stale();
      const loaded = await load(actor, true);
      const record = currentRecord(loaded, requestId, ["pending", "running"]);
      if (loaded.state.currentJobId !== jobId) stale();
      issuedSource(loaded.source, record.value);
      const state = v2SummaryReconciliationSchema.parse({ ...loaded.state, status: "running" });
      const running = await write(
        actor,
        loaded.source,
        record,
        { ...record.value, state },
        { authority: loaded.source.authority, statements: () => [] },
        { lease, bumpWorkspace: false },
      );
      leases.set(requestId, lease);
      const before = record.value.baseSummary;
      if (!before) return stale();
      return { summary: before, state: running, context: loaded.source.context };
    },
    publish: (actor, requestId, proposal) => settle(actor, requestId, proposal, null),
    fail: (actor, requestId, failure) => settle(actor, requestId, null, failure),
    confirm: (actor, key, input) =>
      ports.publishConfirmedSummary({ actor, key, input }, async () => {
        const loaded = await load(actor, true);
        const requestId = loaded.state.request?.id;
        if (!requestId) return stale();
        const record = currentRecord(loaded, requestId, ["proposed"]);
        issuedSource(loaded.source, record.value);
        const proposal = loaded.state.proposal;
        if (!proposal) return stale();
        if (
          loaded.source.workspaceRevision !== input.expectedRevision ||
          proposal.id !== input.proposalId ||
          loaded.source.summary.revision !== input.summaryRevision
        )
          stale();
        const state = v2SummaryReconciliationSchema.parse({
          ...loaded.state,
          status: "confirmed",
          workspaceRevision: input.expectedRevision + 1,
          confirmedWorkspaceRevision: input.expectedRevision + 1,
          confirmedSummaryRevision: proposal.after.revision,
        });
        return publication(actor, loaded, record, state);
      }),
    cancel: (actor, key, input) =>
      ports.cancelTaskAndPublish({ actor, key, input }, async () => {
        const loaded = await load(actor, true);
        const record = currentRecord(loaded, input.requestId, [
          "pending",
          "running",
          "proposed",
          "failed",
          "stale",
        ]);
        if (loaded.source.workspaceRevision !== input.expectedRevision) stale();
        const { commit: _commit, ...prepared } = publication(actor, loaded, record, {
          ...loaded.state,
          status: "cancelled",
          workspaceRevision: input.expectedRevision + 1,
          currentJobId: null,
          failure: null,
        });
        return prepared;
      }),
  };
}
