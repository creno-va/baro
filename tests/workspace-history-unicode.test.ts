import { expect, test } from "bun:test";
import {
  createWorkspaceMock,
  type WorkspaceMockRuntime,
  type WorkspaceMockState,
} from "../src/client/api/mock/workspace";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { v2MessageRequestSchema, v2TimelineEditRequestSchema } from "../src/contracts/v2";
import { action, intake, summary, timeline, userMessage, workspace } from "./fixtures/contracts/v2";

function mockFixture() {
  let state: WorkspaceMockState = {
    session: {
      user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      [workspace.id]: {
        id: workspace.id,
        title: "Synthetic",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: workspace.updatedAt,
        summary: "Synthetic",
        schemaVersion: "2",
        summaryDetails: { ...summary, facts: [] },
      },
    },
    workspace: {},
    files: {},
  };
  const runtime: WorkspaceMockRuntime = {
    read: () => structuredClone(state),
    update: (fn) => {
      const next = structuredClone(state);
      const result = fn(next);
      state = next;
      return result;
    },
  };
  const handler = createWorkspaceMock(runtime);
  return {
    runtime,
    post: (route: string, body: unknown) =>
      handler(
        new Request(`http://local/api/v2/cases/${workspace.id}/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(body),
        }),
      ),
    handler,
  };
}

for (const [route, limit] of [
  ["messages", 10000],
  ["timeline", 2000],
] as const) {
  test(`mock ${route} accepts the full Unicode contract limit and rejects overflow`, async () => {
    const body =
      route === "messages"
        ? { expectedRevision: 1, text: "😀".repeat(limit), selectedFileIds: [] }
        : { expectedRevision: 1, event: "😀".repeat(limit), date: null, datePrecision: "unknown" };
    const schema = route === "messages" ? v2MessageRequestSchema : v2TimelineEditRequestSchema;
    expect(schema.safeParse(body).success).toBe(true);
    const response = await mockFixture().post(route, body);
    expect(response?.status).toBe(200);
    const overflow =
      route === "messages"
        ? { ...body, text: "a".repeat(limit + 1) }
        : { ...body, event: "a".repeat(limit + 1) };
    expect((await mockFixture().post(route, overflow))?.status).toBe(400);
  });
}

test("a settled mock message preserves an emoji at the generated fact boundary", async () => {
  const f = mockFixture();
  const text = `${"a".repeat(1999)}😀${"b".repeat(20)}`;
  expect(
    (await f.post("messages", { expectedRevision: 1, text, selectedFileIds: [] }))?.status,
  ).toBe(200);
  f.runtime.update((state) => {
    for (const p of Object.values(state.workspace[workspace.id]?.pending ?? {})) p.at = 0;
  });
  await f.handler(new Request(`http://local/api/v2/cases/${workspace.id}/workspace`));
  const state = f.runtime.read();
  expect(state.workspace[workspace.id]?.messages[0]?.text).toBe(text);
  expect(state.cases[workspace.id]?.summaryDetails?.facts.at(-1)?.text).toBe(
    `${"a".repeat(1999)}😀`,
  );
});

function historyFixture() {
  const control = {
    revision: workspace.workspaceRevision,
    fail: false,
    changeDuringRead: false,
    badCursor: false,
    denied: false,
    preserveRecords: false,
  };
  const reads: string[] = [];
  const messages = Array.from({ length: 501 }, (_, i) => ({
    ...userMessage,
    id: `msg_${i}`,
    operationId: `op_${i}`,
    selectedFileIds: [],
    text: `Saved message ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  })).reverse();
  const entries = Array.from({ length: 1001 }, (_, i) => ({
    ...timeline,
    id: `timeline_${String(i).padStart(4, "0")}`,
  }));
  const actions = Array.from({ length: 1001 }, (_, i) => ({
    ...action,
    id: `action_${String(i).padStart(4, "0")}`,
  }));
  async function request(path: string) {
    reads.push(path);
    const url = new URL(path, "http://local");
    if (control.denied) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    if (url.pathname.endsWith("/workspace"))
      return Response.json({ ...workspace, workspaceRevision: control.revision });
    if (url.pathname.endsWith("/intake")) return Response.json(intake);
    if (url.pathname.endsWith("/summary")) return Response.json(summary);
    if (url.pathname.endsWith("/messages")) {
      const cursor = url.searchParams.get("before");
      const offset = cursor ? Number(cursor) : 0;
      if (offset === 500 && control.fail) {
        control.fail = false;
        return Response.json({ error: { code: "UNAVAILABLE", retryable: true } }, { status: 503 });
      }
      if (offset === 500 && control.badCursor)
        return Response.json({ items: [], nextCursor: cursor });
      const all =
        control.preserveRecords || control.revision === workspace.workspaceRevision
          ? messages
          : [{ ...userMessage, id: "new_message", selectedFileIds: [], text: "Changed workspace" }];
      const items = all.slice(offset, offset + 50);
      if (offset === 500 && control.changeDuringRead) {
        control.changeDuringRead = false;
        control.revision++;
      }
      return Response.json({
        items,
        nextCursor: offset + items.length < all.length ? String(offset + items.length) : null,
      });
    }
    if (url.pathname.endsWith("/timeline") || url.pathname.endsWith("/actions")) {
      const all =
        control.preserveRecords || control.revision === workspace.workspaceRevision
          ? url.pathname.endsWith("/timeline")
            ? entries
            : actions
          : [];
      const cursor = url.searchParams.get("after");
      const offset = cursor ? all.findIndex((v) => v.id === cursor) + 1 : 0;
      const items = all.slice(offset, offset + 8);
      return Response.json({
        items,
        nextCursor: offset + items.length < all.length ? items.at(-1)?.id : null,
      });
    }
    if (url.pathname.endsWith("/files")) return Response.json([]);
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  return { control, reads, client: createWorkspaceApi(request, null) };
}

test("bounded workspace reads expose and recover every omitted record without rereading earlier pages", async () => {
  const f = historyFixture();
  const initial = await f.client.get(workspace.id);
  expect([initial.messages.length, initial.timeline.length, initial.actions.length]).toEqual([
    500, 1000, 1000,
  ]);
  expect(initial.pagination).toEqual({ messages: true, timeline: true, actions: true });
  expect(f.reads.filter((p) => p.includes("/messages?")).length).toBe(10);
  let view = await f.client.loadMore(workspace.id, "messages");
  expect(view.messages).toHaveLength(501);
  expect(view.messages[0]?.id).toBe("msg_0");
  expect(view.messages.at(-1)?.id).toBe("msg_500");
  expect(f.reads.filter((p) => p.includes("/messages?")).length).toBe(11);
  view = await f.client.loadMore(workspace.id, "timeline");
  view = await f.client.loadMore(workspace.id, "actions");
  expect([view.messages.length, view.timeline.length, view.actions.length]).toEqual([
    501, 1001, 1001,
  ]);
  expect(view.pagination).toEqual({ messages: false, timeline: false, actions: false });
  expect(new Set(view.timeline.map((v) => v.id)).size).toBe(1001);
  expect(new Set(view.actions.map((v) => v.id)).size).toBe(1001);
  expect((await f.client.get(workspace.id)).messages).toHaveLength(501);
});

test("failed continuation preserves loaded records and the same cursor remains retryable", async () => {
  const f = historyFixture();
  await f.client.get(workspace.id);
  f.control.fail = true;
  await expect(f.client.loadMore(workspace.id, "messages")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect((await f.client.get(workspace.id)).messages).toHaveLength(500);
  expect((await f.client.loadMore(workspace.id, "messages")).messages).toHaveLength(501);
});

test("parallel continuation calls preserve all collections and avoid duplicate messages", async () => {
  const f = historyFixture();
  await f.client.get(workspace.id);
  await Promise.all([
    f.client.loadMore(workspace.id, "messages"),
    f.client.loadMore(workspace.id, "timeline"),
    f.client.loadMore(workspace.id, "messages"),
  ]);
  const view = await f.client.get(workspace.id);
  expect([view.messages.length, view.timeline.length]).toEqual([501, 1001]);
  expect(new Set(view.messages.map((v) => v.id)).size).toBe(501);
});

for (const changeDuringRead of [false, true])
  test(`continuation does not combine different workspace revisions: during read=${changeDuringRead}`, async () => {
    const f = historyFixture();
    await f.client.get(workspace.id);
    if (changeDuringRead) f.control.changeDuringRead = true;
    else f.control.revision++;
    const view = await f.client.loadMore(workspace.id, "messages");
    expect(view.case.revision).toBe(workspace.workspaceRevision + 1);
    expect(view.messages.map((v) => v.id)).toEqual(["new_message"]);
    expect(view.timeline).toHaveLength(0);
  });

test("inconsistent continuation fails promptly and inaccessible resources never return cached records", async () => {
  const f = historyFixture();
  await f.client.get(workspace.id);
  f.control.badCursor = true;
  await expect(f.client.loadMore(workspace.id, "messages")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  f.control.denied = true;
  await expect(f.client.loadMore(workspace.id, "messages")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("a workspace update preserves the ranges the user already opened", async () => {
  const f = historyFixture();
  await f.client.get(workspace.id);
  for (const collection of ["messages", "timeline", "actions"] as const)
    await f.client.loadMore(workspace.id, collection);
  f.control.preserveRecords = true;
  f.control.revision++;
  const updated = await f.client.get(workspace.id);
  expect(updated.case.revision).toBe(workspace.workspaceRevision + 1);
  expect([updated.messages.length, updated.timeline.length, updated.actions.length]).toEqual([
    501, 1001, 1001,
  ]);
  expect(updated.pagination).toEqual({ messages: false, timeline: false, actions: false });
});
