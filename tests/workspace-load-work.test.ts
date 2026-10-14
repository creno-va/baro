import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { meApi } from "../src/server/api/me";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { saveAccountType } from "../src/server/auth/account-type";
import { createFilesService } from "../src/server/modules/files/service";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { hasCustomerWorkspaceAccess } from "../src/server/runtime/workspace";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { countD1Calls } from "./helpers/d1-call-count";
import { r2, uploaded } from "./helpers/file-processing-fixture";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type Route =
  | "session"
  | "workspace"
  | "intake"
  | "messages"
  | "actions"
  | "timeline"
  | "files"
  | "summary"
  | "latest_job";
type RequestWork = {
  route: Route;
  method: string;
  calls: number;
  statements: number;
  startedMs: number;
  headersMs: number;
  completedMs: number;
};
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Actual Hono/AES/SQLite contracts and client get/save path; synthetic provider/R2 only.
 * Local call counts and wall time are not remote D1 SQL time or browser measurements. */
async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  await saveAccountType(f.db.binding, f.owner.userId, "customer");
  for (let round = 0; round < 2; round++) {
    expect((await runCustomerJob(f, "intake_questions", true, undefined, 3)).result.status).toBe(
      "completed",
    );
    const intake = await f.service.intake(f.owner.userId, f.workspace.id);
    const batch = intake?.batches.at(-1);
    if (!intake || !batch) throw new Error("Missing synthetic questions");
    await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: batch.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
    });
  }
  expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
  await confirmCustomerSummary(f);
  expect((await runCustomerJob(f, "chat_response")).result.status).toBe("completed");
  await confirmCustomerSummary(f);

  const bucket = r2();
  const files = createFilesService(f.core, {
    environment: "preview",
    bucket: bucket.port,
    testOnlyUnmeteredStorage: true,
    clock: () => f.now,
    probe: async (input) => {
      await new Response(input.open()).arrayBuffer();
      return { category: "document", format: "txt", byteLength: input.byteLength, pageCount: 2 };
    },
  });
  const rev = () =>
    Number(
      (
        f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.workspace.id) as {
          revision: number;
        }
      ).revision,
    );
  const actor = { ownerId: f.owner.userId, now: f.now };
  const upload = await uploaded({
    service: files,
    actor,
    // The canonical create helper generated this ID with crypto.randomUUID().
    workspaceId: f.workspace.id as ReturnType<typeof crypto.randomUUID>,
    rev,
  });
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitFile(
      { ...actor, workspaceId: f.workspace.id, expectedRevision: rev() },
      {
        fileId: upload.session.fileId,
        fileRevision: 2,
        jobId,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: "a".repeat(64),
        },
        quotas: [{ kind: "visible_ai_response", units: 1, responseKind: "file_interpretation" }],
      },
    ),
  ).toBe(true);
  const acquired = await f.jobs.acquire(
    actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.now) + 300000).toISOString(),
  );
  if (!acquired) throw new Error("Missing synthetic file lease");
  expect(await f.jobs.fail(actor, acquired.lease, "BUDGET_UNAVAILABLE", true)).toBe(true);
  // Make this synthetic audit refusal the exact newest workspace job.
  f.now = new Date(Date.parse(f.now) + 1000).toISOString();
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  const legalJobId = crypto.randomUUID();
  expect(
    await f.jobs.admitWorkspace(
      {
        ownerId: f.owner.userId,
        now: f.now,
        workspaceId: f.workspace.id,
        expectedRevision: current.workspaceRevision,
      },
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "b".repeat(64) },
      legalJobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          expectedRevision: current.workspaceRevision,
          text: "국가법령정보센터 주택임대차보호법 제3조의2를 확인해 주세요.",
          selectedFileIds: [],
        },
      },
    ),
  ).toBe(true);
  const refused = await executeWorkspace(
    f.core,
    {
      ownerId: f.owner.userId,
      workspaceId: f.workspace.id,
      workspaceRevision: current.workspaceRevision + 1,
      jobId: legalJobId,
    },
    `${legalJobId}-1`,
    {
      clock: () => f.now,
      authorize: (ownerId) => hasCustomerWorkspaceAccess(f.core, ownerId),
      pipeline: async () =>
        createWorkspacePipeline(
          {
            call: async (phase) => {
              if (phase === "workspace_chat")
                return {
                  text: "공식 법령 원문을 확인하지 못했습니다.",
                  references: [],
                  facts: [],
                  parties: [],
                  actions: [],
                  timeline: [],
                  requestedSources: [],
                  warnings: [],
                };
              if (phase === "workspace_audit")
                return {
                  pass: false,
                  legalClaimsSupported: false,
                  strategyDetected: false,
                  unsupportedFactIds: [],
                  findings: [{ severity: "critical", code: "unsupported_legal_claim" }],
                };
              throw new Error("Unexpected synthetic provider phase");
            },
          },
          { reserve: async () => true, invocation: () => crypto.randomUUID() },
        ),
    },
  );
  expect(refused).toMatchObject({ status: "failed", policyReason: "audit_rejected" });

  const app = new Hono()
    .route("/api/me", meApi)
    .route("/api/v2/cases", createWorkspacesApi())
    .route("/api/v2/cases", createFilesApi());
  const rows: RequestWork[] = [];
  let start = performance.now();
  const transport = async (path: string, init?: RequestInit) => {
    if (!path.startsWith("/api/")) throw new Error("Unexpected external request");
    const suffix = path.split("/").slice(5).join("/").split("?")[0];
    const route: Route =
      path === "/api/me/session"
        ? "session"
        : suffix === "workspace-jobs/latest"
          ? "latest_job"
          : suffix?.startsWith("timeline")
            ? "timeline"
            : ["workspace", "intake", "messages", "actions", "files", "summary"].includes(
                  suffix ?? "",
                )
              ? (suffix as Route)
              : (() => {
                  throw new Error("Unexpected synthetic route");
                })();
    const meter = countD1Calls(f.db.binding);
    const row: RequestWork = {
      route,
      method: init?.method ?? "GET",
      calls: 0,
      statements: 0,
      startedMs: performance.now() - start,
      headersMs: 0,
      completedMs: 0,
    };
    rows.push(row);
    const response = await app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.owner.cookie,
          origin: f.owner.env.BETTER_AUTH_URL,
        },
      },
      {
        ...f.owner.env,
        DB: meter.binding,
        CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
        APPLICATION_COST_LIMITS_ENABLED: "false",
      },
    );
    row.headersMs = performance.now() - start;
    const finish = () => Object.assign(row, meter.work, { completedMs: performance.now() - start });
    const reader = response.body?.getReader();
    if (!reader) {
      finish();
      return response;
    }
    // Count streamed summary D1 reads through body completion, not just headers.
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              finish();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            finish();
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel();
          finish();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const session = async () => {
    const response = await transport("/api/me/session");
    expect(response.ok).toBe(true);
    const current = (await response.json()) as {
      user: { id: string; accountType: string };
      needsConsent: boolean;
    };
    expect(current.user.id).toBe(f.owner.userId);
    expect(current.user.accountType).toBe("customer");
    expect(current.needsConsent).toBe(false);
  };
  await session();
  const client = createWorkspaceApi(transport, null);
  const view = await client.get(f.workspace.id);
  expect(view.case.stage).toBe("active");
  expect(view.files).toHaveLength(1);
  expect(view.files[0]?.status).toBe("failed");
  expect(
    view.messages.filter((m) => m.role === "assistant" && m.status === "complete"),
  ).toHaveLength(1);
  expect(view.messages.filter((m) => m.role === "assistant" && m.status === "failed")).toHaveLength(
    1,
  );
  expect(view.timeline.length).toBeGreaterThan(0);
  return {
    ...f,
    rows,
    session,
    client,
    view,
    reset: () => {
      rows.length = 0;
      start = performance.now();
    },
  };
}

test("canonical timeline save measures the complete client readback and final session check", async () => {
  const f = await fixture();
  let before = f.view;
  for (const method of ["POST", "PUT"] as const) {
    f.reset();
    // The successful Workspace.run/saveEntry path checks session before writing
    // and after saveTimeline's full get(). No UI authorization fence is skipped.
    await f.session();
    const entry =
      method === "PUT"
        ? before.timeline.find((entry) => entry.title === "합성 추가 일정")
        : undefined;
    if (method === "PUT" && !entry?.revision) throw new Error("Missing saved synthetic timeline");
    const after = await f.client.saveTimeline(f.workspace.id, {
      ...(entry ? { id: entry.id } : {}),
      expectedRevision: entry?.revision ?? before.case.revision,
      date: "2026-10-01",
      datePrecision: "day",
      title: "합성 추가 일정",
      detail: method === "PUT" ? "수정한 합성 내용" : "처음 저장한 합성 내용",
    });
    await f.session();
    expect(after.case.revision).toBe(before.case.revision + 1);
    expect(after.timeline.find((entry) => entry.title === "합성 추가 일정")?.detail).toBe(
      method === "PUT" ? "수정한 합성 내용" : "처음 저장한 합성 내용",
    );
    expect(f.rows).toHaveLength(12);
    expect(f.rows.filter((row) => row.method !== "GET")).toHaveLength(1);
    const write = f.rows.find((row) => row.method === method);
    if (!write) throw new Error("Missing measured write");
    expect(f.rows.at(-1)?.route).toBe("session");
    expect(f.rows.filter((row) => row.startedMs >= write.completedMs)).toHaveLength(10);
    expect(
      f.rows.map(({ route, method, calls, statements }) => ({ route, method, calls, statements })),
    ).toEqual([
      { route: "session", method: "GET", calls: 3, statements: 5 },
      {
        route: "timeline",
        method,
        calls: method === "POST" ? 13 : 16,
        statements: method === "POST" ? 20 : 23,
      },
      { route: "workspace", method: "GET", calls: 5, statements: 5 },
      { route: "intake", method: "GET", calls: 8, statements: 9 },
      { route: "messages", method: "GET", calls: 10, statements: 10 },
      { route: "actions", method: "GET", calls: 10, statements: 10 },
      { route: "timeline", method: "GET", calls: 10, statements: 10 },
      { route: "files", method: "GET", calls: 8, statements: 8 },
      { route: "summary", method: "GET", calls: 18, statements: 19 },
      { route: "workspace", method: "GET", calls: 5, statements: 5 },
      { route: "latest_job", method: "GET", calls: 7, statements: 7 },
      { route: "session", method: "GET", calls: 3, statements: 5 },
    ]);
    if (process.env.BARO_WORKSPACE_LOAD_METRICS === "true")
      console.info(
        JSON.stringify({
          event: "synthetic_workspace_load_work",
          method,
          http: f.rows.length,
          calls: f.rows.reduce((n, row) => n + row.calls, 0),
          statements: f.rows.reduce((n, row) => n + row.statements, 0),
          acknowledgementMs: round(write.completedMs),
          completeMs: round(f.rows.at(-1)?.completedMs ?? 0),
          routes: f.rows.map((row) => ({
            ...row,
            startedMs: round(row.startedMs),
            headersMs: round(row.headersMs),
            completedMs: round(row.completedMs),
          })),
        }),
      );
    before = after;
  }
});
