import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import { createFilesMock } from "../src/client/api/mock/files";
import { createWorkspaceMock, type WorkspaceMockRuntime } from "../src/client/api/mock/workspace";
import { createWorkspaceApi, workspaceMutation } from "../src/client/api/workspace";
import {
  action,
  assistantMessage,
  guide,
  intake,
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
  settle(f.runtime);
  const resumed = createWorkspaceApi(f.transport);
  view = await resumed.get("synthetic-case");
  expect(view.messages[1]?.status).toBe("failed");
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
  await expect(f.client.get("synthetic-case")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
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
  let validated = true;
  const transport = async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ saved: true });
    }
    if (path.endsWith("/workspace")) return Response.json(workspace);
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
