import { expect, test } from "bun:test";
import { ApiError, createFilesClient, reworkReportViewSchema } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { z } from "zod";
import { EXPECTED_OWNER_HEADER } from "../src/contracts/session";
import {
  v2ConversationStateSchema,
  v2QuestionBatchSchema,
  v2SummaryReconciliationSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "../src/contracts/v2";
import { createReworkRuntimeFixture } from "./helpers/rework-runtime-fixture";

type Fixture = Awaited<ReturnType<typeof createReworkRuntimeFixture>>;
const intakeSchema = z.object({
  revision: z.number(),
  batches: z.array(v2QuestionBatchSchema),
  currentJobId: z.string().nullable(),
  summary: z.object({ revision: z.number() }).nullable(),
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test.skipIf(Bun.env.BARO_REWORK_NATIVE_FIXTURE !== "true")(
    `${purpose}: actual native PDF then original ZIP stay fresh within the unchanged report query budget`,
    async () => {
      const f = await createReworkRuntimeFixture({
        browserOrigin: "http://127.0.0.1:4396",
        purpose,
      });
      const scope = createSessionScope();
      try {
        await prepare(f);
        const session = z
          .object({ user: z.object({ id: z.string() }) })
          .parse(await (await f.request("/api/me/session")).json());
        const request = async (path: string, init: RequestInit = {}) => {
          const headers = new Headers(init.headers);
          // The direct Hono transport has no HTTP engine to supply this header.
          if (init.body instanceof ArrayBuffer)
            headers.set("content-length", String(init.body.byteLength));
          headers.set("cookie", `${f.info.ownerCookie.name}=${f.info.ownerCookie.value}`);
          headers.set("origin", "http://127.0.0.1:4396");
          headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(session.user.id));
          const response = await f.fetch(
            new Request(new URL(path, "http://127.0.0.1:4396"), { ...init, headers }),
          );
          if (!response.ok) {
            const error = errorSchema.safeParse(await response.clone().json());
            console.error({
              event: "synthetic_native_http_failure",
              method: init.method ?? "GET",
              status: response.status,
              code: error.success ? error.data.error.code : "INVALID_ERROR_BODY",
            });
          }
          return response;
        };
        const digest = async (bytes: ArrayBuffer) =>
          [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        const files = createFilesClient<File, Uint8Array<ArrayBuffer>>({
          request,
          scope,
          newKey: () => crypto.randomUUID(),
          openUpload: async (source) => ({
            fingerprint: async () => digest(await source.arrayBuffer()),
            part: async (start, end) => {
              const body = await source.slice(start, end).arrayBuffer();
              return { body, byteLength: body.byteLength, contentHash: await digest(body) };
            },
            close() {},
          }),
          download: async (response) => new Uint8Array(await response.arrayBuffer()),
        });
        const text =
          "합성 계약 자료. 약정 원금 3,000,000원. 일부 입금 1,000,000원. 반환일은 미확인입니다.";
        const uploaded = await files.upload(
          f.info.caseId,
          new File([text], "synthetic-runtime-contract.txt", { type: "text/plain" }),
          undefined,
          { metadataOnly: true },
        );
        const ready = await untilAcceptedFileReady(f, uploaded.id, async () =>
          (await files.list(f.info.caseId, { metadataOnly: true })).find(
            (file) => file.id === uploaded.id,
          ),
        );
        expect(ready?.status).toBe("ready");
        expect(new TextDecoder().decode(await files.original(f.info.caseId, uploaded.id))).toBe(
          text,
        );
        const state = await until(
          () => json(f, "/rework/conversation"),
          (value) =>
            value.report.status === "ready" &&
            !!value.snapshot?.includedEvidence.some((e) => e.fileId === uploaded.id),
        );
        if (!state.report.id) throw new Error("SYNTHETIC_REPORT_MISSING");
        const review = await json(f, "/rework/report");
        expect(review.content.length).toBeLessThanOrEqual(30000);
        expect(review.includedPhotoIds ?? []).toEqual([]);
        const pdf = await request(`/api/v2/reports/${state.report.id}/pdf`);
        if (!pdf.ok)
          throw new Error(
            `SYNTHETIC_PDF_HTTP_${pdf.status}_${errorSchema.parse(await pdf.json()).error.code}`,
          );
        const bytes = new Uint8Array(await pdf.arrayBuffer());
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
        expect(bytes.byteLength).toBeGreaterThan(1000);
        const artifactDir = Bun.env.BARO_REPORT_EXPORT_ARTIFACT_DIR
          ? `${Bun.env.BARO_REPORT_EXPORT_ARTIFACT_DIR}/${purpose}`
          : null;
        if (artifactDir) {
          await Bun.write(`${artifactDir}/report.pdf`, bytes);
          const html = await request(`/api/v2/reports/${review.id}/html`);
          expect(html.ok).toBe(true);
          await Bun.write(`${artifactDir}/report.html`, await html.text());
          await Bun.write(`${artifactDir}/review.json`, JSON.stringify(review, null, 2));
        }
        const observed = await stats(f);
        expect(observed.native).toMatchObject({ probe: 1, process: 1, report: 1 });
        expect(observed.artifacts.pdf).toEqual([
          {
            state: "stored",
            total: 1,
            logicalBytes: bytes.byteLength,
            cipherBytes: expect.any(Number),
          },
        ]);
        expect(observed.artifacts.pdf[0]?.cipherBytes).toBeGreaterThan(bytes.byteLength);
        expect(observed.artifacts.reservations).toEqual([
          { state: "stored", total: 1, bytes: expect.any(Number) },
        ]);
        expect(observed.artifacts.pdfBindings).toEqual([
          { state: "held", writerState: "stopped", total: 1, maximumBytes: expect.any(Number) },
        ]);
        expect(observed.artifacts.capacity.heldBytes).toBe(observed.artifacts.totals.heldBytes);
        expect(observed.artifacts.capacity.heldBytes).toBe(
          observed.artifacts.bindings
            .filter((binding) => binding.state === "held")
            .reduce((sum, binding) => sum + binding.maximumBytes, 0),
        );
        expect(observed.modelFailures).toEqual([]);
        expect(observed.backgroundFailures).toEqual([]);
        // Exercise the installed originals path after a completed PDF, with real
        // query accounting, physical permits and encrypted storage receipts.
        // Neither renderer bytes nor report storage admission is replaced.
        const archive = await request(`/api/v2/reports/${review.id}/zip`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ selectedFileIds: [uploaded.id] }),
        });
        if (!archive.ok)
          throw new Error(
            `SYNTHETIC_ZIP_HTTP_${archive.status}_${errorSchema.parse(await archive.json()).error.code}`,
          );
        const archiveBytes = new Uint8Array(await archive.arrayBuffer());
        expect([...archiveBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
        const unpacked = Bun.spawnSync(
          [
            "python3",
            "-c",
            [
              "import io,json,sys,zipfile",
              "with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:",
              " assert archive.testzip() is None",
              " print(json.dumps({name:archive.read(name).hex() for name in archive.namelist()}))",
            ].join("\n"),
          ],
          { stdin: archiveBytes, stdout: "pipe", stderr: "pipe" },
        );
        expect(unpacked.exitCode).toBe(0);
        expect(JSON.parse(new TextDecoder().decode(unpacked.stdout))).toEqual({
          "synthetic-runtime-contract.txt": Buffer.from(text).toString("hex"),
        });
        const exported = await stats(f);
        if (artifactDir) {
          await Bun.write(`${artifactDir}/originals.zip`, archiveBytes);
          await Bun.write(
            `${artifactDir}/receipts.json`,
            JSON.stringify(
              {
                synthetic: true,
                pdfSha256: await digest(bytes.buffer),
                zipSha256: await digest(archiveBytes.buffer),
                zipRequestQueriesIncludingMiddleware: exported.queries - observed.queries,
                artifacts: exported.artifacts,
              },
              null,
              2,
            ),
          );
        }
        const afterZip = await json(f, "/rework/report"),
          afterZipState = await json(f, "/rework/conversation");
        expect({ id: afterZip.id, revision: afterZip.revision, stale: afterZip.stale }).toEqual({
          id: review.id,
          revision: review.revision,
          stale: false,
        });
        expect(afterZip.content).toBe(review.content);
        expect(afterZip.basis).toEqual(review.basis);
        expect(afterZipState.analysis.status).toBe("ready");
        expect(afterZipState.report.status).toBe("ready");
        const zipStats = await stats(f);
        expect(zipStats.native).toMatchObject({ probe: 1, process: 1, report: 2 });
        expect(zipStats.artifacts.pdf).toEqual([
          {
            state: "stored",
            total: 2,
            logicalBytes: expect.any(Number),
            cipherBytes: expect.any(Number),
          },
        ]);
        expect(zipStats.artifacts.pdfBindings).toEqual([
          {
            state: "held",
            writerState: "stopped",
            total: 2,
            maximumBytes: expect.any(Number),
          },
        ]);
        expect(zipStats.models).toEqual(observed.models);
        expect(zipStats.sources).toBe(observed.sources);
        // These are local D1 reads; unlike model/source calls they must occur.
        expect(zipStats.queries).toBeGreaterThan(observed.queries);
        expect(zipStats.artifacts.capacity.heldBytes).toBe(zipStats.artifacts.totals.heldBytes);
        expect(zipStats.artifacts.capacity.heldBytes).toBe(
          zipStats.artifacts.bindings
            .filter((binding) => binding.state === "held")
            .reduce((sum, binding) => sum + binding.maximumBytes, 0),
        );
        expect(
          zipStats.artifacts.bindings.every((binding) => binding.writerState === "stopped"),
        ).toBe(true);
        expect(zipStats.modelFailures).toEqual([]);
        expect(zipStats.backgroundFailures).toEqual([]);
      } finally {
        scope.invalidate();
        await f.close();
      }
    },
    180000,
  );
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const statsSchema = z.object({
  models: z.array(z.string()),
  sources: z.number(),
  queries: z.number(),
  reports: z.object({ total: z.number() }),
  modelFailures: z.array(z.unknown()),
  backgroundFailures: z.array(z.string()),
  native: z.unknown().nullable(),
  artifacts: z.object({
    pdf: z.array(
      z.object({
        state: z.string(),
        total: z.number(),
        logicalBytes: z.number(),
        cipherBytes: z.number(),
      }),
    ),
    reservations: z.array(z.object({ state: z.string(), total: z.number(), bytes: z.number() })),
    pdfBindings: z.array(
      z.object({
        state: z.string(),
        writerState: z.string(),
        total: z.number(),
        maximumBytes: z.number(),
      }),
    ),
    capacity: z.object({ capacityBytes: z.number(), heldBytes: z.number() }),
    totals: z.object({ heldBytes: z.number() }),
    bindings: z.array(
      z.object({
        state: z.string(),
        writerState: z.string(),
        total: z.number(),
        maximumBytes: z.number(),
      }),
    ),
  }),
});
const readers = {
  "/workspace": v2WorkspaceSchema,
  "/intake": intakeSchema,
  "/summary": v2SummarySchema,
  "/rework/summary-reconciliation": v2SummaryReconciliationSchema,
  "/rework/conversation": v2ConversationStateSchema(),
  "/rework/report": reworkReportViewSchema,
};
function json<K extends keyof typeof readers>(
  f: Fixture,
  path: K,
): Promise<z.output<(typeof readers)[K]>>;
function json(f: Fixture, path: string, input: unknown, method?: string): Promise<unknown>;
async function json(f: Fixture, path: string, input?: unknown, method?: string) {
  const response = await f.request(`/api/v2/cases/${f.info.caseId}${path}`, input, method);
  const value = await response.json();
  if (!response.ok)
    throw new Error(`SYNTHETIC_HTTP_${response.status}_${errorSchema.parse(value).error.code}`);
  expect(response.ok).toBe(true);
  return input === undefined ? readers[path as keyof typeof readers].parse(value) : value;
}
async function stats(f: Fixture) {
  const response = await f.control(new Request("http://127.0.0.1:4396/__rework-test/stats"));
  if (!response?.ok) throw new Error("SYNTHETIC_STATS_MISSING");
  return statsSchema.parse(await response.json());
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch (cause) {
      // A concurrent publication can invalidate a readonly snapshot. Preserve
      // the CAS/auth guard and retry only that finite read conflict.
      if (!(cause instanceof Error) || cause.message !== "SYNTHETIC_HTTP_409_STALE_REVISION")
        throw cause;
    }
    await Bun.sleep(10);
  }
  throw new Error("SYNTHETIC_FIXTURE_WAIT_LIMIT");
}
async function untilAcceptedFileReady<T extends { id: string; status: string }>(
  f: Fixture,
  acceptedFileId: string,
  read: () => Promise<T | undefined>,
) {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      const value = await read();
      lastFailure = undefined;
      if (value && value.id !== acceptedFileId) throw new Error("SYNTHETIC_FILE_MISMATCH");
      if (value?.status === "ready" || value?.status === "failed") return value;
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== "UNAVAILABLE" || !cause.retryable)
        throw cause;
      const response = await f.control(new Request("http://127.0.0.1:4396/__rework-test/stats"));
      if (!response?.ok) throw cause;
      const { jobs } = z
        .object({
          jobs: z.array(
            z.object({ kind: z.string(), status: z.string(), total: z.number().int().positive() }),
          ),
        })
        .parse(await response.json());
      // This fresh case accepts exactly this one file. Its single admitted file
      // job must still be active; a completed/failed/missing job cannot justify
      // retrying a storage failure. Other reads/mutations never use this path.
      const fileJobs = jobs.filter((job) => job.kind === "file_processing");
      if (
        fileJobs.reduce((sum, job) => sum + job.total, 0) !== 1 ||
        !fileJobs.every((job) => ["queued", "running", "validating"].includes(job.status))
      )
        throw cause;
      lastFailure = cause;
    }
    await Bun.sleep(10);
  }
  if (lastFailure) throw lastFailure;
  throw new Error("SYNTHETIC_FILE_WAIT_LIMIT");
}
async function prepare(f: Fixture) {
  for (let round = 0; round < 2; round++) {
    const workspace = await json(f, "/workspace");
    await json(f, "/intake/advance", { expectedRevision: workspace.workspaceRevision });
    const intake = await until(
      () => json(f, "/intake"),
      (value) => value.batches.length === round + 1 && !value.currentJobId,
    );
    const batch = intake.batches[round];
    if (!batch) throw new Error("SYNTHETIC_QUESTION_BATCH_MISSING");
    expect(batch.questions).toHaveLength(3);
    await json(
      f,
      "/intake/answers",
      {
        expectedRevision: intake.revision,
        answers: batch.questions.map((q: { id: string }, index: number) => ({
          questionId: q.id,
          status: index === 0 ? "skipped" : "unknown",
        })),
      },
      "PUT",
    );
  }
  const workspace = await json(f, "/workspace");
  await json(f, "/intake/advance", { expectedRevision: workspace.workspaceRevision });
  await until(
    () => json(f, "/intake"),
    (value) => !!value.summary && !value.currentJobId,
  );
  const before = await json(f, "/summary"),
    current = await json(f, "/workspace");
  await json(f, "/rework/summary-reconciliation/request", {
    expectedRevision: current.workspaceRevision,
    summaryRevision: before.revision,
    kind: "addition",
    explanation: f.info.reconciliationExplanation,
  });
  const proposed = await until(
    () => json(f, "/rework/summary-reconciliation"),
    (value) => value.status === "proposed" || value.status === "failed",
  );
  expect(proposed.status).toBe("proposed");
  if (!proposed.proposal) throw new Error("SYNTHETIC_PROPOSAL_MISSING");
  expect((await json(f, "/summary")).revision).toBe(before.revision);
  await json(f, "/rework/summary-reconciliation/confirm", {
    expectedRevision: proposed.workspaceRevision,
    proposalId: proposed.proposal.id,
    summaryRevision: proposed.proposal.baseSummaryRevision,
  });
  const state = await until(
    () => json(f, "/rework/conversation"),
    (value) => value.report.status === "ready",
  );
  const summary = await json(f, "/summary");
  expect(summary.revision).toBe(before.revision + 1);
  expect(summary.unknowns).toHaveLength(6);
  expect(summary.facts.at(-1)?.text).toBe(f.info.reconciliationExplanation);
  expect(state.caseContext.procedure.stage).toBe("unconfirmed");
  return state;
}
