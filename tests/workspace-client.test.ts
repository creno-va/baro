import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import { createFilesMock } from "../src/client/api/mock/files";
import { createWorkspaceMock, type WorkspaceMockRuntime } from "../src/client/api/mock/workspace";
import {
  createWorkspaceApi,
  workspaceMutation,
  workspaceResponse,
} from "../src/client/api/workspace";
import {
  action,
  assistantMessage,
  guide,
  intake,
  job,
  summary,
  timeline,
  userMessage,
  workspace,
} from "./fixtures/contracts/v2";

function fixture() {
  let stored = JSON.stringify({
    session: {
      user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      "synthetic-case": {
        id: "synthetic-case",
        title: "합성 사건",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-06T00:00:00.000Z",
        summary: "사용자가 확인한 합성 요약",
        schemaVersion: "2",
      },
    },
    workspace: {},
    files: {},
  });
  const runtime: WorkspaceMockRuntime = {
    read: () => JSON.parse(stored),
    update: (fn) => {
      const state = JSON.parse(stored);
      const result = fn(state);
      stored = JSON.stringify(state);
      return result;
    },
  };
  const handler = createWorkspaceMock(runtime);
  const originals = new Map<string, Blob>();
  const filesHandler = createFilesMock(runtime, async (key, value) => {
    if (value === null) originals.delete(key);
    else if (value !== undefined) originals.set(key, value);
    return originals.get(key) ?? null;
  });
  const transport = async (path: string, init?: RequestInit) =>
    (await handler(new Request(`http://localhost${path}`, init))) ??
    (await filesHandler(new Request(`http://localhost${path}`, init))) ??
    Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  return { runtime, transport, client: createWorkspaceApi(transport) };
}
function settle(runtime: WorkspaceMockRuntime) {
  runtime.update((state) => {
    for (const workspace of Object.values(state.workspace))
      for (const pending of Object.values(workspace.pending ?? {})) pending.at = 0;
  });
}
test("saved conversation survives new client; failed response retries without duplicating user message", async () => {
  const f = fixture();
  let view = await f.client.get("synthetic-case");
  f.runtime.update((state) => {
    state.faults = { "workspace.sendMessage": ["chat_failed"] };
  });
  view = await f.client.sendMessage("synthetic-case", {
    expectedRevision: view.case.revision,
    text: "추가한 합성 사실",
    selectedFileIds: [],
  });
  expect(view.messages.map((m) => m.status)).toEqual(["complete", "pending"]);
  f.runtime.update((state) => {
    state.reports = { "synthetic-case": { stale: false, excludedFileIds: [] } };
  });
  const pendingRevision = view.case.revision;
  settle(f.runtime);
  const resumed = createWorkspaceApi(f.transport);
  view = await resumed.get("synthetic-case");
  expect(view.messages[1]?.status).toBe("failed");
  expect(view.case.revision).toBe(pendingRevision + 1);
  expect(f.runtime.read().reports?.["synthetic-case"]?.stale).toBe(true);
  view = await resumed.retryMessage("synthetic-case", view.messages[1]?.id ?? "");
  expect(view.messages[1]?.status).toBe("pending");
  settle(f.runtime);
  view = await resumed.get("synthetic-case");
  expect(view.messages.filter((m) => m.role === "user")).toHaveLength(1);
  expect(view.messages[1]?.status).toBe("complete");
  expect(view.messages[1]?.text).toContain("합성 API 예시");
});
test("stale chat and removed file reject mutation; transient failure can retry with same request key", async () => {
  const f = fixture();
  const view = await f.client.get("synthetic-case");
  const action = view.actions[0];
  expect(action).toBeDefined();
  await f.client.setAction("synthetic-case", action?.id ?? "", true);
  await expect(
    f.client.sendMessage("synthetic-case", {
      expectedRevision: view.case.revision,
      text: "오래된 입력",
      selectedFileIds: [],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const fresh = await f.client.get("synthetic-case");
  await expect(
    f.client.sendMessage("synthetic-case", {
      expectedRevision: fresh.case.revision,
      text: "삭제된 자료 첨부",
      selectedFileIds: ["removed"],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  f.runtime.update((state) => {
    state.faults = { "workspace.sendMessage": ["UNAVAILABLE"] };
  });
  const input = {
    expectedRevision: fresh.case.revision,
    text: "같은 요청 재시도",
    selectedFileIds: [],
  };
  await expect(f.client.sendMessage("synthetic-case", input)).rejects.toMatchObject({
    code: "UNAVAILABLE",
    retryable: true,
  });
  await f.client.sendMessage("synthetic-case", input);
  expect(
    (await f.client.get("synthetic-case")).messages.filter((m) => m.role === "user"),
  ).toHaveLength(1);
});
test("actions can be toggled repeatedly; timeline edit persists and report becomes stale", async () => {
  const f = fixture();
  let view = await f.client.get("synthetic-case");
  const actionId = view.actions[0]?.id ?? "";
  f.runtime.update((state) => {
    state.reports = { "synthetic-case": { stale: false, excludedFileIds: [] } };
  });
  for (const done of [true, false, true]) {
    view = await f.client.setAction("synthetic-case", actionId, done);
    expect(view.actions[0]?.done).toBe(done);
  }
  view = await f.client.saveTimeline("synthetic-case", {
    date: "",
    title: "날짜가 불확실한 사실",
    detail: "원본을 보고 확인할 예정",
  });
  const id = view.timeline[0]?.id ?? "";
  view = await f.client.saveTimeline("synthetic-case", {
    id,
    date: "2026-10-01",
    title: "확인한 날짜",
    detail: "합성 타임라인 편집",
  });
  const resumed = await createWorkspaceApi(f.transport).get("synthetic-case");
  expect(resumed.timeline).toEqual(view.timeline);
  expect(resumed.timeline[0]?.date).toBe("2026-10-01");
  expect(f.runtime.read().reports?.["synthetic-case"]?.stale).toBe(true);
});
test("successful mutation replay is stable, while repeated UI toggles use fresh keys", async () => {
  const f = fixture();
  const view = await f.client.get("synthetic-case");
  const path = "/api/v2/cases/synthetic-case/messages";
  const init = workspaceMutation(path, {
    expectedRevision: view.case.revision,
    text: "한 번만 저장",
    selectedFileIds: [],
  });
  expect((await f.transport(path, init)).status).toBe(200);
  expect((await f.transport(path, init)).status).toBe(200);
  expect(
    (await f.client.get("synthetic-case")).messages.filter((m) => m.role === "user"),
  ).toHaveLength(1);
});
test("session, consent, quota and deleted case are enforced without recreating state", async () => {
  const f = fixture();
  await f.client.get("synthetic-case");
  f.runtime.update((state) => {
    state.faults = { "workspace.sendMessage": ["QUOTA_EXCEEDED"] };
  });
  await expect(
    f.client.sendMessage("synthetic-case", {
      expectedRevision: 1,
      text: "한도 입력",
      selectedFileIds: [],
    }),
  ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  f.runtime.update((state) => {
    state.session.needsConsent = true;
  });
  expect((await f.client.get("synthetic-case")).case.id).toBe("synthetic-case");
  await expect(
    f.client.sendMessage("synthetic-case", {
      expectedRevision: 1,
      text: "재동의 전 새 처리 금지",
      selectedFileIds: [],
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  f.runtime.update((state) => {
    state.session.needsConsent = false;
    state.session.user = null;
  });
  await expect(f.client.get("synthetic-case")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  f.runtime.update((state) => {
    state.session.user = { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" };
    delete state.cases["synthetic-case"];
    delete state.workspace["synthetic-case"];
  });
  await expect(f.client.get("synthetic-case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.runtime.read().workspace).toEqual({});
});

test("common caseOwners state denies another mock account and deleted-account replay", async () => {
  const f = fixture();
  f.runtime.update((state) => {
    state.caseOwners = { "synthetic-case": "synthetic-owner" };
  });
  await f.client.get("synthetic-case");
  f.runtime.update((state) => {
    state.session.user = { id: "other-owner", name: "다른 합성 사용자", accountType: "customer" };
  });
  await expect(f.client.get("synthetic-case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(createFilesApi(f.transport).list("synthetic-case")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  f.runtime.update((state) => {
    state.session.user = { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" };
    state.deletedAccountIds = ["synthetic-owner"];
  });
  await expect(f.client.get("synthetic-case")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
test("real file adapter surfaces unavailable processing API instead of generating mock success", async () => {
  const calls: string[] = [];
  const request = async (path: string) => {
    calls.push(path);
    return path.endsWith("/workspace")
      ? Response.json({ workspaceRevision: 2 })
      : path.endsWith("/files")
        ? Response.json([
            {
              id: "file",
              revision: 1,
              name: "synthetic.txt",
              declaredMediaType: "text/plain",
              byteLength: 10,
              status: "failed",
            },
          ])
        : Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  await expect(createFilesApi(request).retry("case", "file")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(calls).toContain("/api/v2/cases/case/files/file/retry");
});

test("chunk upload retries reuse reservation and preserve exact original bytes after client reload", async () => {
  const f = fixture();
  await f.client.get("synthetic-case");
  f.runtime.update((state) => {
    state.faults = { "files.uploadPart": ["UNAVAILABLE"] };
  });
  const files = createFilesApi(f.transport),
    source = new File(["합성 원본 자료입니다."], "synthetic.txt", { type: "text/plain" });
  await expect(files.upload("synthetic-case", source)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const pending = await files.list("synthetic-case");
  expect(pending).toHaveLength(1);
  expect(pending[0]?.status).toBe("uploading");
  const uploaded = await createFilesApi(f.transport).upload("synthetic-case", source);
  expect(uploaded.id).toBe(pending[0]?.id ?? "");
  expect(await files.list("synthetic-case")).toHaveLength(1);
  const resumed = createFilesApi(f.transport);
  expect(await (await resumed.original("synthetic-case", uploaded.id)).text()).toBe(
    await source.text(),
  );
  await resumed.remove("synthetic-case", uploaded.id);
  expect(await resumed.list("synthetic-case")).toEqual([]);
  await expect(resumed.original("synthetic-case", uploaded.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("real workspace DTOs preserve server-validated text and use entity revisions for edits", async () => {
  const writes: { path: string; body: unknown }[] = [];
  const reads: string[] = [];
  let validated = true;
  const transport = async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ saved: true });
    }
    reads.push(path);
    if (path.endsWith("/workspace"))
      return Response.json({
        ...workspace,
        workspaceRevision: validated
          ? workspace.workspaceRevision
          : workspace.workspaceRevision + 1,
      });
    if (path.endsWith("/intake")) return Response.json(intake);
    if (path.endsWith("/summary")) return Response.json(summary);
    if (path.includes("/messages?"))
      return Response.json({
        items: [
          userMessage,
          {
            ...assistantMessage,
            safety: validated ? "validated" : "unvalidated",
            citations: [guide],
            references: [{ kind: "official_source", citationId: guide.id }],
          },
        ],
        nextCursor: null,
      });
    if (path.endsWith("/actions"))
      return Response.json({ items: [{ ...action, revision: 7 }], nextCursor: null });
    if (path.endsWith("/timeline"))
      return Response.json({ items: [{ ...timeline, revision: 6 }], nextCursor: null });
    if (path.endsWith("/files")) return Response.json([]);
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  const api = createWorkspaceApi(transport);
  const view = await api.get(workspace.id);
  expect(view.case.summary).toBe(summary.overview);
  expect(view.messages[1]?.text).toBe(assistantMessage.text);
  expect(view.messages[1]?.citations?.[0]?.url).toBe(guide.url);
  expect(view.messages[1]?.references).toEqual([{ kind: "official_source", citationId: guide.id }]);
  await api.get(workspace.id);
  expect(reads.filter((path) => path.includes("/messages?"))).toHaveLength(1);
  expect(reads.filter((path) => path.endsWith("/timeline"))).toHaveLength(1);
  expect(reads.filter((path) => path.endsWith("/workspace"))).toHaveLength(3);
  expect(reads.filter((path) => path.endsWith("/files"))).toHaveLength(2);
  await api.setAction(workspace.id, action.id, true);
  await api.saveTimeline(workspace.id, {
    id: timeline.id,
    date: "",
    title: "합성 편집",
    detail: "",
  });
  expect(writes[0]?.body).toEqual({ expectedRevision: 7, status: "done" });
  expect(writes[1]?.body).toEqual({
    expectedRevision: 6,
    date: null,
    datePrecision: "unknown",
    event: "합성 편집",
  });
  validated = false;
  await expect(api.get(workspace.id)).rejects.toThrow();
});

test("deletion during binary save rejects late publication and removes the saved chunk", async () => {
  const f = fixture();
  await f.client.get("synthetic-case");
  const originals = new Map<string, Blob>();
  const handler = createFilesMock(f.runtime, async (key, value) => {
    if (value === null) originals.delete(key);
    else if (value) {
      originals.set(key, value);
      f.runtime.update((state) => {
        delete state.cases["synthetic-case"];
      });
    }
    return originals.get(key) ?? null;
  });
  const transport = async (path: string, init?: RequestInit) =>
    (await handler(new Request(`http://localhost${path}`, init))) ?? f.transport(path, init);
  await expect(
    createFilesApi(transport).upload(
      "synthetic-case",
      new File(["합성 원본"], "synthetic.txt", { type: "text/plain" }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(originals.size).toBe(0);
  expect(f.runtime.read().cases["synthetic-case"]).toBeUndefined();
});

test("real accepted chat job restores failed response after reload and retries current workspace revision", async () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  let status: "failed" | "queued" | "completed" = "failed";
  let currentJobId: string | null = null;
  let expectedRetry: unknown;
  const accepted = { operationId: job.operationId, jobId: job.id, status: "queued", retryAfter: 2 };
  const request = async (path: string, init?: RequestInit) => {
    if (init?.method === "POST" && path.endsWith("/messages"))
      return Response.json(accepted, { status: 202 });
    if (init?.method === "POST" && path.endsWith("/retry")) {
      expectedRetry = JSON.parse(String(init.body));
      status = "queued";
      currentJobId = job.id;
      return Response.json(accepted, { status: 202 });
    }
    if (path.endsWith("/workspace"))
      return Response.json({ ...workspace, currentJobId, workspaceRevision: 4 });
    if (path.endsWith(`/workspace-jobs/${job.id}`))
      return Response.json({
        ...job,
        status,
        phase: status === "completed" ? "finished" : "admission",
        progressPercent: status === "completed" ? 100 : 0,
        attempts: 1,
        failure: status === "failed" ? "CITATION_INVALID" : null,
        retryable: status === "failed",
      });
    if (path.endsWith("/intake")) return Response.json(intake);
    if (path.endsWith("/summary")) return Response.json(summary);
    if (path.includes("/messages?"))
      return Response.json({ items: [userMessage], nextCursor: null });
    if (path.endsWith("/actions") || path.endsWith("/timeline"))
      return Response.json({ items: [], nextCursor: null });
    if (path.endsWith("/files")) return Response.json([]);
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  const first = createWorkspaceApi(request, storage);
  const view = await first.sendMessage(workspace.id, {
    expectedRevision: 3,
    text: "합성 질문",
    selectedFileIds: [],
  });
  expect(view.messages.at(-1)?.status).toBe("failed");
  const resumed = createWorkspaceApi(request, storage);
  const restored = await resumed.get(workspace.id);
  expect(restored.messages.at(-1)?.status).toBe("failed");
  expect(restored.messages.at(-1)?.warnings).toEqual([
    "답변 검증을 통과하지 못해 내용을 표시하지 않았어요. 원본과 출처를 확인해 주세요.",
  ]);
  expect((await resumed.retryMessage(workspace.id, `job:${job.id}`)).messages.at(-1)?.status).toBe(
    "pending",
  );
  expect(expectedRetry).toEqual({ expectedRevision: 4 });
  status = "completed";
  await resumed.get(workspace.id);
  expect(stored.size).toBe(0);
});

test("a denied/deleted v2 resource remains NOT_FOUND even when legacy transport is unavailable", async () => {
  let denied = false;
  const f = fixture();
  const transport = async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/cases/"))
      return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
    if (denied && path.endsWith("/workspace"))
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    return f.transport(path, init);
  };
  const client = createWorkspaceApi(transport, null);
  await client.get("synthetic-case");
  denied = true;
  await expect(client.get("synthetic-case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(createWorkspaceApi(transport, null).get("synthetic-case")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("shared ROLE_REQUIRED denies access instead of presenting a temporary outage", async () => {
  await expect(
    workspaceResponse(Response.json({ error: { code: "ROLE_REQUIRED" } }, { status: 403 })),
  ).rejects.toMatchObject({ code: "NOT_FOUND", retryable: false });
});

test("known v1 records still read and preserve UNAVAILABLE during temporary legacy outages", async () => {
  const id = crypto.randomUUID();
  let unavailable = false;
  const client = createWorkspaceApi(async (path) => {
    if (path.endsWith("/workspace"))
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    return unavailable
      ? Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 })
      : Response.json({
          caseId: id,
          analysisId: crypto.randomUUID(),
          title: "기존 합성 사건",
          status: "queued",
          inputRevision: 2,
          questions: [],
          result: null,
          error: null,
        });
  }, null);
  expect((await client.get(id)).case.schemaVersion).toBe("1");
  unavailable = true;
  await expect(client.get(id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("date precision survives create, edit and a new client for every precision", async () => {
  const f = fixture();
  for (const [date, datePrecision] of [
    ["2024-01-01", "year"],
    ["2024-06-01", "month"],
    ["2024-06-03", "day"],
    ["", "unknown"],
  ] as const) {
    const before = await f.client.get("synthetic-case");
    const next = await f.client.saveTimeline("synthetic-case", {
      date,
      datePrecision,
      title: `정밀도 ${datePrecision}`,
      detail: "",
    });
    const entry = next.timeline.find((v) => v.title === `정밀도 ${datePrecision}`);
    expect(entry?.datePrecision).toBe(datePrecision);
    const reloaded = await createWorkspaceApi(f.transport).get("synthetic-case");
    expect(reloaded.timeline.find((v) => v.id === entry?.id)).toEqual(entry);
    expect(next.case.revision).toBeGreaterThan(before.case.revision);
  }
});

test("material edits retain originals, survive a lost acknowledgement and reconsent allows only reads", async () => {
  const f = fixture();
  const file = {
    id: "review-file",
    name: "합성.txt",
    mimeType: "text/plain",
    sizeBytes: 20,
    status: "ready" as const,
    coverage: "한 쪽",
    extractedText: "원래 추출 내용",
  };
  f.runtime.update((state) => {
    state.files["synthetic-case"] = [file];
  });
  const files = createFilesApi(f.transport);
  const initial = await files.review("synthetic-case", file.id);
  let lose = true;
  const client = createFilesApi(async (path, init) => {
    const response = await f.transport(path, init);
    if (init?.method === "PATCH" && lose) {
      lose = false;
      throw new Error("synthetic lost acknowledgement");
    }
    return response;
  });
  const edit = {
    expectedRevision: initial.file.revision,
    edits: [
      {
        observationId: initial.observations[0]?.value.id ?? "",
        text: "사용자 교정 내용",
        included: false,
      },
    ],
  };
  await expect(
    client.saveReview("synthetic-case", file.id, edit, initial.workspaceRevision),
  ).rejects.toThrow("lost acknowledgement");
  expect(
    (await client.saveReview("synthetic-case", file.id, edit, initial.workspaceRevision)).status,
  ).toBe("ready");
  const current = await createFilesApi(f.transport).review("synthetic-case", file.id);
  expect(current.observations[0]?.original.text).toBe("원래 추출 내용");
  expect(current.observations[0]?.value).toMatchObject({
    text: "사용자 교정 내용",
    included: false,
    userEdited: true,
  });
  f.runtime.update((state) => {
    state.session.needsConsent = true;
  });
  expect((await files.review("synthetic-case", file.id)).file.revision).toBe(2);
  await expect(
    files.saveReview("synthetic-case", file.id, edit, initial.workspaceRevision),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
});
