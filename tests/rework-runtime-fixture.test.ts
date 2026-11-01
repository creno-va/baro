import { expect, test } from "bun:test";
import { createFilesClient, createWorkspaceClient, reworkReportViewSchema } from "@baro/api-client";
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

test.skipIf(Bun.env.BARO_REWORK_NATIVE_FIXTURE !== "true")(
  "actual upload/processing/R2 original and Docker PDF preserve product admission and bytes",
  async () => {
    const f = await createReworkRuntimeFixture({
      browserOrigin: "http://127.0.0.1:4396",
      purpose: "prepare_claim",
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
      expect(uploaded.uploadContentHash).toBe(await digest(await new Blob([text]).arrayBuffer()));
      const ready = await until(
        async () =>
          (await files.list(f.info.caseId, { metadataOnly: true })).find(
            (file) => file.id === uploaded.id,
          ),
        (value) => value?.status === "ready" || value?.status === "failed",
      );
      expect(ready?.status).toBe("ready");
      expect(ready?.uploadContentHash).toBe(uploaded.uploadContentHash);
      expect(new TextDecoder().decode(await files.original(f.info.caseId, uploaded.id))).toBe(text);
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
      await Bun.write("/tmp/baro-625-runtime-report.pdf", bytes);
      const afterPdf = await json(f, "/rework/report");
      const afterPdfState = await json(f, "/rework/conversation");
      const metadata = (value: typeof review) => ({
        id: value.id,
        revision: value.revision,
        stale: value.stale,
        basis: value.basis,
        analysisReview: value.analysisReview,
      });
      const preparation = (value: typeof state) => ({
        workspaceRevision: value.workspaceRevision,
        summaryConfirmed: value.summaryConfirmed,
        analysis: { status: value.analysis.status, basis: value.analysis.basis },
        report: value.report,
      });
      await Bun.write(
        "/tmp/baro-625-runtime-pdf-basis.json",
        JSON.stringify(
          {
            synthetic: true,
            before: metadata(review),
            after: metadata(afterPdf),
            beforeConversation: preparation(state),
            afterConversation: preparation(afterPdfState),
          },
          null,
          2,
        ),
      );
      expect({ id: afterPdf.id, revision: afterPdf.revision, stale: afterPdf.stale }).toEqual({
        id: review.id,
        revision: review.revision,
        stale: false,
      });
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
      await Bun.write(
        "/tmp/baro-625-runtime-receipts.json",
        JSON.stringify({ pdfSha256: await digest(bytes.buffer), ...observed.artifacts }, null, 2),
      );
      expect(observed.modelFailures).toEqual([]);
      expect(observed.backgroundFailures).toEqual([]);
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
async function prepare(f: Fixture, options: { reconcile?: boolean } = {}) {
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
  if (options.reconcile === false) {
    await json(f, "/summary/confirm", {
      expectedRevision: before.intakeRevision,
      summaryRevision: before.revision,
      workspaceRevision: current.workspaceRevision,
    });
    return until(
      () => json(f, "/rework/conversation"),
      (value) => value.report.status === "ready",
    );
  }
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
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: current-clock signed Hono intake/reconciliation/automatic sources/report and passive reads`, async () => {
    const f = await createReworkRuntimeFixture({
      browserOrigin: "http://127.0.0.1:4396",
      purpose,
      native: "unavailable",
    });
    try {
      const state = await prepare(f);
      if (!state.report.id) throw new Error("SYNTHETIC_REPORT_MISSING");
      expect(state.analysis.status).toBe("ready");
      if (!state.snapshot) throw new Error("SYNTHETIC_ANALYSIS_MISSING");
      expect(state.snapshot.citations.map((c: { kind: string }) => c.kind).sort()).toEqual([
        "precedent",
        "statute",
      ]);
      const before = await stats(f);
      for (let read = 0; read < 3; read++) {
        expect((await json(f, "/rework/conversation")).report.id).toBe(state.report.id);
        expect((await json(f, "/rework/report")).id).toBe(state.report.id);
      }
      const after = await stats(f);
      expect(after.models).toEqual(before.models);
      expect(after.sources).toBe(before.sources);
      expect(after.reports.total).toBe(1);
      expect(after.modelFailures).toEqual([]);
      expect(after.backgroundFailures).toEqual([]);
      expect(after.native).toBeNull();
    } finally {
      await f.close();
    }
  });

for (const scenario of [
  { intent: null, text: "현재 기록을 다시 읽어주세요." },
  { intent: "analyze_legal", text: "관련 판례 보여줘" },
  { intent: "prepare_report", text: "보고서 만들어줘" },
  { intent: "add_material", text: "계약서 올릴게" },
] as const)
  test(`an audited ${scenario.intent ?? "ordinary"} conversation without case changes preserves analysis/report and starts no research`, async () => {
    const f = await createReworkRuntimeFixture({
      browserOrigin: "http://127.0.0.1:4396",
      purpose: "prepare_claim",
      native: "unavailable",
    });
    try {
      const state = await prepare(f, { reconcile: false });
      const before = await stats(f);
      const current = await json(f, "/workspace");
      await json(f, "/messages", {
        expectedRevision: current.workspaceRevision,
        text: scenario.text,
        selectedFileIds: [],
      });
      expect(
        (
          await f.control(
            new Request("http://127.0.0.1:4396/__rework-test/settle", {
              method: "POST",
              body: "{}",
            }),
          )
        )?.ok,
      ).toBe(true);
      const after = await stats(f);
      expect(after.models.slice(before.models.length)).toEqual([
        "workspace_chat",
        "workspace_audit",
      ]);
      expect(after.sources).toBe(before.sources);
      expect(after.reports.total).toBe(before.reports.total);
      const currentState = await json(f, "/rework/conversation");
      expect(currentState.snapshot?.id).toBe(state.snapshot?.id);
      expect(currentState.analysis.status).toBe("ready");
      expect(currentState.report.id).toBe(state.report.id);
      expect(currentState.intents.map((value) => value.intent)).toEqual(
        scenario.intent ? [scenario.intent] : [],
      );
      if (scenario.intent) {
        expect(currentState.intents[0]?.workspaceRevision).toBe(currentState.workspaceRevision);
        expect(currentState.intents[0]?.workspaceRevision).toBe(current.workspaceRevision + 2);
      }
    } finally {
      await f.close();
    }
  });

test("the installed workspace facade reads a completed private analysis without requiring a chat reply", async () => {
  const f = await createReworkRuntimeFixture({
    browserOrigin: "http://127.0.0.1:4396",
    purpose: "prepare_claim",
    native: "unavailable",
  });
  const scope = createSessionScope();
  try {
    const state = await prepare(f, { reconcile: false });
    const session = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await (await f.request("/api/me/session")).json());
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", `${f.info.ownerCookie.name}=${f.info.ownerCookie.value}`);
      headers.set("origin", f.browserOrigin);
      headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(session.user.id));
      return Promise.resolve(
        f.fetch(new Request(new URL(path, f.browserOrigin), { ...init, headers })),
      );
    };
    const files = createFilesClient<never, never>({
      request,
      scope,
      newKey: () => crypto.randomUUID(),
      openUpload: async () => {
        throw new Error("SYNTHETIC_READ_ONLY_CLIENT");
      },
      download: async () => {
        throw new Error("SYNTHETIC_READ_ONLY_CLIENT");
      },
    });
    const client = createWorkspaceClient({
      request,
      scope,
      newKey: () => crypto.randomUUID(),
      listFiles: (id, options) => files.list(id, options),
    });
    const before = await stats(f);
    expect((await json(f, "/workspace")).currentJobId).toBeNull();
    const latest = await request(`/api/v2/cases/${f.info.caseId}/workspace-jobs/latest`);
    expect(latest.ok).toBe(true);
    expect(await latest.json()).toBeNull();
    const workspace = await client.get(f.info.caseId);
    expect(workspace.case.id).toBe(f.info.caseId);
    expect(workspace.case.stage).toBe("active");
    expect(workspace.messages.some((message) => message.id.startsWith("job:"))).toBe(false);
    expect((await json(f, "/rework/conversation")).report.id).toBe(state.report.id);
    const after = await stats(f);
    expect(after.models).toEqual(before.models);
    expect(after.sources).toBe(before.sources);
  } finally {
    scope.invalidate();
    await f.close();
  }
});

test("an unavailable official source gives a limited report and passive reads do not retry it", async () => {
  const f = await createReworkRuntimeFixture({
    browserOrigin: "http://127.0.0.1:4396",
    purpose: "respond_to_claim",
    sourceMode: "failure",
    native: "unavailable",
  });
  try {
    const state = await prepare(f);
    expect(state.analysis.status).not.toBe("ready");
    expect(state.snapshot?.status).toBe("unavailable");
    expect(state.snapshot?.citations).toEqual([]);
    expect(state.snapshot?.availability.every((source) => source.status === "unavailable")).toBe(
      true,
    );
    const report = await json(f, "/rework/report");
    expect(report.analysisReview?.status).not.toBe("ready");
    expect(report.content).toMatch(/(확인|제한|미확인)/);
    const before = await stats(f);
    await json(f, "/rework/conversation");
    await json(f, "/rework/report");
    const after = await stats(f);
    expect(after.sources).toBe(before.sources);
    expect(after.models).toEqual(before.models);
    expect(after.reports.total).toBe(1);
  } finally {
    await f.close();
  }
});

test("synthetic prior AI200 admission, foreign owner and revoked consent use the actual SQL/auth guards", async () => {
  const f = await createReworkRuntimeFixture({
    browserOrigin: "http://127.0.0.1:4396",
    purpose: "prepare_claim",
    native: "unavailable",
  });
  try {
    const state = await prepare(f),
      session = z
        .object({ user: z.object({ id: z.string() }) })
        .parse(await (await f.request("/api/me/session")).json());
    const foreign = await f.fetch(
      new Request(`http://127.0.0.1:4396/api/v2/cases/${f.info.caseId}/rework/conversation`, {
        headers: {
          cookie: `${f.info.foreignCookie.name}=${f.info.foreignCookie.value}`,
          origin: "http://127.0.0.1:4396",
          [EXPECTED_OWNER_HEADER]: encodeURIComponent(session.user.id),
        },
      }),
    );
    expect(foreign.ok).toBe(false);
    const prior = await stats(f);
    expect(
      (
        await f.control(
          new Request("http://127.0.0.1:4396/__rework-test/quota", { method: "POST", body: "{}" }),
        )
      )?.ok,
    ).toBe(true);
    const workspace = await json(f, "/workspace");
    const denied = await f.request(`/api/v2/cases/${f.info.caseId}/messages`, {
      expectedRevision: workspace.workspaceRevision,
      text: "현재 기록을 다시 읽어주세요.",
      selectedFileIds: [],
    });
    expect(denied.status).toBe(429);
    expect(errorSchema.parse(await denied.json()).error.code).toBe("USER_QUOTA_EXCEEDED");
    const after = await stats(f);
    expect(after.models).toEqual(prior.models);
    await f.control(
      new Request("http://127.0.0.1:4396/__rework-test/withdraw-consent", {
        method: "POST",
        body: "{}",
      }),
    );
    expect((await json(f, "/rework/conversation")).report.id).toBe(state.report.id);
    const noWrite = await f.request(`/api/v2/cases/${f.info.caseId}/rework/actions`, {
      action: "prepare_report",
      requestId: crypto.randomUUID(),
      expectedRevision: workspace.workspaceRevision,
    });
    expect(noWrite.status).toBe(403);
    expect(errorSchema.parse(await noWrite.json()).error.code).toBe("CONSENT_REQUIRED");
  } finally {
    await f.close();
  }
});
