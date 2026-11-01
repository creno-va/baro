import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, timestampSchema } from "../../../contracts";
import {
  type V2FailureCode,
  type V2Summary,
  type V2SummaryReconciliation,
  type V2SummaryReconciliationCancel,
  type V2SummaryReconciliationConfirm,
  type V2SummaryReconciliationProposal,
  type V2SummaryReconciliationRequest,
  v2FailureCodeSchema,
  v2SummaryReconciliationCancelSchema,
  v2SummaryReconciliationConfirmSchema,
  v2SummaryReconciliationProposalSchema,
  v2SummaryReconciliationRequestSchema,
  v2SummaryReconciliationSchema,
  v2SummarySchema,
} from "../../../contracts/v2";
import { assertWorkspaceFacts, type WorkspaceContext } from "../workspace/pipeline";

export type SummaryReconciliationActor = { ownerId: string; caseId: string; now: string };
export type SummaryReconciliationRead = {
  summary: V2Summary;
  state: V2SummaryReconciliation;
  context: WorkspaceContext;
};
export type SummaryReconciliationGeneration = {
  request: NonNullable<V2SummaryReconciliation["request"]>;
  before: V2Summary;
  context: WorkspaceContext;
};
export type SummaryReconciliationDependencies = {
  read(actor: SummaryReconciliationActor): Promise<SummaryReconciliationRead>;
  /** Atomic owned/consented admission, immutable base, quota/lease and durable replay receipt. */
  admit(
    actor: SummaryReconciliationActor,
    key: string,
    input: V2SummaryReconciliationRequest,
  ): Promise<V2SummaryReconciliation>;
  /** Acquire one execution lease; null means another execution or a terminal request owns it. */
  claim(
    actor: SummaryReconciliationActor,
    requestId: string,
  ): Promise<SummaryReconciliationRead | null>;
  /** Runtime injects the existing bounded llm-gateway; this module never calls a provider. */
  generate(
    input: SummaryReconciliationGeneration,
  ): Promise<{ after: V2Summary; reasons: string[] }>;
  audit(
    input: SummaryReconciliationGeneration & { after: V2Summary; reasons: string[] },
  ): Promise<{ pass: boolean }>;
  /** CAS on request, base summary, current owner/consent, source revisions and live execution lease. */
  publish(
    actor: SummaryReconciliationActor,
    requestId: string,
    proposal: V2SummaryReconciliationProposal,
  ): Promise<V2SummaryReconciliation>;
  fail(
    actor: SummaryReconciliationActor,
    requestId: string,
    failure: V2FailureCode,
  ): Promise<V2SummaryReconciliation>;
  /** Only this adapter may publish the canonical summary, invalidate analysis and record confirmation. */
  confirm(
    actor: SummaryReconciliationActor,
    key: string,
    input: V2SummaryReconciliationConfirm,
  ): Promise<V2SummaryReconciliation>;
  cancel(
    actor: SummaryReconciliationActor,
    key: string,
    input: V2SummaryReconciliationCancel,
  ): Promise<V2SummaryReconciliation>;
  clock?: () => string;
  newId?: () => string;
};

export class SummaryReconciliationError extends Error {
  constructor(readonly code: "POLICY_REJECTED" | "STALE_REVISION") {
    super(code);
  }
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Corrections retain the original evidence and disputed versions; new statements may clarify them. */
export function assertReconciliationPreserves(before: V2Summary, after: V2Summary) {
  const retained = new Map(after.facts.map((fact) => [fact.id, fact]));
  for (const fact of before.facts) {
    const next = retained.get(fact.id);
    if (
      !next ||
      !fact.references.every((ref) => next.references.some((candidate) => same(candidate, ref))) ||
      !fact.conflictingFactIds.every((id) => next.conflictingFactIds.includes(id)) ||
      (fact.significance === "unfavorable" && next.significance !== "unfavorable") ||
      (fact.certainty === "uncertain" && !["uncertain", "conflicting"].includes(next.certainty)) ||
      (fact.certainty === "conflicting" && next.certainty !== "conflicting")
    )
      throw new SummaryReconciliationError("POLICY_REJECTED");
  }
  if (
    !before.unknowns.every((unknown) => after.unknowns.includes(unknown)) ||
    !before.parties.every((party) => after.parties.some((next) => next.id === party.id))
  )
    throw new SummaryReconciliationError("POLICY_REJECTED");
}

export function createSummaryReconciliationService(deps: SummaryReconciliationDependencies) {
  const actor = (input: { ownerId: string; caseId: string }): SummaryReconciliationActor => ({
    ownerId: opaqueIdSchema.parse(input.ownerId),
    caseId: opaqueIdSchema.parse(input.caseId),
    now: timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
  });
  const result = (state: unknown) => v2SummaryReconciliationSchema.parse(state);
  return {
    async read(input: { ownerId: string; caseId: string }) {
      return deps.read(actor(input));
    },
    async request(input: { ownerId: string; caseId: string }, key: string, raw: unknown) {
      // Admission owns replay before revision checks: retries must not create more jobs/questions.
      return result(
        await deps.admit(
          actor(input),
          idempotencyKeySchema.parse(key),
          v2SummaryReconciliationRequestSchema.parse(raw),
        ),
      );
    },
    async confirm(input: { ownerId: string; caseId: string }, key: string, raw: unknown) {
      return result(
        await deps.confirm(
          actor(input),
          idempotencyKeySchema.parse(key),
          v2SummaryReconciliationConfirmSchema.parse(raw),
        ),
      );
    },
    async cancel(input: { ownerId: string; caseId: string }, key: string, raw: unknown) {
      return result(
        await deps.cancel(
          actor(input),
          idempotencyKeySchema.parse(key),
          v2SummaryReconciliationCancelSchema.parse(raw),
        ),
      );
    },
    async execute(input: { ownerId: string; caseId: string }, rawRequestId: string) {
      const requestId = opaqueIdSchema.parse(rawRequestId);
      const claimed = await deps.claim(actor(input), requestId);
      if (!claimed) return result((await deps.read(actor(input))).state);
      const state = result(claimed.state);
      const request = state.request;
      if (
        state.status !== "running" ||
        !request ||
        request.id !== requestId ||
        request.input.summaryRevision !== claimed.summary.revision ||
        claimed.context.intake.revision !== claimed.summary.intakeRevision
      )
        throw new SummaryReconciliationError("STALE_REVISION");
      const before = v2SummarySchema.parse(claimed.summary);
      const generation = {
        request,
        before: structuredClone(before),
        context: structuredClone(claimed.context),
      };
      try {
        const draft = await deps.generate(structuredClone(generation));
        const proposal = v2SummaryReconciliationProposalSchema.parse({
          id: (deps.newId ?? (() => crypto.randomUUID()))(),
          requestId,
          baseWorkspaceRevision: request.input.expectedRevision,
          baseIntakeRevision: before.intakeRevision,
          baseSummaryRevision: before.revision,
          before,
          after: draft.after,
          reasons: draft.reasons,
          createdAt: actor(input).now,
        });
        assertReconciliationPreserves(before, proposal.after);
        const oldFacts = new Map(before.facts.map((fact) => [fact.id, fact]));
        assertWorkspaceFacts(
          generation.context,
          proposal.after.facts.filter((fact) => !same(fact, oldFacts.get(fact.id))),
        );
        if (
          !(
            await deps.audit({
              ...structuredClone(generation),
              after: structuredClone(proposal.after),
              reasons: [...proposal.reasons],
            })
          ).pass
        )
          throw new SummaryReconciliationError("POLICY_REJECTED");
        // No write of the canonical summary here. A cancelled or changed request cannot publish.
        return result(await deps.publish(actor(input), requestId, proposal));
      } catch (cause) {
        const code = (cause as { code?: string })?.code;
        if (
          ["STALE_REVISION", "NOT_FOUND", "UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(
            code ?? "",
          )
        )
          throw cause;
        const failure =
          cause instanceof z.ZodError
            ? "MODEL_SCHEMA_INVALID"
            : v2FailureCodeSchema.safeParse(code);
        return result(
          await deps.fail(
            actor(input),
            requestId,
            typeof failure === "string"
              ? failure
              : failure.success
                ? failure.data
                : "INTERNAL_ERROR",
          ),
        );
      }
    },
  };
}
