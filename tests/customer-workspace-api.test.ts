import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { casesApi } from "../src/client/api/cases";
import { createWorkspaceApi, workspaceMutation } from "../src/client/api/workspace";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { hasCustomerWorkspaceAccess } from "../src/server/runtime/workspace";
import {
  customerWorkspaceFixture,
  executeCustomerJob,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  // Hono uses the live clock; keep synthetic receipts within its 24-hour replay window.
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake) throw new Error("Missing synthetic intake");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  await runCustomerJob(f, "intake_summary");
  const env: Env = {
    ...f.owner.env,
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  };
  const app = new Hono<ApiEnvironment>()
    .route("/api/me", meApi)
    .route("/api/v2/cases", createWorkspacesApi())
    .route("/api/v2/cases", createFilesApi());
  const transport = async (path: string, init?: RequestInit, cookie = f.owner.cookie) =>
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
  return { ...f, env, app, transport };
}

for (const operation of ["saveSummary", "confirmSummary"] as const) {
  test(`product Hono ${operation} recovers a committed lost response with identical body/key and denies changed/stale/foreign requests`, async () => {
    const f = await fixture();
    const id = f.workspace.id;
    const current = await f.service.find(f.owner.userId, id);
    const input = {
      expectedRevision: current.workspaceRevision,
      summary: "직접 수정한 합성 요약입니다.",
    };
    const original = globalThis.fetch;
    const writes: { path: string; init: RequestInit }[] = [];
    const reads: string[] = [];
    let cookie = f.owner.cookie;
    globalThis.fetch = (async (path, init) => {
      const response = await f.transport(String(path), init, cookie);
      if (!init?.method || init.method === "GET") reads.push(String(path));
      if (init?.method === "PUT" || init?.method === "POST") {
        expect(response.ok).toBe(true);
        writes.push({ path: String(path), init });
        if (writes.length === 1) throw new Error("Synthetic loss after real API commit");
      }
      return response;
    }) as typeof fetch;
    try {
      await expect(casesApi[operation](id, input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      const committed = await f.service.find(f.owner.userId, id);
      expect(committed.workspaceRevision).toBe(current.workspaceRevision + 1);
      const recovered = await casesApi[operation](id, input);
      expect(recovered.revision).toBe(committed.workspaceRevision);
      expect(operation === "saveSummary" ? recovered.summary : recovered.stage).toBe(
        operation === "saveSummary" ? input.summary : "active",
      );
      expect(writes).toHaveLength(2);
      expect(writes[0]?.init.body).toBe(writes[1]?.init.body);
      expect(new Headers(writes[0]?.init.headers).get("idempotency-key")).toBe(
        new Headers(writes[1]?.init.headers).get("idempotency-key"),
      );
      const first = writes[0];
      if (!first) throw new Error("Missing real mutation");
      const changed = JSON.parse(String(first.init.body));
      if (operation === "saveSummary") changed.overview = "다른 본문";
      else changed.summaryRevision++;
      expect(
        (await f.transport(first.path, { ...first.init, body: JSON.stringify(changed) })).status,
      ).toBe(409);
      expect(
        (
          await f.transport(first.path, {
            ...first.init,
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          })
        ).status,
      ).toBe(409);
      const foreign = await seedTestSession(f.db, { consent: true });
      expect((await f.transport(first.path, first.init, foreign.cookie)).status).toBe(404);
      cookie = foreign.cookie;
      await expect(casesApi.get(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(reads).not.toContain(`/api/cases/${id}`);
      expect((await f.service.find(f.owner.userId, id)).workspaceRevision).toBe(
        committed.workspaceRevision,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("real timeline creation survives lost response, uses entity revisions for edits, and rejects stale/foreign/deleted cases", async () => {
  const f = await fixture();
  const metadata = await f.service.intake(f.owner.userId, f.workspace.id);
  await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: metadata?.revision,
    summaryRevision: metadata?.summary?.revision,
  });
  let lost = true;
  const writes: RequestInit[] = [];
  const client = createWorkspaceApi(async (path, init) => {
    const response = await f.transport(path, init);
    if (init?.method === "POST" && path.endsWith("/timeline")) {
      expect(response.status).toBe(201);
      writes.push(init);
      if (lost) {
        lost = false;
        throw new Error("Synthetic timeline response loss after commit");
      }
    }
    return response;
  }, null);
  await client.get(f.workspace.id);
  const input = {
    date: "2026-10-01",
    title: "원본 날짜 확인",
    detail: "불확실한 내용은 직접 확인할 예정",
  };
  await expect(client.saveTimeline(f.workspace.id, input)).rejects.toThrow();
  const recovered = await client.saveTimeline(f.workspace.id, input);
  expect(recovered.timeline).toHaveLength(1);
  expect(writes[0]?.body).toBe(writes[1]?.body);
  expect(new Headers(writes[0]?.headers).get("idempotency-key")).toBe(
    new Headers(writes[1]?.headers).get("idempotency-key"),
  );
  const entry = recovered.timeline[0];
  if (!entry) throw new Error("Missing saved event");
  const edited = await client.saveTimeline(f.workspace.id, {
    ...entry,
    date: "",
    title: "날짜 미확인",
  });
  expect(edited.timeline[0]?.date).toBe("");
  expect(edited.timeline[0]?.title).toBe("날짜 미확인");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_timeline").get()).toEqual({ n: 1 });
  const stale = {
    expectedRevision: recovered.case.revision,
    date: null,
    datePrecision: "unknown",
    event: "오래된 추가",
  };
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(stale),
  };
  expect((await f.transport(`/api/v2/cases/${f.workspace.id}/timeline`, init)).status).toBe(409);
  const foreign = await seedTestSession(f.db, { consent: true });
  expect(
    (await f.transport(`/api/v2/cases/${f.workspace.id}/timeline`, init, foreign.cookie)).status,
  ).toBe(404);
  f.db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)")
    .run(f.workspace.id, new Date().toISOString());
  expect((await f.transport(`/api/v2/cases/${f.workspace.id}/workspace-jobs/latest`)).status).toBe(
    404,
  );
});

test("latest job lookup restores failed intake after pointer loss and empty browser storage", async () => {
  const f = await fixture();
  // Existing execution engine with a synthetic gateway deliberately fails audit.
  const rejected = await runCustomerJob(f, "intake_questions", false);
  expect(rejected.result.status).toBe("failed");
  expect((await f.service.find(f.owner.userId, f.workspace.id)).currentJobId).toBeNull();
  const response = await f.transport(`/api/v2/cases/${f.workspace.id}/workspace-jobs/latest`);
  expect(response.status).toBe(200);
  const latest = (await response.json()) as { id: string; status: string };
  expect(latest.id).toBe(rejected.params.jobId);
  expect(latest.status).toBe("failed");
  const original = globalThis.fetch;
  globalThis.fetch = ((path, init) => f.transport(String(path), init)) as typeof fetch;
  try {
    expect((await casesApi.getQuestions(f.workspace.id)).failed).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
});

test("earlier question batches remain editable, invalidate summary, and replay once without altering another batch", async () => {
  const f = await fixture();
  // A second batch makes the first question genuinely historical.
  await runCustomerJob(f, "intake_questions");
  const metadata = await f.service.intake(f.owner.userId, f.workspace.id);
  const question = metadata?.batches[0]?.questions[0];
  if (!metadata || !question) throw new Error("Missing earlier question");
  const key = crypto.randomUUID();
  const init = {
    method: "PUT",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      expectedRevision: metadata.revision,
      answers: [
        { questionId: question.id, status: "answered", value: "이전 질문의 수정된 합성 답변" },
      ],
    }),
  };
  const path = `/api/v2/cases/${f.workspace.id}/intake/answers`;
  expect((await f.transport(path, init)).status).toBe(200);
  expect((await f.transport(path, init)).status).toBe(200);
  const next = await f.service.intake(f.owner.userId, f.workspace.id);
  expect(next?.revision).toBe(metadata.revision + 1);
  expect(next?.summary).toBeNull();
  expect(next?.batches[0]?.answers[0]).toMatchObject({
    status: "answered",
    value: "이전 질문의 수정된 합성 답변",
  });
  expect(next?.batches[1]?.answers).toEqual([]);
  const original = globalThis.fetch;
  globalThis.fetch = ((path, init) => f.transport(String(path), init)) as typeof fetch;
  try {
    expect((await casesApi.getQuestions(f.workspace.id)).questions).toHaveLength(2);
  } finally {
    globalThis.fetch = original;
  }
});

test("real chat receipt replay and latest-job lookup recover a lost ACK after failure with no browser job ID", async () => {
  const f = await fixture();
  const metadata = await f.service.intake(f.owner.userId, f.workspace.id);
  await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: metadata?.revision,
    summaryRevision: metadata?.summary?.revision,
  });
  const w = await f.service.find(f.owner.userId, f.workspace.id);
  const body = {
    expectedRevision: w.workspaceRevision,
    text: "추가한 합성 사실입니다.",
    selectedFileIds: [],
  };
  const path = `/api/v2/cases/${w.id}/messages`;
  const init = workspaceMutation(path, body);
  const key = new Headers(init.headers).get("idempotency-key") ?? "",
    operationId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  // Synthetic admission supplies the missing live budget/model readiness. Everything
  // after admission uses the production API, encrypted repository and execution engine.
  expect(
    await f.jobs.admitWorkspace(
      {
        ownerId: f.owner.userId,
        workspaceId: w.id,
        expectedRevision: w.workspaceRevision,
        now: f.now,
      },
      { operationId, key, requestHash: await runtimeDigest(body) },
      jobId,
      "chat_response",
      { id: crypto.randomUUID(), request: body },
    ),
  ).toBe(true);
  // The first actual acknowledgement is deliberately discarded.
  expect((await f.transport(path, init)).status).toBe(202);
  let lostRead = true;
  const writes: RequestInit[] = [];
  const retrying = createWorkspaceApi(async (route, request) => {
    if (route === path && request?.method === "POST") writes.push(request);
    if (route.endsWith("/workspace") && lostRead) {
      lostRead = false;
      return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
    }
    return f.transport(route, request);
  }, null);
  await expect(retrying.sendMessage(w.id, body)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await retrying.sendMessage(w.id, body)).messages.at(-1)?.status).toBe("pending");
  expect(writes).toHaveLength(2);
  expect(writes[0]?.body).toBe(writes[1]?.body);
  expect(new Headers(writes[0]?.headers).get("idempotency-key")).toBe(key);
  expect(new Headers(writes[1]?.headers).get("idempotency-key")).toBe(key);
  const failed = await executeCustomerJob(
    f,
    {
      ownerId: f.owner.userId,
      workspaceId: w.id,
      workspaceRevision: w.workspaceRevision + 1,
      jobId,
    },
    false,
  );
  expect(failed.result.status).toBe("failed");
  expect((await f.service.find(f.owner.userId, w.id)).currentJobId).toBeNull();
  const client = createWorkspaceApi(f.transport, null);
  const resumed = await client.get(w.id);
  expect(resumed.messages.at(-1)).toMatchObject({ id: `job:${jobId}`, status: "failed" });
  expect(resumed.messages.filter((message) => message.role === "user")).toHaveLength(1);
  const receipt = (await (await f.transport(path, init)).json()) as { jobId: string };
  expect(receipt.jobId).toBe(jobId);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_messages WHERE role='user'").get()).toEqual({
    n: 1,
  });
  const foreign = await seedTestSession(f.db, { consent: true });
  expect(
    (await f.transport(`/api/v2/cases/${w.id}/workspace-jobs/latest`, undefined, foreign.cookie))
      .status,
  ).toBe(404);
});

test("same-owner role changes deny workspace reads and mutations without altering stored summary", async () => {
  const f = await fixture();
  expect(await hasCustomerWorkspaceAccess(f.core, f.owner.userId)).toBe(true);
  const metadata = await f.service.intake(f.owner.userId, f.workspace.id);
  const changed = await f.transport("/api/me/account-type", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountType: "lawyer" }),
  });
  expect(changed.status).toBe(200);
  expect(await hasCustomerWorkspaceAccess(f.core, f.owner.userId)).toBe(false);
  const denied = await f.transport(`/api/v2/cases/${f.workspace.id}/workspace`);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: "ROLE_REQUIRED" } });
  await expect(createWorkspaceApi(f.transport, null).get(f.workspace.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
    retryable: false,
  });
  expect(
    (
      await f.transport(`/api/v2/cases/${f.workspace.id}/summary/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          expectedRevision: metadata?.revision,
          summaryRevision: metadata?.summary?.revision,
        }),
      })
    ).status,
  ).toBe(403);
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.revision).toBe(
    metadata?.revision,
  );
});

test("role change during an admitted workspace job prevents publishing its synthetic model result", async () => {
  const f = await fixture();
  const before = await f.service.intake(f.owner.userId, f.workspace.id);
  let phases = 0;
  const execution = await runCustomerJob(f, "intake_questions", true, async () => {
    if (++phases !== 1) return;
    expect(
      (
        await f.transport("/api/me/account-type", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountType: "lawyer" }),
        })
      ).status,
    ).toBe(200);
  });
  expect(execution.result.status).toBe("failed");
  const after = await f.service.intake(f.owner.userId, f.workspace.id);
  expect(after?.batches).toEqual(before?.batches);
  // Question admission already invalidates the pointer; the old saved summary
  // remains and the revoked model result cannot publish another snapshot.
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_summaries").get()).toEqual({ n: 1 });
  expect((await f.service.find(f.owner.userId, f.workspace.id)).currentJobId).toBeNull();
  expect((await runCustomerJob(f, "intake_questions")).result.status).toBe("stopped");
});
