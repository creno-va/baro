import { expect, test } from "bun:test";
import {
  ApiError,
  createCasesClient,
  createJsonRequester,
  createWorkspaceClient,
  type WorkspaceAcknowledgement,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { createWorkspaceModel } from "../apps/mobile/src/features/workspace/model";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake?.revision,
    answers: intake?.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  await runCustomerJob(f, "intake_summary");
  await confirmCustomerSummary(f);
  const env: Env = {
    ...f.owner.env,
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  };
  const app = new Hono<ApiEnvironment>()
    .route("/api/me", meApi)
    .route("/api/v2/cases", createWorkspacesApi());
  let cookie = f.owner.cookie;
  const transport: WorkspaceTransport = async (path, init) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie,
          origin: env.BETTER_AUTH_URL,
        },
      },
      env,
    );
  const records = new Map<string, string>();
  const fingerprint = async (value: string) =>
    Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
      "hex",
    );
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => records.get(key) ?? null,
      set: async (key, value) => {
        records.set(key, value);
      },
      remove: async (key) => {
        records.delete(key);
      },
    },
  });
  const receipts: WorkspaceAcknowledgement[] = [];
  const client = (request = transport, includeActionRevisions = true) =>
    createWorkspaceClient({
      scope: createSessionScope(),
      newKey: () => crypto.randomUUID(),
      request,
      listFiles: async () => [],
      includeActionRevisions,
      includeSummaryConfirmation: true,
      recovery: { ownerId: f.owner.userId, storage, fingerprint },
      onAcknowledged: (r) => receipts.push(r),
    });
  return {
    ...f,
    transport,
    client,
    records,
    receipts,
    storage,
    fingerprint,
    cookie: (value: string) => {
      cookie = value;
    },
  };
}
test("a fresh native client replays the real admitted chat key/body after lost ACK; another signed owner cannot grant or revoke it", async () => {
  const f = await fixture();
  try {
    const w = await f.service.find(f.owner.userId, f.workspace.id),
      writes: RequestInit[] = [];
    const input = {
      expectedRevision: w.workspaceRevision,
      text: "원래 전송한 합성 비공개 사실입니다.",
      selectedFileIds: [],
    };
    let admitted = false,
      lost = true;
    const request: WorkspaceTransport = async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/messages")) {
        writes.push(init);
        if (!admitted) {
          // Synthetic readiness/admission only; the subsequent cookie/API, encrypted state and replay are real.
          const key = new Headers(init.headers).get("idempotency-key") ?? "";
          expect(
            await f.jobs.admitWorkspace(
              {
                ownerId: f.owner.userId,
                workspaceId: w.id,
                expectedRevision: w.workspaceRevision,
                now: f.now,
              },
              { operationId: crypto.randomUUID(), key, requestHash: await runtimeDigest(input) },
              crypto.randomUUID(),
              "chat_response",
              { id: crypto.randomUUID(), request: input },
            ),
          ).toBe(true);
          admitted = true;
        }
      }
      const response = await f.transport(path, init);
      if (init?.method === "POST" && lost) {
        lost = false;
        expect(response.status).toBe(202);
        throw new ApiError("UNAVAILABLE", "합성 ACK 유실", true);
      }
      return response;
    };
    await expect(f.client(request).sendMessage(w.id, input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.records.size).toBe(1);
    expect(f.receipts).toEqual([]);
    const other = await seedTestSession(f.db, { consent: true });
    f.cookie(other.cookie);
    await expect(f.client(request).get(w.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(f.client(request).sendMessage(w.id, input)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    f.cookie(f.owner.cookie);
    const recovered = await f.client(request).sendMessage(w.id, input);
    expect(recovered.messages.filter((row) => row.role === "user")).toHaveLength(1);
    expect(recovered.messages.at(-1)?.status).toBe("pending");
    expect(new Set(writes.map((row) => new Headers(row.headers).get("idempotency-key"))).size).toBe(
      1,
    );
    expect(new Set(writes.map((row) => row.body)).size).toBe(1);
    expect(f.records.size).toBe(0);
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_jobs WHERE kind='chat_response'").get(),
    ).toEqual({ n: 1 });
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM session WHERE user_id=?").get(other.userId),
    ).toEqual({ n: 1 });
  } finally {
    f.db.close();
  }
});

test("native workspace → summary review → confirmation uses real Hono/SQL and the existing case stage projection", async () => {
  const f = await fixture();
  try {
    expect((await f.client().get(f.workspace.id)).case.summaryNeedsConfirmation).toBe(false);
    await runCustomerJob(f, "chat_response");
    const next = await f.client().get(f.workspace.id);
    expect(next.case.stage).toBe("intake");
    expect(next.case.summaryNeedsConfirmation).toBe(true);
    const scope = createSessionScope();
    const json = createJsonRequester({
      scope,
      transport: (path, init) => f.transport(path, init),
      newKey: () => crypto.randomUUID(),
    });
    const cases = () =>
      createCasesClient({
        mode: "real",
        scope,
        storage: f.storage,
        fingerprint: f.fingerprint,
        newKey: () => crypto.randomUUID(),
        challenge: async () => {
          throw new Error("NO_CHALLENGE_FOR_REVIEW");
        },
        request: (_op, _input, options = {}) => {
          if (!options.path) throw new Error("MISSING_REAL_PATH");
          return json({ ...options, path: options.path });
        },
      });
    const native = cases(),
      review = await native.get(f.workspace.id);
    expect(review.stage).toBe("summary");
    expect(review.summaryDetails?.overview).toBe(next.case.summary);
    const confirmed = await native.confirmSummary(f.workspace.id, {
      expectedRevision: review.revision,
    });
    expect(confirmed.stage).toBe("active");
    expect((await f.client().get(f.workspace.id)).case.summaryNeedsConfirmation).toBe(false);
  } finally {
    f.db.close();
  }
});

test("RN workspace model clears an acknowledged timeline editor before a real Hono projection failure and refreshes exactly one SQL event", async () => {
  const f = await fixture();
  let stop = () => {};
  try {
    const scope = createSessionScope();
    let written = false,
      loseRead = true;
    const request: WorkspaceTransport = async (path, init) => {
      if (written && loseRead && path.endsWith("/workspace")) {
        loseRead = false;
        return Response.json({}, { status: 503 });
      }
      const response = await f.transport(path, init);
      if (init?.method === "POST" && path.endsWith("/timeline")) {
        expect(response.ok).toBe(true);
        written = true;
      }
      return response;
    };
    const model = createWorkspaceModel({
      caseId: f.workspace.id,
      session: {
        getSnapshot: () => ({
          phase: "ready",
          busy: false,
          role: "customer",
          consent: null,
          error: null,
          session: {
            user: { id: f.owner.userId, name: "합성 고객", accountType: "customer" },
            needsConsent: false,
          },
        }),
        subscribe: () => () => {},
        refresh: async () => {},
      },
      createClient: (signal, ownerId, onAcknowledged) =>
        createWorkspaceClient({
          scope,
          signal,
          request,
          includeActionRevisions: true,
          newKey: () => crypto.randomUUID(),
          listFiles: async () => [],
          recovery: { ownerId, storage: f.storage, fingerprint: f.fingerprint },
          onAcknowledged,
        }),
    });
    let ready = () => {};
    const loaded = new Promise<void>((done) => {
      ready = done;
    });
    const unsubscribe = model.subscribe(() => {
      if (model.getSnapshot().value && !model.getSnapshot().busy) ready();
    });
    stop = model.start();
    await loaded;
    unsubscribe();
    model.editTimeline();
    model.changeTimeline({ title: "RN 합성 기록" });
    await model.saveTimeline();
    expect(model.getSnapshot()).toMatchObject({ timeline: null, pending: null, busy: false });
    expect(model.getSnapshot().error).not.toBeNull();
    await model.replay();
    await model.refresh();
    expect(
      model.getSnapshot().value?.timeline.filter((entry) => entry.title === "RN 합성 기록"),
    ).toHaveLength(1);
  } finally {
    stop();
    f.db.close();
  }
});
test("timeline ACK survives a projection failure and client recreation without inserting another event", async () => {
  const f = await fixture();
  try {
    const before = await f.client().get(f.workspace.id),
      writes: RequestInit[] = [];
    const entry = {
      expectedRevision: before.case.revision,
      date: "",
      title: "합성 일정",
      detail: "비공개 합성 사건 내용",
    };
    let lost = true;
    const request: WorkspaceTransport = async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/timeline")) writes.push(init);
      if (writes.length && lost && path.endsWith("/workspace")) {
        lost = false;
        return Response.json({}, { status: 503 });
      }
      return f.transport(path, init);
    };
    await expect(f.client(request).saveTimeline(f.workspace.id, entry)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.receipts.at(-1)?.kind).toBe("timeline");
    expect(f.records.size).toBe(1);
    const view = await f.client(request).saveTimeline(f.workspace.id, entry);
    expect(view.timeline.filter((row) => row.title === entry.title)).toHaveLength(1);
    expect(view.case.revision).toBe(before.case.revision + 1);
    expect(new Headers(writes[0]?.headers).get("idempotency-key")).toBe(
      new Headers(writes[1]?.headers).get("idempotency-key"),
    );
    expect(JSON.stringify([...f.records])).not.toContain(entry.detail);
    expect(f.records.size).toBe(0);
  } finally {
    f.db.close();
  }
});
test("native action editors retain the original entity revision across recreation; default web projections remain unchanged", async () => {
  const f = await fixture();
  try {
    await runCustomerJob(f, "chat_response");
    await confirmCustomerSummary(f);
    const before = await f.client().get(f.workspace.id),
      action = before.actions[0];
    if (!action?.revision) throw new Error("MISSING_SYNTHETIC_ENTITY_REVISION");
    expect((await f.client(undefined, false).get(f.workspace.id)).actions[0]).not.toHaveProperty(
      "revision",
    );
    const writes: RequestInit[] = [];
    let lost = true;
    const request: WorkspaceTransport = async (path, init) => {
      const response = await f.transport(path, init);
      if (init?.method === "PUT") {
        writes.push(init);
        if (lost) {
          lost = false;
          expect(response.ok).toBe(true);
          throw new ApiError("UNAVAILABLE", "합성 응답 유실");
        }
      }
      return response;
    };
    await expect(
      f.client(request).setAction(f.workspace.id, action.id, true, action.revision),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const fresh = f.client(request);
    await fresh.get(f.workspace.id);
    const view = await fresh.setAction(f.workspace.id, action.id, true, action.revision);
    expect(view.actions[0]?.done).toBe(true);
    expect(view.actions[0]?.revision).toBe(action.revision + 1);
    expect(view.case.revision).toBe(before.case.revision + 1);
    expect(new Headers(writes[0]?.headers).get("idempotency-key")).toBe(
      new Headers(writes[1]?.headers).get("idempotency-key"),
    );
    expect(f.receipts.at(-1)).toMatchObject({ kind: "action", resourceId: action.id });
    expect(f.records.size).toBe(0);
  } finally {
    f.db.close();
  }
});
