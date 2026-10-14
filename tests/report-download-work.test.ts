import { afterEach, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { createReportsApi as createReportsClient } from "../src/client/api/reports";
import * as document from "../src/components/reports/document";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createReportsApi } from "../src/server/api/v2/reports";
import { saveAccountType } from "../src/server/auth/account-type";
import { createV2Core } from "../src/server/db/v2-core";
import { digest } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService, type PrivateBucket } from "../src/server/modules/files/service";
import * as pdf from "../src/server/modules/reports/pdf";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { REPORT_SOURCE_SQL } from "../src/server/modules/reports/source";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";

// Canonical Hono/client/SQL/AES/render and false-mode admission paths. Only
// model/probe setup, R2/font and missing native D1 row metadata are offline.
// Durations are local adapter wall time, not Cloudflare or browser evidence.

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
type Operation =
  | "get_initial"
  | "save_review"
  | "get_saved"
  | "pdf_first"
  | "pdf_saved"
  | "html"
  | "generate";
type Stage =
  | "source_rows"
  | "export_fence"
  | "stored_fence"
  | "workspace"
  | "report_access"
  | "snapshot_header"
  | "snapshot_parts"
  | "intake"
  | "entities"
  | "files"
  | "storage"
  | "auth"
  | "other";
type Work = {
  operation: Operation;
  method: string;
  calls: number;
  statements: number;
  databaseAdapterMs: number;
  headersMs: number;
  completeMs: number;
  bodyBytes: number;
  pdfRender: { calls: number; milliseconds: number };
  htmlRender: { calls: number; milliseconds: number };
  fontAdapter: { calls: number; milliseconds: number };
  // PUT includes consuming the encrypted producer and its fresh stream fences;
  // adapter durations can overlap database work and must not be added together.
  r2: { get: number; put: number; head: number; delete: number; milliseconds: number };
  sqlStages: Partial<Record<Stage, number>>;
};
function stage(sql: string): Stage {
  if (sql === REPORT_SOURCE_SQL) return "source_rows";
  if (sql.startsWith("WITH source AS")) return "export_fence";
  if (sql.startsWith("SELECT 1 FROM v2_reports r JOIN v2_workspaces")) return "stored_fence";
  if (sql.startsWith("SELECT r.* FROM v2_reports")) return "report_access";
  if (/^(SELECT|WITH)/.test(sql)) {
    if (sql.includes("FROM v2_private_parts")) return "snapshot_parts";
    if (sql.includes("FROM v2_private_snapshots")) return "snapshot_header";
    if (sql.includes("FROM v2_intakes")) return "intake";
    if (/FROM v2_(actions|timeline|messages|facts|parties)/.test(sql)) return "entities";
    if (sql.includes("FROM v2_workspaces")) return "workspace";
    if (sql.includes("FROM v2_files")) return "files";
  }
  if (/v2_(blobs|storage|physical|execution|paid|runtime)/.test(sql)) return "storage";
  if (/\b(session|user_consents|app_metadata)\b/.test(sql) && !sql.includes("v2_")) return "auth";
  return "other";
}
/** Offline SQLite method duration, never D1 server SQL duration. Each invocation
 * is measured separately so concurrent promises cannot share a start/stop pair. */
function measuredDatabase(database: D1Database, work: Work): D1Database {
  const originals = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; sql: string }
  >();
  async function observed<T>(sql: string[], call: () => Promise<T>) {
    work.calls++;
    work.statements += sql.length;
    for (const text of sql) {
      const key = stage(text);
      work.sqlStages[key] = (work.sqlStages[key] ?? 0) + 1;
    }
    const start = performance.now();
    try {
      return await call();
    } finally {
      work.databaseAdapterMs += performance.now() - start;
    }
  }
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      all: <T>() => observed([sql], () => statement.all<T>()),
      run: <T>() => observed([sql], () => statement.run<T>()),
      first: <T>(column?: string) =>
        observed([sql], () =>
          column === undefined ? statement.first<T>() : statement.first<T>(column),
        ),
      raw: <T>(options?: { columnNames?: boolean }) =>
        observed<T[] | [string[], ...T[]]>([sql], () =>
          options?.columnNames ? statement.raw<T>({ columnNames: true }) : statement.raw<T>(),
        ),
    } as D1PreparedStatement;
    originals.set(result, { statement, sql });
    return result;
  };
  return {
    prepare: (sql: string) => wrap(database.prepare(sql), sql),
    batch: <T>(statements: D1PreparedStatement[]) => {
      const values = statements.map((s) => {
        const original = originals.get(s);
        if (!original) throw new Error("Missing synthetic measured statement");
        return original;
      });
      return observed(
        values.map((s) => s.sql),
        () => database.batch<T>(values.map((s) => s.statement)),
      );
    },
  } as D1Database;
}

async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  await saveAccountType(f.db.binding, f.owner.userId, "customer");
  for (let round = 0; round < 2; round++) {
    expect((await runCustomerJob(f, "intake_questions", true, undefined, 3)).result.status).toBe(
      "completed",
    );
    const intake = await f.service.intake(f.owner.userId, f.workspace.id),
      batch = intake?.batches.at(-1);
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
  const rev = () =>
    Number(
      (
        f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.workspace.id) as {
          revision: number;
        }
      ).revision,
    );
  // The canonical seed creates consent just after its input clock is captured.
  // Real storage checks that consent already existed at admission time.
  f.now = new Date().toISOString();
  const actor = { ownerId: f.owner.userId, now: f.now };
  const actions = await f.service.actions(f.owner.userId, f.workspace.id);
  if (!actions[0]) throw new Error("Missing synthetic action");
  expect(
    await f.repository.writeAction(
      { ...actor, workspaceId: f.workspace.id, expectedRevision: rev() },
      {
        ...actions[0],
        id: crypto.randomUUID(),
        revision: 1,
        title: "추가 자료 사본 보관",
        instructions: "합성 자료의 사본을 보관하세요.",
      },
      null,
    ),
  ).toBe(true);

  let active: Work | undefined;
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const r2Call = async <T>(kind: "get" | "put" | "head" | "delete", call: () => Promise<T>) => {
    const row = active,
      start = performance.now();
    if (row) row.r2[kind]++;
    try {
      return await call();
    } finally {
      if (row) row.r2.milliseconds += performance.now() - start;
    }
  };
  const bucket = {
    put: (key: string, input: BodyInit) =>
      r2Call("put", async () => {
        const value = new Uint8Array(await new Response(input).arrayBuffer());
        objects.set(key, value);
        return { key, size: value.byteLength };
      }),
    get: (key: string) =>
      r2Call("get", async () => {
        const value = objects.get(key);
        return value
          ? { key, size: value.byteLength, body: new Response(value.slice()).body }
          : null;
      }),
    head: (key: string) =>
      r2Call("head", async () => {
        const value = objects.get(key);
        return value ? { key, size: value.byteLength } : null;
      }),
    delete: (key: string) =>
      r2Call("delete", async () => {
        objects.delete(key);
      }),
  } as unknown as PrivateBucket;
  // Setup only: actual local synthetic PDF bytes, repository upload and failed
  // processing lease. No real native/provider work is claimed for this fixture.
  const original = new Uint8Array(
    await Bun.file("tests/fixtures/media/text-two-pages.pdf").arrayBuffer(),
  );
  f.db.sqlite.exec(
    "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
  );
  const files = (part = false) => {
    const base = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
    const core = part ? fileStorageRequestCore(base, false) : base;
    return createFilesService(core, {
      environment: "preview",
      bucket,
      clock: () => f.now,
      paidStorage: createFileStorageBudget(core, "preview", actor.ownerId, () => f.now),
      probe: async (input) => {
        await new Response(input.open()).arrayBuffer();
        return { category: "document", format: "pdf", byteLength: input.byteLength, pageCount: 2 };
      },
    });
  };
  const upload = await files().reserve(actor.ownerId, f.workspace.id, rev(), crypto.randomUUID(), {
    name: "합성 두 쪽 자료.pdf",
    byteLength: original.length,
    mediaType: "application/pdf",
    autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  });
  const part = await files(true).putPart(
    actor.ownerId,
    f.workspace.id,
    upload.fileId,
    upload.uploadSession,
    0,
    new Response(original).body,
  );
  await files().complete(actor.ownerId, f.workspace.id, upload.fileId, {
    expectedRevision: rev(),
    uploadSession: upload.uploadSession,
    manifest: { byteLength: original.length, contentHash: await digest(original), parts: [part] },
  });
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitFile(
      { ...actor, workspaceId: f.workspace.id, expectedRevision: rev() },
      {
        fileId: upload.fileId,
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
  expect(await f.service.actions(actor.ownerId, f.workspace.id)).toHaveLength(2);
  expect(await f.service.timeline(actor.ownerId, f.workspace.id)).toHaveLength(1);
  expect(await files().list(actor.ownerId, f.workspace.id)).toMatchObject([
    { id: upload.fileId, status: "failed" },
  ]);
  const font = new Uint8Array(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer());
  const app = new Hono().route(
    "/api/v2",
    createReportsApi({
      testOnlyMissingD1Meta: true,
      dependencies: async (env, core, ownerId) => {
        const dependencies = createReportDependencies(env, core, ownerId, () => f.now);
        return {
          ...dependencies,
          font: async () => {
            const row = active,
              start = performance.now();
            if (row) row.fontAdapter.calls++;
            try {
              return await dependencies.font();
            } finally {
              if (row) row.fontAdapter.milliseconds += performance.now() - start;
            }
          },
          fixedLength: (body) => ({ body, done: Promise.resolve() }),
        };
      },
    }),
  );
  let operation: Operation = "get_initial";
  const work: Work[] = [];
  const transport = async (path: string, init?: RequestInit) => {
    if (!path.startsWith("/api/v2/")) throw new Error("Unexpected external request");
    const row: Work = {
      operation,
      method: init?.method ?? "GET",
      calls: 0,
      statements: 0,
      databaseAdapterMs: 0,
      headersMs: 0,
      completeMs: 0,
      bodyBytes: 0,
      pdfRender: { calls: 0, milliseconds: 0 },
      htmlRender: { calls: 0, milliseconds: 0 },
      fontAdapter: { calls: 0, milliseconds: 0 },
      r2: { get: 0, put: 0, head: 0, delete: 0, milliseconds: 0 },
      sqlStages: {},
    };
    work.push(row);
    active = row;
    const start = performance.now();
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
        APP_ENV: "preview",
        DB: measuredDatabase(f.db.binding, row),
        CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
        APPLICATION_COST_LIMITS_ENABLED: "false",
        CASE_PRIVATE_R2: bucket,
        ASSETS: { fetch: async () => new Response(font.slice()) },
      },
    );
    row.headersMs = performance.now() - start;
    const reader = response.body?.getReader();
    const finish = () => {
      row.completeMs = performance.now() - start;
      active = undefined;
    };
    if (!reader) {
      finish();
      return response;
    }
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              finish();
              controller.close();
            } else {
              row.bodyBytes += next.value.byteLength;
              controller.enqueue(next.value);
            }
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
    const output = new Response(body, { status: response.status, headers: response.headers });
    // Bun 1.3.14 drops the MIME on Response(ReadableStream).blob(). Preserve
    // the actual HTTP header as browser fetch does; consume the actual bytes.
    output.blob = async () =>
      new Blob([await output.arrayBuffer()], {
        type: output.headers.get("content-type") ?? "",
      });
    return output;
  };
  return {
    ...f,
    work,
    client: createReportsClient(transport),
    select: (value: Operation) => {
      operation = value;
    },
    active: () => active,
  };
}

test("canonical report v2 read/review/PDF/HTML separates database, render and offline storage work", async () => {
  const f = await fixture();
  const renderPdf = pdf.renderReportPdf,
    renderHtml = document.createReportHtml;
  const pdfSpy = spyOn(pdf, "renderReportPdf").mockImplementation((...args) => {
    const row = f.active(),
      start = performance.now();
    if (row) row.pdfRender.calls++;
    try {
      return renderPdf(...args);
    } finally {
      if (row) row.pdfRender.milliseconds += performance.now() - start;
    }
  });
  const htmlSpy = spyOn(document, "createReportHtml").mockImplementation((...args) => {
    const row = f.active(),
      start = performance.now();
    if (row) row.htmlRender.calls++;
    try {
      return renderHtml(...args);
    } finally {
      if (row) row.htmlRender.milliseconds += performance.now() - start;
    }
  });
  try {
    const initial = await f.client.get(f.workspace.id);
    expect(initial.revision).toBe(1);
    expect(initial.content).toContain("추가 자료 사본 보관");
    expect(initial.content).toContain("합성 두 쪽 자료.pdf");
    f.select("save_review");
    const reviewed = await f.client.save(f.workspace.id, {
      content: `${initial.content}\n합성 검토 완료 문장입니다.`,
      maskIdentifiers: false,
      excludedFileIds: [],
    });
    expect(reviewed.revision).toBe(2);
    f.select("get_saved");
    expect((await f.client.get(f.workspace.id)).content).toBe(reviewed.content);
    f.select("pdf_first");
    const first = await f.client.pdf(reviewed.id);
    expect(first.size).toBeGreaterThan(1000);
    f.select("pdf_saved");
    const retained = await f.client.pdf(reviewed.id);
    expect(await retained.arrayBuffer()).toEqual(await first.arrayBuffer());
    f.select("html");
    const html = await f.client.html(reviewed.id);
    expect(await html.text()).toContain("합성 검토 완료 문장입니다.");
    f.select("generate");
    expect((await f.client.generate(f.workspace.id)).revision).toBe(3);
    expect(f.work).toHaveLength(7);
    expect(
      f.work.map(({ operation, calls, statements }) => ({ operation, calls, statements })),
    ).toEqual([
      { operation: "get_initial", calls: 65, statements: 86 },
      { operation: "save_review", calls: 77, statements: 98 },
      { operation: "get_saved", calls: 18, statements: 18 },
      { operation: "pdf_first", calls: 139, statements: 165 },
      { operation: "pdf_saved", calls: 48, statements: 49 },
      { operation: "html", calls: 17, statements: 17 },
      { operation: "generate", calls: 66, statements: 87 },
    ]);
    expect(f.work.find((row) => row.operation === "pdf_first")?.pdfRender.calls).toBe(1);
    expect(f.work.find((row) => row.operation === "pdf_saved")?.pdfRender.calls).toBe(0);
    expect(f.work.find((row) => row.operation === "html")?.htmlRender.calls).toBe(1);
    expect(f.work.reduce((n, row) => n + row.r2.put, 0)).toBe(1);
    expect(
      f.db.sqlite
        .query("SELECT state,transport FROM v2_execution_admissions WHERE kind='job'")
        .all(),
    ).toEqual([{ state: "final", transport: "response" }]);
    if (process.env.BARO_REPORT_WORK_METRICS === "true")
      console.info(
        JSON.stringify({
          event: "synthetic_report_download_work",
          operations: f.work.map((row) =>
            JSON.parse(
              JSON.stringify(row, (_, value) =>
                typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
              ),
            ),
          ),
        }),
      );
  } finally {
    pdfSpy.mockRestore();
    htmlSpy.mockRestore();
  }
});
