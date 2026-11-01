import { describe, expect, test } from "bun:test";
import { createReconciliationMock } from "../src/client/api/mock/mock-reconciliation";
import type { WorkspaceMockState } from "../src/client/api/mock/workspace";
import { v2SummaryReconciliationSchema } from "../src/contracts/v2";
import { reconfirmationCase } from "./helpers/intake-reconfirmation";

function fixture() {
  const item = reconfirmationCase();
  let aggregate: WorkspaceMockState = {
    session: {
      user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
      needsConsent: false,
    },
    cases: { [item.id]: item },
    caseOwners: { [item.id]: "synthetic-owner" },
    files: {},
    workspace: {},
  };
  let invalidations = 0;
  const runtime = {
    read: () => structuredClone(aggregate),
    update: <T>(mutate: (state: WorkspaceMockState) => T): T => {
      const next = structuredClone(aggregate);
      const value = mutate(next);
      aggregate = next;
      return value;
    },
  };
  const handler = () =>
    createReconciliationMock(runtime, {
      invalidate: () => {
        invalidations++;
      },
    });
  async function request(action?: string, body?: unknown, key = crypto.randomUUID()) {
    const response = await handler()(
      new Request(
        `http://localhost/api/v2/cases/${item.id}/rework/summary-reconciliation${action ? `/${action}` : ""}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
    if (!response) throw new Error("Missing synthetic route");
    return { response, data: await response.json() };
  }
  const create = () =>
    request("request", {
      expectedRevision: item.revision,
      summaryRevision: 3,
      kind: "addition",
      explanation: "추가로 일부 반환받은 일이 있어요. 정확한 금액은 몰라요.",
    });
  return { item, request, create, state: () => aggregate, invalidations: () => invalidations };
}
describe("local synthetic reconciliation HTTP adapter", () => {
  test("persists proposals across a new handler, preserves the canonical snapshot and cancels without invalidation", async () => {
    const f = fixture();
    const before = structuredClone(f.item.summaryDetails);
    const { data } = await f.create();
    const state = v2SummaryReconciliationSchema.parse(data);
    expect(state.status).toBe("proposed");
    expect(f.state().cases[f.item.id]?.summaryDetails).toEqual(before);
    expect((await f.request()).data).toEqual(data);
    const result = await f.request("cancel", {
      expectedRevision: 13,
      requestId: state.request?.id,
    });
    expect(result.response.status).toBe(200);
    expect(f.state().cases[f.item.id]?.summaryDetails).toEqual(before);
    expect(f.invalidations()).toBe(0);
  });
  test("publishes once only after an explicit exact confirmation; an identical key replays", async () => {
    const f = fixture();
    const state = v2SummaryReconciliationSchema.parse((await f.create()).data);
    const key = crypto.randomUUID();
    const input = {
      expectedRevision: state.workspaceRevision,
      proposalId: state.proposal?.id,
      summaryRevision: 3,
    };
    const first = await f.request("confirm", input, key);
    const second = await f.request("confirm", input, key);
    expect(first.response.status).toBe(200);
    expect(second.data).toEqual(first.data);
    expect(f.invalidations()).toBe(1);
    expect(f.state().cases[f.item.id]?.summaryDetails?.revision).toBe(4);
    expect(f.state().cases[f.item.id]?.summaryDetails?.facts.slice(0, 3)).toEqual(
      f.item.summaryDetails?.facts,
    );
  });
  test("confirms the same canonical facts even when nested object keys have a different order", async () => {
    const f = fixture();
    const state = v2SummaryReconciliationSchema.parse((await f.create()).data);
    const item = f.state().cases[f.item.id];
    if (!item?.summaryDetails) throw new Error("Missing synthetic summary");
    const before = structuredClone(item.summaryDetails);
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, value]) => [key, reorder(value)]),
        );
      return value;
    };
    item.summaryDetails = reorder(before) as typeof before;
    expect(item.summaryDetails).toEqual(before);
    expect(JSON.stringify(item.summaryDetails)).not.toBe(JSON.stringify(before));
    expect(
      (
        await f.request("confirm", {
          expectedRevision: state.workspaceRevision,
          proposalId: state.proposal?.id,
          summaryRevision: 3,
        })
      ).response.status,
    ).toBe(200);
    expect(f.invalidations()).toBe(1);
    expect(f.state().cases[f.item.id]?.summaryDetails?.facts.slice(0, before.facts.length)).toEqual(
      before.facts,
    );
  });
  for (const difference of ["fact-text", "reference", "summary-revision", "fact-order"]) {
    test(`rejects a different canonical ${difference} despite an unchanged workspace revision`, async () => {
      const f = fixture();
      const state = v2SummaryReconciliationSchema.parse((await f.create()).data);
      const summary = f.state().cases[f.item.id]?.summaryDetails;
      if (!summary) throw new Error("Missing synthetic summary");
      const first = summary.facts[0];
      if (!first) throw new Error("Missing synthetic fact");
      if (difference === "fact-text") first.text = "원래 사실과 다른 합성 진술입니다.";
      if (difference === "reference")
        first.references = [{ kind: "intake_narrative", intakeRevision: 8 }];
      if (difference === "summary-revision") summary.revision++;
      if (difference === "fact-order") summary.facts.reverse();
      const changed = structuredClone(summary);
      expect(
        (
          await f.request("confirm", {
            expectedRevision: state.workspaceRevision,
            proposalId: state.proposal?.id,
            summaryRevision: 3,
          })
        ).response.status,
      ).toBe(409);
      expect(f.state().cases[f.item.id]?.summaryDetails).toEqual(changed);
      expect(f.invalidations()).toBe(0);
    });
  }
  test("a peer's revision prevents confirmation and projects a stale proposal", async () => {
    const f = fixture();
    const state = v2SummaryReconciliationSchema.parse((await f.create()).data);
    const item = f.state().cases[f.item.id];
    if (item) item.revision++;
    const latest = v2SummaryReconciliationSchema.parse((await f.request()).data);
    expect(latest.status).toBe("stale");
    expect(
      (
        await f.request("confirm", {
          expectedRevision: 14,
          proposalId: state.proposal?.id,
          summaryRevision: 3,
        })
      ).response.status,
    ).toBe(409);
    expect(f.state().cases[f.item.id]?.summaryDetails?.revision).toBe(3);
    expect(f.invalidations()).toBe(0);
  });
  for (const mode of ["owner", "consent", "deleted"] as const)
    test(`rejects ${mode} changes before applying a proposal`, async () => {
      const f = fixture();
      const state = v2SummaryReconciliationSchema.parse((await f.create()).data);
      if (mode === "owner")
        f.state().session.user = {
          id: "foreign-owner",
          name: "합성 다른 계정",
          accountType: "customer",
        };
      else if (mode === "consent") f.state().session.needsConsent = true;
      else f.state().deletedCaseIds = [f.item.id];
      expect(
        (
          await f.request("confirm", {
            expectedRevision: 13,
            proposalId: state.proposal?.id,
            summaryRevision: 3,
          })
        ).response.status,
      ).toBe(mode === "consent" ? 403 : 404);
      expect(f.state().cases[f.item.id]?.summaryDetails?.revision).toBe(3);
    });
  test("raw canonical edits cannot be submitted as a reconciliation explanation", async () => {
    const f = fixture();
    expect(
      (
        await f.request("request", {
          expectedRevision: 12,
          summaryRevision: 3,
          kind: "correction",
          explanation: "합성 설명",
          overview: "직접 덮어쓰기",
        })
      ).response.status,
    ).toBe(400);
    expect(f.state().cases[f.item.id]?.revision).toBe(12);
  });
});
