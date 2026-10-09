import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { meApi } from "../src/server/api/me";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";

async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake!.revision,
    answers: intake!.batches[0]!.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  await runCustomerJob(f, "intake_summary");
  const summary = await f.service.intake(f.owner.userId, f.workspace.id);
  await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: summary!.revision,
    summaryRevision: summary!.summary!.revision,
  });
  await runCustomerJob(f, "chat_response");
  const env = { ...f.owner.env, CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") };
  const app = new Hono()
    .route("/api/me", meApi)
    .route("/api/v2/cases", createWorkspacesApi())
    .route("/api/v2/cases", createFilesApi());
  const transport = async (path: string, init?: RequestInit) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.owner.cookie,
          origin: env.BETTER_AUTH_URL,
        },
      },
      env,
    );
  return { ...f, transport };
}

test("timeline: genuine conflict recovers with the same client after refresh", async () => {
  const f = await fixture();
  try {
    const a = createWorkspaceApi(f.transport, null),
      b = createWorkspaceApi(f.transport, null);
    const id = f.workspace.id;
    const initial = await a.get(id),
      entry = initial.timeline[0]!;
    await b.get(id);
    await b.saveTimeline(id, { ...entry, title: "다른 탭에서 저장한 일정" });
    const desired = { ...entry, title: "현재 탭에서 저장할 일정" };
    await expect(a.saveTimeline(id, desired)).rejects.toMatchObject({ code: "CONFLICT" });
    await a.get(id);
    expect((await a.saveTimeline(id, desired)).timeline.find((t) => t.id === entry.id)?.title).toBe(
      desired.title,
    );
    const fresh = createWorkspaceApi(f.transport, null);
    await fresh.get(id);
    expect(
      (await fresh.saveTimeline(id, desired)).timeline.find((t) => t.id === entry.id)?.title,
    ).toBe(desired.title);
  } finally {
    f.db.close();
  }
});

test("action: genuine conflict recovers with the same client after refresh", async () => {
  const f = await fixture();
  try {
    const a = createWorkspaceApi(f.transport, null),
      b = createWorkspaceApi(f.transport, null);
    const id = f.workspace.id;
    const initial = await a.get(id),
      action = initial.actions[0]!;
    await b.get(id);
    await b.setAction(id, action.id, true);
    await b.setAction(id, action.id, false);
    await expect(a.setAction(id, action.id, true)).rejects.toMatchObject({ code: "CONFLICT" });
    await a.get(id);
    expect(
      (await a.setAction(id, action.id, true)).actions.find((t) => t.id === action.id)?.done,
    ).toBe(true);
    const fresh = createWorkspaceApi(f.transport, null);
    await fresh.get(id);
    expect(
      (await fresh.setAction(id, action.id, true)).actions.find((t) => t.id === action.id)?.done,
    ).toBe(true);
  } finally {
    f.db.close();
  }
});

test("a remembered completed job does not mask a newer terminal chat failure on resumed read", async () => {
  const f = await fixture();
  try {
    const old = f.db.sqlite
      .query("SELECT id FROM v2_jobs WHERE kind='chat_response' AND status='completed'")
      .get() as { id: string };
    const failed = await runCustomerJob(f, "chat_response", false);
    expect(failed.result.status).toBe("failed");
    const stored = new Map([[`baro-workspace-job:${f.workspace.id}`, old.id]]);
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
      removeItem: (key: string) => {
        stored.delete(key);
      },
    };
    const resumed = createWorkspaceApi(f.transport, storage);
    const first = await resumed.get(f.workspace.id);
    expect(first.messages.at(-1)).toMatchObject({
      id: `job:${failed.params.jobId}`,
      status: "failed",
      retryable: false,
    });
    expect(first.messages.some((m) => m.status === "failed")).toBe(true);
    const second = await resumed.get(f.workspace.id);
    expect(second.messages.at(-1)).toMatchObject({
      id: `job:${failed.params.jobId}`,
      status: "failed",
    });
    const clean = createWorkspaceApi(f.transport, null);
    expect((await clean.get(f.workspace.id)).messages.at(-1)?.status).toBe("failed");
  } finally {
    f.db.close();
  }
});
