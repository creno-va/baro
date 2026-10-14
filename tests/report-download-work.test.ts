import { afterEach, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { createReportsApi as createReportsClient } from "../src/client/api/reports";
import * as document from "../src/components/reports/document";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { V2_LIMITS, type V2FileProbe, v2CoverageSchema } from "../src/contracts/v2";
import { createReportsApi } from "../src/server/api/v2/reports";
import { saveAccountType } from "../src/server/auth/account-type";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FileStagingRepository } from "../src/server/db/v2-file-staging";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { digest } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService, type PrivateBucket } from "../src/server/modules/files/service";
import * as reportLimits from "../src/server/modules/reports/limits";
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
  | "generate"
  | "zip_first";
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

async function fixture(readyOriginals = false, selectedCount = 4, targetZipBytes?: number) {
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
  let afterGet: ((key: string) => void) | undefined;
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
        afterGet?.(key);
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
  // Actual synthetic original bytes, storage admission and publication. Only
  // probe/coverage contents are explicit offline fixtures, not native/provider
  // processing evidence. The default failed file preserves the existing baseline.
  const inputs = readyOriginals
    ? [
        { path: "text-two-pages.pdf", name: "합성 두 쪽 자료.pdf", mediaType: "application/pdf" },
        {
          path: "text-two-pages.pdf",
          name: "합성 두 쪽 자료 복사본.pdf",
          mediaType: "application/pdf",
        },
        { path: "speech-ko.wav", name: "합성 음성.wav", mediaType: "audio/wav" },
        { path: "image-markers.png", name: "합성 이미지.png", mediaType: "image/png" },
      ]
    : [{ path: "text-two-pages.pdf", name: "합성 두 쪽 자료.pdf", mediaType: "application/pdf" }];
  if (readyOriginals) inputs.splice(selectedCount);
  if (targetZipBytes && inputs[0]) {
    inputs[0].name = "경계 합성자료.txt";
    inputs[0].mediaType = "text/plain";
  }
  const archiveOverhead = inputs.reduce(
    (sum, input) => sum + 92 + 2 * new TextEncoder().encode(input.name).length,
    22,
  );
  const remainingOriginalBytes = await Promise.all(
    inputs
      .slice(1)
      .map(
        async (input) =>
          (await Bun.file(`tests/fixtures/media/${input.path}`).arrayBuffer()).byteLength,
      ),
  );
  f.db.sqlite.exec(
    "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
  );
  let probe: V2FileProbe;
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
        return probe;
      },
    });
  };
  const originals: { id: string; name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const input of inputs) {
    const bytes =
      targetZipBytes && originals.length === 0
        ? new Uint8Array(
            targetZipBytes -
              archiveOverhead -
              remainingOriginalBytes.reduce((sum, n) => sum + n, 0),
          ).fill(83)
        : new Uint8Array(await Bun.file(`tests/fixtures/media/${input.path}`).arrayBuffer());
    probe =
      input.mediaType === "audio/wav"
        ? { category: "audio", format: "wav", durationSeconds: 7.15, byteLength: bytes.length }
        : input.mediaType === "image/png"
          ? { category: "image", format: "png", width: 1000, height: 700, byteLength: bytes.length }
          : {
              category: "document",
              format: input.mediaType === "text/plain" ? "txt" : "pdf",
              pageCount: 2,
              byteLength: bytes.length,
            };
    const upload = await files().reserve(
      actor.ownerId,
      f.workspace.id,
      rev(),
      crypto.randomUUID(),
      {
        name: input.name,
        byteLength: bytes.length,
        mediaType: input.mediaType,
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      },
    );
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += V2_LIMITS.chunkBytes)
      parts.push(
        await files(true).putPart(
          actor.ownerId,
          f.workspace.id,
          upload.fileId,
          upload.uploadSession,
          parts.length,
          new Response(bytes.subarray(offset, offset + V2_LIMITS.chunkBytes)).body,
        ),
      );
    await files().complete(actor.ownerId, f.workspace.id, upload.fileId, {
      expectedRevision: rev(),
      uploadSession: upload.uploadSession,
      manifest: { byteLength: bytes.length, contentHash: await digest(bytes), parts },
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
          quotas: [
            { kind: "visible_ai_response", units: 1, responseKind: "file_interpretation" },
            ...("durationSeconds" in probe
              ? [
                  {
                    kind: "media_processing" as const,
                    originalDurationSeconds: probe.durationSeconds,
                  },
                ]
              : []),
          ],
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
    if (readyOriginals) {
      const coverage = v2CoverageSchema.parse(
        probe.category === "audio"
          ? {
              category: "audio",
              audio: {
                durationSeconds: 7.15,
                status: "partial",
                intervals: [{ startSeconds: 0, endSeconds: 7.15, status: "missing" }],
              },
            }
          : probe.category === "image"
            ? { category: "image", status: "partial", observation: "missing" }
            : {
                category: "document",
                status: "partial",
                pageCount: 2,
                pages: [
                  { page: 1, status: "missing" },
                  { page: 2, status: "missing" },
                ],
              },
      );
      const text = JSON.stringify(coverage),
        id = crypto.randomUUID();
      const g = { ...actor, workspaceId: f.workspace.id, expectedRevision: rev() };
      const staging = createV2StagingRepository(f.core);
      expect(
        await staging.begin(
          g,
          {
            id,
            targetId: upload.fileId,
            revision: 3,
            purpose: "file_coverage",
            partCount: 1,
            byteLength: new TextEncoder().encode(text).length,
          },
          acquired.lease,
        ),
      ).toBe(true);
      expect(await staging.append(g, id, 0, text, acquired.lease)).toBe(true);
      expect(
        await staging.seal(
          g,
          id,
          { schemaVersion: "2", purpose: "file_coverage", targetId: upload.fileId, revision: 3 },
          acquired.lease,
        ),
      ).toBe(true);
      expect(
        await createV2FileStagingRepository(f.core).publish(
          g,
          {
            fileId: upload.fileId,
            fileRevision: 2,
            coverageSnapshotId: id,
            observationCount: 0,
            derivativeCount: 0,
          },
          acquired.lease,
        ),
      ).toBe(true);
    } else {
      expect(await f.jobs.fail(actor, acquired.lease, "BUDGET_UNAVAILABLE", true)).toBe(true);
    }
    originals.push({ id: upload.fileId, name: input.name, bytes });
  }
  expect(await f.service.actions(actor.ownerId, f.workspace.id)).toHaveLength(2);
  expect(await f.service.timeline(actor.ownerId, f.workspace.id)).toHaveLength(1);
  expect((await files().list(actor.ownerId, f.workspace.id)).map((file) => file.status)).toEqual(
    inputs.map(() => (readyOriginals ? "ready" : "failed")),
  );
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
    originals,
    afterGet: (hook: (key: string) => void) => {
      afterGet = hook;
    },
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
  const pdfSpy = spyOn(pdf, "renderReportPdf").mockImplementation(async (...args) => {
    const row = f.active(),
      start = performance.now();
    if (row) row.pdfRender.calls++;
    try {
      return await renderPdf(...args);
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
      { operation: "pdf_first", calls: 103, statements: 126 },
      { operation: "pdf_saved", calls: 35, statements: 35 },
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

/** ZIP STORE entries: parse the actual central directory sizes/offsets, then
 * verify every exported plaintext byte against its selected synthetic original. */
async function assertOriginalZip(
  blob: Blob,
  originals: { name: string; bytes: Uint8Array<ArrayBuffer> }[],
) {
  expect(blob.type).toBe("application/zip");
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  expect(view.getUint16(eocd + 10, true)).toBe(originals.length);
  let offset = view.getUint32(eocd + 16, true);
  for (const original of originals) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const size = view.getUint32(offset + 24, true),
      nameBytes = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameBytes));
    expect(name).toBe(original.name);
    const local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    expect(size).toBe(original.bytes.length);
    expect(await digest(bytes.subarray(start, start + size))).toBe(await digest(original.bytes));
    offset +=
      46 + nameBytes + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  expect(offset).toBe(eocd);
}

for (const selection of [1, 2, 4])
  test(`canonical ${selection}-original ZIP preserves actual source bytes within the unchanged SQL cap`, async () => {
    const f = await fixture(true, selection);
    if (selection === 4)
      expect(f.originals.map((v) => v.bytes.length)).toEqual([25842, 25842, 228846, 21700]);
    const report = await f.client.get(f.workspace.id);
    f.select("zip_first");
    const archive = await f.client.zip(
      report.id,
      f.originals.map((value) => value.id),
    );
    await assertOriginalZip(archive, f.originals);
    const work = f.work.at(-1);
    expect(work?.statements).toBeLessThanOrEqual(800);
    expect(work?.r2).toMatchObject({ get: selection * 3 + 1, put: 2 });
    if (process.env.BARO_REPORT_WORK_METRICS === "true")
      console.info(
        JSON.stringify({
          event: "synthetic_report_zip_work",
          selection,
          operations: f.work.map(({ operation, calls, statements, r2, sqlStages }) => ({
            operation,
            calls,
            statements,
            r2: { get: r2.get, put: r2.put, head: r2.head, delete: r2.delete },
            sqlStages,
          })),
        }),
      );
  });

test("canonical multipart originals retain all source passes inside the current-kernel bound", async () => {
  const f = await fixture(true, 2, 33 * 262144);
  const report = await f.client.get(f.workspace.id);
  expect(f.originals[0]?.bytes.length).toBeGreaterThan(V2_LIMITS.chunkBytes);
  const originalPlan = reportLimits.reportWorkPlan;
  let plannedQueries = 0;
  const observer = spyOn(reportLimits, "reportWorkPlan").mockImplementation((input) => {
    const plan = originalPlan(input);
    if (input.selectedFiles) {
      expect(input.originalParts).toBe(3);
      plannedQueries = plan.queries;
    }
    return plan;
  });
  f.select("zip_first");
  try {
    const archive = await f.client.zip(
      report.id,
      f.originals.map((value) => value.id),
    );
    await assertOriginalZip(archive, f.originals);
    expect(plannedQueries).toBe(730);
    expect(f.work.at(-1)?.statements).toBeLessThanOrEqual(plannedQueries);
    expect(f.work.at(-1)?.r2).toMatchObject({ get: 10, put: 2 });
    if (process.env.BARO_REPORT_WORK_METRICS === "true")
      console.info(
        JSON.stringify({
          event: "synthetic_report_zip_multipart",
          calls: f.work.at(-1)?.calls,
          statements: f.work.at(-1)?.statements,
          plannedQueries,
        }),
      );
  } finally {
    observer.mockRestore();
  }
});

for (const overflow of [false, true])
  test(`canonical four-original ZIP ${overflow ? "rejects one extra archive byte before IO" : "fits the exact 800-query plan across sixteen export chunks"}`, async () => {
    // The real report PDF is five chunks. Eleven ZIP chunks reach exactly800;
    // the next byte creates a twelfth ZIP chunk and must fail before any IO.
    const f = await fixture(true, 4, 11 * 262144 + (overflow ? 1 : 0));
    const report = await f.client.get(f.workspace.id);
    const originalPlan = reportLimits.reportWorkPlan,
      plans: reportLimits.ReportWorkPlan[] = [];
    const observer = spyOn(reportLimits, "reportWorkPlan").mockImplementation((input) => {
      if (input.selectedFiles) {
        expect(Math.ceil(input.pdfBytes / 262144)).toBe(5);
        expect(input.originalParts).toBe(4);
      }
      const result = originalPlan(input);
      plans.push(result);
      return result;
    });
    f.select("zip_first");
    try {
      const operation = f.client.zip(
        report.id,
        f.originals.map((value) => value.id),
      );
      if (overflow) {
        await expect(operation).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
        expect(f.work.at(-1)?.r2).toMatchObject({ get: 0, put: 0, delete: 0 });
      } else {
        const archive = await operation;
        expect(plans[0]?.queries).toBe(800);
        expect(archive.size).toBe(11 * 262144);
        await assertOriginalZip(archive, f.originals);
        expect(f.work.at(-1)?.statements).toBeLessThanOrEqual(800);
      }
      if (process.env.BARO_REPORT_WORK_METRICS === "true")
        console.info(
          JSON.stringify({
            event: "synthetic_report_zip_boundary",
            overflow,
            calls: f.work.at(-1)?.calls,
            statements: f.work.at(-1)?.statements,
          }),
        );
    } finally {
      observer.mockRestore();
    }
  });

for (const revoked of ["owner", "consent", "file", "part"] as const)
  test(`canonical four-original ZIP cannot publish after late ${revoked} change`, async () => {
    const f = await fixture(true);
    const report = await f.client.get(f.workspace.id);
    const first = f.originals[0];
    if (!first) throw new Error("Missing synthetic original");
    const original = f.db.sqlite
      .query<{ object_key: string; upload_id: string }, [string]>(
        "SELECT b.object_key,p.upload_id FROM v2_upload_parts p JOIN v2_upload_sessions u ON u.id=p.upload_id JOIN v2_blobs b ON b.id=p.blob_id WHERE u.file_id=?",
      )
      .get(first.id);
    if (!original) throw new Error("Missing synthetic original part");
    let changed = false;
    f.afterGet((key) => {
      if (changed || key !== original.object_key) return;
      changed = true;
      if (revoked === "owner")
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('account',?,?)")
          .run(f.owner.userId, f.now);
      if (revoked === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      if (revoked === "file")
        f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(first.id, f.now);
      if (revoked === "part")
        f.db.sqlite
          .query("UPDATE v2_upload_parts SET encrypted_payload='changed' WHERE upload_id=?")
          .run(original.upload_id);
    });
    f.select("zip_first");
    await expect(
      f.client.zip(
        report.id,
        f.originals.map((value) => value.id),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(changed).toBe(true);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_reports WHERE id LIKE 'export-%' AND state='ready'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_blobs WHERE kind='original_zip' AND state='stored'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_blobs WHERE kind='original' AND state='stored'")
        .get(),
    ).toEqual({ n: 4 });
    expect(f.work.at(-1)?.r2.put).toBe(1); // PDF completed before the first ZIP read.
    expect(
      f.db.sqlite
        .query("SELECT state,transport FROM v2_execution_admissions WHERE kind='job'")
        .all(),
    ).toEqual([{ state: "final", transport: "response" }]);
  });
