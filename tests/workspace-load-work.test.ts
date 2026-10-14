import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { casesApi } from "../src/client/api/cases";
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
import { seedTestSession } from "./helpers/session";

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
  | "confirm"
  | "latest_job";
type RequestWork = {
  route: Route;
  method: string;
  calls: number;
  statements: number;
  startedMs: number;
  headersMs: number;
  completedMs: number;
  queryFamilies: string[][];
};
const round = (n: number) => Math.round(n * 1000) / 1000;
function queryFamily(sql: string) {
  if (sql.startsWith("SELECT coalesce(") && sql.includes("AS current_consent"))
    return "customer_access";
  const table = /\bfrom\s+["`]?([a-z0-9_]+)/i.exec(sql)?.[1]?.toLowerCase();
  if (table === "session") return "auth_session";
  if (table === "user") return "auth_user";
  if (table === "app_metadata" || table === "v2_role_bindings") return "account_role";
  if (table === "user_consents") return "current_consent";
  if (table === "v2_tombstones") return "account_tombstone";
  return "domain";
}

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
  let beforeSql: (statements: string[]) => void = () => {};
  let afterSql: (statements: string[]) => void = () => {};
  const transport = async (path: string, init?: RequestInit) => {
    if (!path.startsWith("/api/")) throw new Error("Unexpected external request");
    const suffix = path.split("/").slice(5).join("/").split("?")[0];
    const route: Route =
      path === "/api/me/session"
        ? "session"
        : suffix === "workspace-jobs/latest"
          ? "latest_job"
          : suffix === "summary/confirm"
            ? "confirm"
            : suffix?.startsWith("timeline")
              ? "timeline"
              : suffix?.startsWith("actions")
                ? "actions"
                : ["workspace", "intake", "messages", "actions", "files", "summary"].includes(
                      suffix ?? "",
                    )
                  ? (suffix as Route)
                  : (() => {
                      throw new Error("Unexpected synthetic route");
                    })();
    const meter = countD1Calls(f.db.binding);
    meter.before((statements) => {
      row.queryFamilies.push(statements.map(queryFamily));
      beforeSql(statements);
    });
    meter.after((statements) => afterSql(statements));
    const row: RequestWork = {
      route,
      method: init?.method ?? "GET",
      calls: 0,
      statements: 0,
      startedMs: performance.now() - start,
      headersMs: 0,
      completedMs: 0,
      queryFamilies: [],
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
    transport,
    beforeSql: (hook: typeof beforeSql) => {
      beforeSql = hook;
    },
    afterSql: (hook: typeof afterSql) => {
      afterSql = hook;
    },
    session,
    client,
    view,
    reset: () => {
      rows.length = 0;
      start = performance.now();
    },
  };
}

test("canonical summary read, save and confirmation separate fresh authorization from domain work", async () => {
  const f = await fixture();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((path, init) => f.transport(String(path), init)) as typeof fetch;
  try {
    let item = await casesApi.get(f.workspace.id);
    for (const operation of ["focus", "save", "confirm", "reload"] as const) {
      f.reset();
      if (operation === "focus" || operation === "reload") await f.session();
      await f.session();
      item =
        operation === "save"
          ? await casesApi.saveSummary(f.workspace.id, {
              expectedRevision: item.revision,
              summary: "확인 상태와 실제 사용자 사실을 유지하는 합성 요약 수정입니다.",
            })
          : operation === "confirm"
            ? await casesApi.confirmSummary(f.workspace.id, { expectedRevision: item.revision })
            : await casesApi.get(f.workspace.id);
      await f.session();
      expect(item.summaryDetails).toBeDefined();
      if (operation === "save") expect(item.stage).toBe("summary");
      if (operation === "confirm") expect(item.stage).toBe("active");
      expect(f.rows.every((row) => row.calls === row.queryFamilies.length)).toBe(true);
      if (process.env.BARO_WORKSPACE_ACCESS_METRICS === "true")
        console.info(
          JSON.stringify({
            event: "synthetic_summary_access_work",
            operation,
            http: f.rows.length,
            calls: f.rows.reduce((sum, row) => sum + row.calls, 0),
            statements: f.rows.reduce((sum, row) => sum + row.statements, 0),
            routes: f.rows.map(({ route, method, calls, statements, queryFamilies }) => ({
              route,
              method,
              calls,
              statements,
              queryFamilies,
            })),
          }),
        );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

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
        calls: method === "POST" ? 11 : 12,
        statements: method === "POST" ? 18 : 19,
      },
      { route: "workspace", method: "GET", calls: 5, statements: 5 },
      { route: "intake", method: "GET", calls: 8, statements: 9 },
      { route: "messages", method: "GET", calls: 10, statements: 10 },
      { route: "actions", method: "GET", calls: 10, statements: 10 },
      { route: "timeline", method: "GET", calls: 10, statements: 10 },
      { route: "files", method: "GET", calls: 8, statements: 8 },
      { route: "summary", method: "GET", calls: 14, statements: 14 },
      { route: "workspace", method: "GET", calls: 5, statements: 5 },
      { route: "latest_job", method: "GET", calls: 6, statements: 6 },
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

test("canonical action save retains the full readback and both session checks", async () => {
  const f = await fixture();
  const action = f.view.actions[0];
  if (!action) throw new Error("Missing synthetic action");
  f.reset();
  await f.session();
  const next = await f.client.setAction(f.workspace.id, action.id, true);
  await f.session();
  expect(next.actions.find((value) => value.id === action.id)?.done).toBe(true);
  expect(next.case.revision).toBe(f.view.case.revision + 1);
  // Same synthetic fixture before these two query merges: 100 calls / 112 SQL.
  expect(f.rows).toHaveLength(12);
  expect(f.rows.find((row) => row.method === "PUT")).toMatchObject({ calls: 13, statements: 20 });
  expect(f.rows.find((row) => row.route === "latest_job")).toMatchObject({
    calls: 6,
    statements: 6,
  });
  expect(f.rows.reduce((sum, row) => sum + row.calls, 0)).toBe(95);
  expect(f.rows.reduce((sum, row) => sum + row.statements, 0)).toBe(107);
  if (process.env.BARO_WORKSPACE_LOAD_METRICS === "true")
    console.info(
      JSON.stringify({
        event: "synthetic_workspace_action_work",
        http: f.rows.length,
        calls: f.rows.reduce((sum, row) => sum + row.calls, 0),
        statements: f.rows.reduce((sum, row) => sum + row.statements, 0),
      }),
    );
});

test("warm focus keeps the same request and session boundaries", async () => {
  const f = await fixture();
  f.reset();
  await f.session(); // Focus verification.
  await f.session(); // The load preflight.
  expect(await f.client.get(f.workspace.id)).toEqual(f.view);
  await f.session(); // The final render verification.
  // Before the latest-job merge: 34 calls / 40 SQL at these exact boundaries.
  expect(f.rows).toHaveLength(7);
  expect(f.rows.reduce((sum, row) => sum + row.calls, 0)).toBe(33);
  expect(f.rows.reduce((sum, row) => sum + row.statements, 0)).toBe(39);
  if (process.env.BARO_WORKSPACE_LOAD_METRICS === "true")
    console.info(
      JSON.stringify({
        event: "synthetic_workspace_focus_work",
        http: f.rows.length,
        calls: f.rows.reduce((sum, row) => sum + row.calls, 0),
        statements: f.rows.reduce((sum, row) => sum + row.statements, 0),
      }),
    );
});

function entityRequest(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: "actions" | "timeline",
  missing = false,
) {
  const value = kind === "actions" ? f.view.actions[0] : f.view.timeline[0];
  if (!value) throw new Error("Missing synthetic entity");
  const id = missing ? crypto.randomUUID() : value.id;
  const body =
    kind === "actions"
      ? { expectedRevision: 1, status: "done" }
      : { expectedRevision: 1, date: null, datePrecision: "unknown", event: "수정한 합성 일정" };
  return {
    id,
    path: `/api/v2/cases/${f.workspace.id}/${kind}/${id}`,
    init: {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body),
    },
  };
}

for (const kind of ["actions", "timeline"] as const) {
  test(`${kind} account deletion immediately before the access snapshot remains HTTP 404`, async () => {
    const f = await fixture();
    const input = entityRequest(f, kind);
    let changed = false;
    f.beforeSql((statements) => {
      if (changed || !statements.some((sql) => sql.includes("AS current_consent"))) return;
      changed = true;
      f.db.sqlite
        .query("INSERT INTO v2_tombstones VALUES('account',?,?)")
        .run(f.owner.userId, f.now);
    });
    expect((await f.transport(input.path, input.init)).status).toBe(404);
    expect(changed).toBe(true);
    expect(
      f.db.sqlite.query(`SELECT revision FROM v2_${kind} WHERE entity_id=?`).get(input.id),
    ).toEqual({ revision: 1 });
  });

  test(`${kind} missing entity remains HTTP 404 without a write receipt`, async () => {
    const f = await fixture();
    const input = entityRequest(f, kind, true);
    expect((await f.transport(input.path, input.init)).status).toBe(404);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_idempotency WHERE key=?")
        .get(input.init.headers["idempotency-key"]),
    ).toEqual({ n: 0 });
  });

  test(`${kind} still rechecks owner deletion after the fresh workspace decrypt`, async () => {
    const f = await fixture();
    const input = entityRequest(f, kind);
    let workspaceReads = 0;
    f.afterSql((statements) => {
      if (!statements.some((sql) => sql.startsWith("SELECT w.* FROM v2_workspaces"))) return;
      if (++workspaceReads !== 2) return; // mutation() snapshot, then the fresh guard snapshot.
      f.db.sqlite
        .query("INSERT INTO v2_tombstones VALUES('account',?,?)")
        .run(f.owner.userId, f.now);
    });
    expect((await f.transport(input.path, input.init)).status).toBe(404);
    expect(workspaceReads).toBe(2);
    expect(
      f.db.sqlite.query(`SELECT revision FROM v2_${kind} WHERE entity_id=?`).get(input.id),
    ).toEqual({ revision: 1 });
  });

  for (const change of ["owner", "account", "workspace", "revision", "current-job"] as const)
    test(`${kind} keeps the final atomic write fence after its fresh snapshot: ${change}`, async () => {
      const f = await fixture();
      const peer = await seedTestSession(f.db, { consent: true });
      const input = entityRequest(f, kind);
      const before = f.db.sqlite
        .query(`SELECT revision,encrypted_payload FROM v2_${kind} WHERE entity_id=?`)
        .get(input.id);
      let changed = false;
      f.beforeSql((statements) => {
        if (changed || !statements.some((sql) => sql.startsWith("INSERT INTO v2_mutation_claims")))
          return;
        changed = true;
        if (change === "owner")
          f.db.sqlite
            .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
            .run(peer.userId, f.workspace.id);
        if (change === "account" || change === "workspace")
          f.db.sqlite
            .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
            .run(change, change === "account" ? f.owner.userId : f.workspace.id, f.now);
        if (change === "revision")
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.workspace.id);
        if (change === "current-job")
          f.db.sqlite
            .query(
              "UPDATE v2_workspaces SET current_job_id=(SELECT id FROM v2_jobs WHERE workspace_id=? AND target_kind='workspace' LIMIT 1) WHERE id=?",
            )
            .run(f.workspace.id, f.workspace.id);
      });
      const response = await f.transport(input.path, input.init);
      expect(changed).toBe(true);
      expect(response.status).toBe(409);
      expect(
        f.db.sqlite
          .query(`SELECT revision,encrypted_payload FROM v2_${kind} WHERE entity_id=?`)
          .get(input.id),
      ).toEqual(before);
      expect(
        f.db.sqlite
          .query("SELECT count(*) n FROM v2_idempotency WHERE key=?")
          .get(input.init.headers["idempotency-key"]),
      ).toEqual({ n: 0 });
    });
}

test("latest workspace job keeps exact revision/time/id order and excludes newer file jobs", async () => {
  const f = await fixture();
  const path = `/api/v2/cases/${f.workspace.id}/workspace-jobs/latest`;
  const query =
    "SELECT id FROM v2_jobs WHERE workspace_id=? AND target_kind='workspace' ORDER BY target_revision DESC,created_at DESC,id DESC LIMIT 1";
  const read = async () => {
    const response = await f.transport(path);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      id: string;
      target: { kind: string };
      status: string;
      phase: string;
    };
  };
  f.db.sqlite
    .query("UPDATE v2_jobs SET target_revision=999 WHERE workspace_id=? AND target_kind='file'")
    .run(f.workspace.id);
  expect((await read()).id).toBe(
    (f.db.sqlite.query(query).get(f.workspace.id) as { id: string }).id,
  );
  // Equal revisions must still use created_at, and equal timestamps use descending ID.
  f.db.sqlite
    .query("UPDATE v2_jobs SET target_revision=10 WHERE workspace_id=? AND target_kind='workspace'")
    .run(f.workspace.id);
  expect((await read()).id).toBe(
    (f.db.sqlite.query(query).get(f.workspace.id) as { id: string }).id,
  );
  f.db.sqlite
    .query("UPDATE v2_jobs SET created_at=? WHERE workspace_id=? AND target_kind='workspace'")
    .run(f.now, f.workspace.id);
  const expected = (f.db.sqlite.query(query).get(f.workspace.id) as { id: string }).id;
  expect(await read()).toMatchObject({ id: expected, target: { kind: "workspace" } });
  f.beforeSql((statements) => {
    if (
      statements.some(
        (sql) => sql.startsWith("SELECT j.*") && sql.includes("ORDER BY j.target_revision"),
      )
    )
      f.db.sqlite
        .query("UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0 WHERE id=?")
        .run(expected);
  });
  expect(await read()).toMatchObject({ id: expected, status: "cancelled" });
});

test("latest job preserves null for no jobs and HTTP 404 for absent or foreign workspaces", async () => {
  const f = await fixture();
  const empty = await f.service.create(f.owner.userId, crypto.randomUUID(), {
    narrative: "아직 작업을 접수하지 않은 별도 합성 사건입니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
  const response = await f.transport(`/api/v2/cases/${empty.id}/workspace-jobs/latest`);
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
  expect(
    (await f.transport(`/api/v2/cases/${crypto.randomUUID()}/workspace-jobs/latest`)).status,
  ).toBe(404);
  const peer = await seedTestSession(f.db, { consent: true });
  f.db.sqlite.query("UPDATE v2_workspaces SET owner_id=? WHERE id=?").run(peer.userId, empty.id);
  expect((await f.transport(`/api/v2/cases/${empty.id}/workspace-jobs/latest`)).status).toBe(404);
});

test("latest job observes account deletion at its combined selection and DTO read", async () => {
  const f = await fixture();
  let changed = false;
  f.beforeSql((statements) => {
    if (
      !statements.some(
        (sql) => sql.startsWith("SELECT j.*") && sql.includes("ORDER BY j.target_revision"),
      )
    )
      return;
    changed = true;
    f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('account',?,?)").run(f.owner.userId, f.now);
  });
  const response = await f.transport(`/api/v2/cases/${f.workspace.id}/workspace-jobs/latest`);
  expect(changed).toBe(true);
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});
