import { expect, test } from "bun:test";
import {
  ApiError,
  createReworkClient,
  type OperationRequest,
  type OperationRequestOptions,
} from "@baro/api-client";
import { createSessionScope, type SessionView } from "@baro/client-core";
import {
  v2ConversationProgressSchema,
  v2ConversationStateSchema,
  v2ReworkVersionSchema,
} from "../src/contracts/v2";
import { workspace } from "./fixtures/contracts/v2";

const owner = "synthetic_owner";
const context = {
  casePurpose: "unconfirmed",
  subjectContext: "individual",
  procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
};
const contextView = { contractVersion: v2ReworkVersionSchema.value, workspaceRevision: 1, context };
function fixture(request: OperationRequest) {
  let current: SessionView = {
    user: { id: owner, name: "합성 사용자", accountType: "customer" },
    needsConsent: false,
  };
  let challenge = 0;
  const scope = createSessionScope();
  const records = new Map<string, string>();
  const create = () =>
    createReworkClient({
      request,
      scope,
      session: async () => current,
      newKey: () => crypto.randomUUID(),
      challenge: async () => `synthetic-${++challenge}`,
      fingerprint: async (s) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
          (b) => b.toString(16).padStart(2, "0"),
        ).join(""),
      keyStorage: {
        getItem: (k) => records.get(k) ?? null,
        setItem: (k, v) => {
          records.set(k, v);
        },
        removeItem: (k) => {
          records.delete(k);
        },
      },
    });
  return {
    create,
    scope,
    records,
    setSession: (s: SessionView) => {
      current = s;
    },
  };
}

test("context reads are owner-bound and preserve unknown old purpose without paid execution", async () => {
  const calls: OperationRequestOptions[] = [];
  const f = fixture(
    async <T>(_op: string, _input: unknown, options: OperationRequestOptions = {}) => {
      calls.push(options);
      return contextView as T;
    },
  );
  expect((await f.create().getContext("case", { expectedOwner: owner })).context.casePurpose).toBe(
    "unconfirmed",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("GET");
  expect(calls[0]?.expectedOwner).toBe(owner);
});
test("a caller owner mismatch rejects before transport, and a postflight switch discards the result", async () => {
  let count = 0;
  const f = fixture(async <T>() => {
    count++;
    f.setSession({
      user: { id: "other", name: "다른 합성 사용자", accountType: "customer" },
      needsConsent: false,
    });
    return contextView as T;
  });
  await expect(f.create().getContext("case", { expectedOwner: "other" })).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(count).toBe(0);
  await expect(f.create().getContext("case", { expectedOwner: owner })).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(count).toBe(1);
});
test("create replay survives recreation and challenge rotation using only opaque recovery metadata", async () => {
  const keys: (string | undefined)[] = [],
    tokens: string[] = [];
  let fail = true;
  const f = fixture(async <T>(_op: string, raw: unknown, options: OperationRequestOptions = {}) => {
    keys.push(options.key);
    tokens.push((raw as { turnstileToken: string }).turnstileToken);
    if (fail) throw new ApiError("UNAVAILABLE", "합성 연결 실패", true);
    return {
      contractVersion: v2ReworkVersionSchema.value,
      workspace,
      context: { ...context, casePurpose: "prepare_claim" },
    } as T;
  });
  const input = {
    narrative: "합성 계약 대금을 받지 못해 청구를 준비하려고 합니다.",
    subjectContext: "individual" as const,
    casePurpose: "prepare_claim" as const,
  };
  await expect(f.create().createCase(input, { expectedOwner: owner })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.records.size).toBe(1);
  expect(JSON.stringify([...f.records])).not.toContain(input.narrative);
  expect(JSON.stringify([...f.records])).not.toContain(owner);
  fail = false;
  expect((await f.create().createCase(input, { expectedOwner: owner })).id).toBe(workspace.id);
  expect(keys[1]).toBe(keys[0]);
  expect(tokens[1]).not.toBe(tokens[0]);
  expect(f.records.size).toBe(0);
});
test("a challenge-time identity change cannot transfer an old draft to a new owner", async () => {
  let calls = 0;
  const scope = createSessionScope();
  let user = owner;
  const client = createReworkClient({
    scope,
    request: async <T>() => {
      calls++;
      return {} as T;
    },
    session: async () => ({
      user: { id: user, name: "합성", accountType: "customer" },
      needsConsent: false,
    }),
    challenge: async () => {
      user = "other";
      return "synthetic";
    },
    fingerprint: async () => "a".repeat(64),
    newKey: () => crypto.randomUUID(),
  });
  await expect(
    client.createCase({
      narrative: "합성 사건을 정리해서 필요한 자료를 준비하려고 합니다.",
      subjectContext: "individual",
      casePurpose: "prepare_claim",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(calls).toBe(0);
});
test("consent revocation and caller cancellation discard completed mutation bodies", async () => {
  const controller = new AbortController();
  const f = fixture(async <T>() => {
    controller.abort();
    return contextView as T;
  });
  await expect(
    f
      .create()
      .updateContext(
        "case",
        { expectedRevision: 1, ...context, casePurpose: "respond_to_claim" } as Parameters<
          ReturnType<typeof f.create>["updateContext"]
        >[1],
        { signal: controller.signal },
      ),
  ).rejects.toThrow();
  const revoked = fixture(async <T>() => {
    revoked.setSession({
      user: { id: owner, name: "합성", accountType: "customer" },
      needsConsent: true,
    });
    return contextView as T;
  });
  await expect(
    revoked.create().updateContext("case", {
      expectedRevision: 1,
      ...context,
      casePurpose: "respond_to_claim",
    } as Parameters<ReturnType<typeof f.create>["updateContext"]>[1]),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
});
test("invalid action commands do not reach transport", async () => {
  let calls = 0;
  const f = fixture(async <T>() => {
    calls++;
    return {} as T;
  });
  expect(() =>
    f.create().executeAction("case", {
      requestId: "request",
      expectedRevision: 1,
      action: "run_shell",
    } as never),
  ).toThrow();
  expect(calls).toBe(0);
});

test("logical report progress is explicit and never changes the installed conversation response", async () => {
  const state = v2ConversationStateSchema().parse({
    contractVersion: v2ReworkVersionSchema.value,
    workspaceRevision: 1,
    caseContext: context,
    summaryConfirmed: false,
    pendingEvidenceIds: [],
    snapshot: null,
    intents: [],
    analysis: {
      status: "not_started",
      basis: null,
      currentJobId: null,
      failure: null,
      missingItems: [],
    },
    report: {
      status: "not_started",
      id: null,
      revision: null,
      basis: null,
      currentJobId: null,
      failure: null,
    },
  });
  const calls: OperationRequestOptions[] = [];
  const envelope = v2ConversationProgressSchema().parse({
    contractVersion: "conversation-report-progress-v1",
    state,
    reportContinuation: null,
  });
  let invalid = false;
  const f = fixture(
    async <T>(_operation: string, _input: unknown, options: OperationRequestOptions = {}) => {
      calls.push(options);
      return (
        options.path?.endsWith("conversation-progress")
          ? { ...envelope, ...(invalid ? { unexpected: true } : {}) }
          : state
      ) as T;
    },
  );
  const client = f.create();
  expect(await client.getConversation("case")).toEqual(state);
  expect(
    v2ConversationStateSchema().safeParse({ ...state, reportContinuation: null }).success,
  ).toBe(false);
  expect(await client.getConversationProgress("case")).toEqual(envelope);
  expect(calls.map((c) => c.path)).toEqual([
    "/api/v2/cases/case/rework/conversation",
    "/api/v2/cases/case/rework/conversation-progress",
  ]);
  expect(
    calls.every((c) => c.method === "GET" && c.expectedOwner === owner && c.key === undefined),
  ).toBe(true);
  expect(f.records.size).toBe(0);
  invalid = true;
  await expect(client.getConversationProgress("case")).rejects.toBeInstanceOf(ApiError);
});
