import { describe, expect, test } from "bun:test";
import { emptyReconciliation } from "../src/client/api/mock/mock-reconciliation";
import type { V2Summary, V2SummaryReconciliation } from "../src/contracts/v2";
import {
  createSummaryReconciliationService,
  type SummaryReconciliationDependencies,
} from "../src/server/modules/intake/summary-reconciliation";
import {
  reconfirmationCandidate,
  reconfirmationContext,
  reconfirmationSummary,
  syntheticReconfirmationExplanation,
} from "./helpers/intake-reconfirmation";

function fixture(
  overrides: Partial<SummaryReconciliationDependencies> = {},
  before = reconfirmationSummary(),
) {
  const actor = { ownerId: "synthetic-owner", caseId: "synthetic-case" };
  let canonical = structuredClone(before);
  let state = emptyReconciliation(12);
  let revision = 12;
  let consent = true;
  let deleted = false;
  const calls = { generate: 0, audit: 0, publish: 0, confirm: 0 };
  const receipts = new Map<string, V2SummaryReconciliation>();
  const owned = (who: typeof actor) => {
    if (who.ownerId !== actor.ownerId || who.caseId !== actor.caseId || deleted)
      throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    if (!consent) throw Object.assign(new Error("consent"), { code: "CONSENT_REQUIRED" });
  };
  const snapshot = () => ({
    summary: structuredClone(canonical),
    state: structuredClone(state),
    context: reconfirmationContext(),
  });
  const guard = (expected: number) => {
    if (expected !== revision) throw Object.assign(new Error("stale"), { code: "STALE_REVISION" });
  };
  const deps: SummaryReconciliationDependencies = {
    read: async (a) => {
      owned(a);
      return snapshot();
    },
    admit: async (a, key, input) => {
      owned(a);
      if (receipts.has(key)) return structuredClone(receipts.get(key) as V2SummaryReconciliation);
      guard(input.expectedRevision);
      expect(input.summaryRevision).toBe(canonical.revision);
      state = {
        ...emptyReconciliation(++revision),
        status: "pending",
        request: { id: "synthetic-reconciliation-request", input, createdAt: canonical.createdAt },
        currentJobId: "synthetic-job",
      };
      receipts.set(key, structuredClone(state));
      return structuredClone(state);
    },
    claim: async (a, requestId) => {
      owned(a);
      if (state.status !== "pending" || state.request?.id !== requestId) return null;
      state.status = "running";
      return snapshot();
    },
    generate: async () => {
      calls.generate++;
      return {
        after: reconfirmationCandidate(),
        reasons: ["합성 adapter가 누락 진술을 추가했습니다."],
      };
    },
    audit: async () => {
      calls.audit++;
      return { pass: true };
    },
    publish: async (a, requestId, proposal) => {
      owned(a);
      guard(state.workspaceRevision);
      if (state.status !== "running" || state.request?.id !== requestId)
        throw Object.assign(new Error("stale"), { code: "STALE_REVISION" });
      calls.publish++;
      state = { ...state, status: "proposed", currentJobId: null, proposal };
      return structuredClone(state);
    },
    fail: async (a, requestId, failure) => {
      owned(a);
      if (state.request?.id === requestId && state.status === "running")
        state = { ...state, status: "failed", failure, currentJobId: null };
      return structuredClone(state);
    },
    confirm: async (a, key, input) => {
      owned(a);
      if (receipts.has(key)) return structuredClone(receipts.get(key) as V2SummaryReconciliation);
      guard(input.expectedRevision);
      if (
        state.status !== "proposed" ||
        !state.proposal ||
        state.proposal.id !== input.proposalId ||
        state.proposal.baseSummaryRevision !== input.summaryRevision
      )
        throw Object.assign(new Error("stale"), { code: "STALE_REVISION" });
      calls.confirm++;
      canonical = structuredClone(state.proposal.after);
      state = {
        ...state,
        status: "confirmed",
        workspaceRevision: ++revision,
        confirmedSummaryRevision: canonical.revision,
        confirmedWorkspaceRevision: revision,
      };
      receipts.set(key, structuredClone(state));
      return structuredClone(state);
    },
    cancel: async (a, key, input) => {
      owned(a);
      if (receipts.has(key)) return structuredClone(receipts.get(key) as V2SummaryReconciliation);
      guard(input.expectedRevision);
      if (state.request?.id !== input.requestId)
        throw Object.assign(new Error("stale"), { code: "STALE_REVISION" });
      state = { ...state, status: "cancelled", workspaceRevision: ++revision, currentJobId: null };
      receipts.set(key, structuredClone(state));
      return structuredClone(state);
    },
    clock: () => "2026-11-01T01:00:00.000Z",
    ...overrides,
  };
  const service = createSummaryReconciliationService(deps);
  const request = (key = crypto.randomUUID()) =>
    service.request(actor, key, {
      expectedRevision: revision,
      summaryRevision: canonical.revision,
      kind: "addition",
      explanation: syntheticReconfirmationExplanation,
    });
  return {
    actor,
    service,
    deps,
    request,
    calls,
    canonical: () => structuredClone(canonical),
    state: () => structuredClone(state),
    peer: () => {
      revision++;
    },
    revoke: () => {
      consent = false;
    },
    remove: () => {
      deleted = true;
    },
  };
}

describe("synthetic summary reconciliation service", () => {
  test("admission and proposal never replace the canonical summary; confirmation uses an exact receipt", async () => {
    const f = fixture();
    const before = f.canonical();
    const pending = await f.request();
    expect(pending.status).toBe("pending");
    expect(f.calls.generate).toBe(0);
    expect(f.canonical()).toEqual(before);
    const proposed = await f.service.execute(f.actor, pending.request?.id ?? "");
    expect(proposed.status).toBe("proposed");
    expect(f.canonical()).toEqual(before);
    const key = crypto.randomUUID();
    const input = {
      expectedRevision: proposed.workspaceRevision,
      summaryRevision: before.revision,
      proposalId: proposed.proposal?.id,
    };
    const confirmed = await f.service.confirm(f.actor, key, input);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedSummaryRevision).toBe(4);
    expect(f.canonical().facts.slice(0, 3)).toEqual(before.facts);
    expect(f.canonical().unknowns).toContain(before.unknowns[0] ?? "");
    expect(await f.service.confirm(f.actor, key, input)).toEqual(confirmed);
    expect(f.calls.confirm).toBe(1);
  });
  test("duplicate admission and execution do not generate extra questions or responses", async () => {
    const f = fixture();
    const key = crypto.randomUUID();
    const first = await f.request(key);
    expect(await f.service.request(f.actor, key, first.request?.input)).toEqual(first);
    await Promise.all([
      f.service.execute(f.actor, first.request?.id ?? ""),
      f.service.execute(f.actor, first.request?.id ?? ""),
    ]);
    expect(f.calls).toEqual({ generate: 1, audit: 1, publish: 1, confirm: 0 });
    expect(reconfirmationContext().intake.batches).toHaveLength(1);
  });
  for (const [name, alter] of [
    [
      "removes an adverse fact",
      (after: V2Summary) => {
        after.facts = after.facts.filter((f) => f.id !== "synthetic-adverse");
      },
    ],
    [
      "drops original provenance",
      (after: V2Summary) => {
        const f = after.facts[0];
        if (f)
          f.references = [
            {
              kind: "user_message",
              messageId: "synthetic-reconciliation-request",
              workspaceRevision: 12,
            },
          ];
      },
    ],
    [
      "reclassifies the original user's statement as AI inference",
      (after: V2Summary) => {
        const fact = after.facts[0];
        if (fact) fact.attribution = "ai_organization";
      },
    ],
    [
      "marks an unchanged saved fact as manually edited",
      (after: V2Summary) => {
        const fact = after.facts[0];
        if (fact) fact.userEdited = true;
      },
    ],
    [
      "claims the new proposed fact was manually edited",
      (after: V2Summary) => {
        const fact = after.facts.at(-1);
        if (fact) fact.userEdited = true;
      },
    ],
    [
      "hides an unresolved unknown",
      (after: V2Summary) => {
        after.unknowns = [];
      },
    ],
    [
      "promotes an unfavorable fact",
      (after: V2Summary) => {
        const f = after.facts[2];
        if (f) f.significance = "favorable";
      },
    ],
    [
      "invents an authorized-looking source",
      (after: V2Summary) => {
        const f = after.facts.at(-1);
        if (f)
          f.references = [
            { kind: "user_message", messageId: "foreign-message", workspaceRevision: 12 },
          ];
      },
    ],
    [
      "paraphrases a quoted statement",
      (after: V2Summary) => {
        const f = after.facts.at(-1);
        if (f) f.text = "일부 변제를 확실하게 증명했습니다.";
      },
    ],
  ] as const) {
    test(`rejects a draft that ${name}`, async () => {
      const after = reconfirmationCandidate();
      alter(after);
      const f = fixture({ generate: async () => ({ after, reasons: ["합성 거절 검사"] }) });
      const pending = await f.request();
      const result = await f.service.execute(f.actor, pending.request?.id ?? "");
      expect(result.status).toBe("failed");
      expect(result.failure).toBe("POLICY_REJECTED");
      expect(f.calls.publish).toBe(0);
      expect(f.canonical()).toEqual(reconfirmationSummary());
    });
  }
  for (const retainsMarker of [true, false]) {
    test(`${retainsMarker ? "retains" : "rejects erasing"} a prior manual-edit marker without rewriting canonical facts`, async () => {
      const before = reconfirmationSummary();
      const original = before.facts[0];
      if (!original) throw new Error("Missing synthetic original fact");
      original.userEdited = true;
      const after = reconfirmationCandidate();
      const next = after.facts[0];
      if (!next) throw new Error("Missing synthetic proposed fact");
      next.userEdited = retainsMarker;
      const f = fixture(
        { generate: async () => ({ after, reasons: ["수동 수정 이력 보존 검사"] }) },
        before,
      );
      const pending = await f.request();
      const result = await f.service.execute(f.actor, pending.request?.id ?? "");
      expect(result.status).toBe(retainsMarker ? "proposed" : "failed");
      expect(f.calls.publish).toBe(retainsMarker ? 1 : 0);
      if (retainsMarker) expect(result.proposal?.after.facts[0]?.userEdited).toBe(true);
      else expect(result.failure).toBe("POLICY_REJECTED");
      expect(f.canonical()).toEqual(before);
    });
  }
  for (const [coverage, certainty] of [
    [{ observationCertainty: "uncertain", userEdited: false }, "observed"],
    [{ observationCertainty: "uncertain", userEdited: false }, "reported"],
    [{ observationCertainty: "observed", userEdited: true }, "observed"],
    [{ observationCertainty: "observed", userEdited: true }, "reported"],
    [{ observationCertainty: "uncertain", userEdited: false }, "uncertain"],
  ] as const) {
    test(`material ${JSON.stringify(coverage)} stays uncertain instead of becoming ${certainty}`, async () => {
      const after = reconfirmationCandidate();
      const material = after.facts[1];
      if (!material) throw new Error("Missing synthetic material fact");
      after.facts.push({
        ...material,
        id: "synthetic-new-material",
        certainty,
        conflictingFactIds: [],
      });
      const f = fixture({
        generate: async () => ({ after, reasons: ["자료 관찰의 불확실성 보존 검사"] }),
      });
      const originalClaim = f.deps.claim;
      f.deps.claim = async (...args) => {
        const claimed = await originalClaim(...args);
        if (claimed?.context.materials[0]) claimed.context.materials[0].coverage = coverage;
        return claimed;
      };
      const pending = await f.request();
      const result = await f.service.execute(f.actor, pending.request?.id ?? "");
      expect(result.status).toBe(certainty === "uncertain" ? "proposed" : "failed");
      expect(f.calls.publish).toBe(certainty === "uncertain" ? 1 : 0);
      expect(f.canonical()).toEqual(reconfirmationSummary());
    });
  }
  test("a false independent audit cannot publish even a structurally valid draft", async () => {
    const f = fixture({ audit: async () => ({ pass: false }) });
    const pending = await f.request();
    const result = await f.service.execute(f.actor, pending.request?.id ?? "");
    expect(result.failure).toBe("POLICY_REJECTED");
    expect(f.calls.publish).toBe(0);
    expect(f.canonical()).toEqual(reconfirmationSummary());
  });
  test("a third question batch cannot be smuggled into the reconciliation response", async () => {
    const f = fixture({
      generate: async () => ({
        after: { ...reconfirmationCandidate(), questions: [{ prompt: "추가 질문" }] },
        reasons: ["합성 스키마 거절"],
      }),
    });
    const pending = await f.request();
    expect((await f.service.execute(f.actor, pending.request?.id ?? "")).failure).toBe(
      "MODEL_SCHEMA_INVALID",
    );
    expect(f.calls.publish).toBe(0);
  });
  test("cancellation rejects a late generation result and keeps the original summary", async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = fixture({
      generate: async () => {
        started?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { after: reconfirmationCandidate(), reasons: ["합성 지연"] };
      },
    });
    const pending = await f.request();
    const execution = f.service.execute(f.actor, pending.request?.id ?? "");
    await entered;
    await f.service.cancel(f.actor, crypto.randomUUID(), {
      expectedRevision: pending.workspaceRevision,
      requestId: pending.request?.id,
    });
    release?.();
    await expect(execution).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.state().status).toBe("cancelled");
    expect(f.canonical()).toEqual(reconfirmationSummary());
  });
  for (const mode of ["peer", "revoke", "remove"] as const)
    test(`publication checks ${mode} after generation`, async () => {
      let f: ReturnType<typeof fixture>;
      f = fixture({
        audit: async () => {
          f[mode]();
          return { pass: true };
        },
      });
      const pending = await f.request();
      await expect(f.service.execute(f.actor, pending.request?.id ?? "")).rejects.toMatchObject({
        code:
          mode === "peer" ? "STALE_REVISION" : mode === "revoke" ? "CONSENT_REQUIRED" : "NOT_FOUND",
      });
      expect(f.calls.publish).toBe(0);
      expect(f.canonical()).toEqual(reconfirmationSummary());
    });
});
