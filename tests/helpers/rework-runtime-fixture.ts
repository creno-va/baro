import { Hono } from "hono";
import { z } from "zod";
import { modelBounds } from "../../scripts/provision-ai-budget";
import { EXPECTED_OWNER_HEADER } from "../../src/contracts/session";
import { v2CaseContextViewSchema, v2ReworkCreateCaseResponseSchema } from "../../src/contracts/v2";
import { api } from "../../src/server/api";
import type { ApiEnvironment } from "../../src/server/api/errors";
import { createFilesApi } from "../../src/server/api/v2/files";
import { createReportsApi } from "../../src/server/api/v2/reports";
import { createReworkApi } from "../../src/server/api/v2/rework";
import { createWorkspacesApi } from "../../src/server/api/v2/workspaces";
import { createCaseDataCipher } from "../../src/server/crypto";
import { usageDateKst } from "../../src/server/db/repository";
import { createV2Core } from "../../src/server/db/v2-core";
import { createFileProcessingRuntime } from "../../src/server/modules/budget/processing-runtime";
import type { FileProcessingParams } from "../../src/server/modules/file-processing/execution";
import { runFileProcessing } from "../../src/server/modules/file-processing/runner";
import { createFileStorageBudget } from "../../src/server/modules/files/runtime";
import { createCaseReportDependencies } from "../../src/server/modules/reports/runtime";
import type { ReportDependencies } from "../../src/server/modules/reports/storage";
import { createReworkRuntime } from "../../src/server/modules/rework/runtime";
import type { WorkspaceParams } from "../../src/server/modules/workspace/execution";
import { createFileProcessingAdmission } from "../../src/server/runtime/file-admission";
import {
  createWorkspaceDependencies,
  runWorkspaceRuntime,
} from "../../src/server/runtime/workspace";
import { createTestDatabase, testEnvironment } from "./d1";
import observation from "./gemini-observation";
import {
  createSyntheticLegalTransport,
  type SyntheticLegalRequest,
} from "./legal-analysis-fixture";
import { syntheticLegalDraft, syntheticLegalPlan } from "./legal-analysis-model-fixture";
import { createReworkNativeModel } from "./rework-native-model";
import { seedTestSession } from "./session";

/** R2 transport only: actual encrypted product bytes and exact write receipts. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const counters = { get: 0, head: 0, put: 0, delete: 0 };
  const port = {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array> | string,
    ) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value.slice(0))
            : ArrayBuffer.isView(value)
              ? new Uint8Array(
                  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
                )
              : new Uint8Array(await new Response(value).arrayBuffer());
      counters.put++;
      objects.set(key, bytes as Uint8Array<ArrayBuffer>);
      return { key, size: bytes.byteLength };
    },
    async get(key: string) {
      counters.get++;
      const bytes = objects.get(key);
      return bytes ? { key, size: bytes.byteLength, body: new Response(bytes.slice()).body } : null;
    },
    async head(key: string) {
      counters.head++;
      const bytes = objects.get(key);
      return bytes ? { key, size: bytes.byteLength } : null;
    },
    async delete(key: string | string[]) {
      for (const entry of typeof key === "string" ? [key] : key) {
        counters.delete++;
        objects.delete(entry);
      }
    },
  };
  return { port: port as unknown as R2Bucket, objects, counters };
}

/** Workers FixedLengthStream semantics on the local stream transport. No
 * unmetered storage, fabricated PDF or completed write is supplied. */
export const checkedFixedLength: NonNullable<ReportDependencies["fixedLength"]> = (body, size) => {
  let count = 0;
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      count += chunk.byteLength;
      if (count > size) throw new Error("SYNTHETIC_FIXED_LENGTH_MISMATCH");
      controller.enqueue(chunk);
    },
    flush() {
      if (count !== size) throw new Error("SYNTHETIC_FIXED_LENGTH_MISMATCH");
    },
  });
  const done = body.pipeTo(stream.writable);
  void done.catch(() => undefined);
  return {
    body: stream.readable,
    done,
    abort: async () => {
      await stream.readable.cancel().catch(() => undefined);
    },
  };
};

/** Independent infrastructure, prior to the central API/main gate. Product
 * runtime imports and case creation are connected only after that gate. */
export async function createReworkFixtureInfrastructure(browserOrigin: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(browserOrigin))
    throw new Error("REWORK_FIXTURE_LOOPBACK_ONLY");
  const db = await createTestDatabase();
  const now = Date.now();
  const owner = await seedTestSession(db, { now, consent: true });
  const foreign = await seedTestSession(db, { now, consent: true });
  const bucket = memoryBucket();
  const env = {
    ...testEnvironment(db.binding),
    APP_ENV: "preview",
    BETTER_AUTH_URL: browserOrigin,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("q".repeat(32)).replace(/=+$/, ""),
    AI_GATEWAY_ID: "synthetic-rework",
    LAW_API_OC: "synthetic-official-transport-only",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(
      modelBounds(
        {
          ...observation,
          checkedAt: new Date(now).toISOString(),
          validUntil: new Date(now + 3600000).toISOString(),
        },
        "a".repeat(64),
      ),
    ),
    CASE_PRIVATE_R2: bucket.port,
    ASSETS: {
      async fetch(request: Request | string) {
        const path = new URL(typeof request === "string" ? request : request.url).pathname;
        if (path !== "/fonts/BaroReport-Regular.ttf") return new Response(null, { status: 404 });
        return new Response(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer(), {
          headers: { "content-type": "font/ttf" },
        });
      },
    },
    CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
    )
    .run();
  const core = createV2Core(db.binding, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  return { db, env, core, owner, foreign, bucket };
}

/** Full production factories; only external provider/Workflow/storage transports
 * are local. Must be consumed after all named predecessor PRs pass CI/main. */
export async function createReworkRuntimeFixture(options: {
  browserOrigin: string;
  purpose: "prepare_claim" | "respond_to_claim";
  sourceMode?: "ready" | "empty" | "failure";
  /** Explicit unavailable external native port; never a fake processing result. */
  native?: "enabled" | "unavailable";
}) {
  const f = await createReworkFixtureInfrastructure(options.browserOrigin);
  const sourceRequests: SyntheticLegalRequest[] = [];
  const legalOptions = {
    mode: options.sourceMode ?? "ready",
    onRequest: (r: SyntheticLegalRequest) => sourceRequests.push(r),
  };
  const transport = createSyntheticLegalTransport(legalOptions);
  const model = createReworkNativeModel({
    respond: (phase, data) => {
      if (phase === "workspace_legal_plan") return syntheticLegalPlan(data);
      if (phase === "workspace_legal_analysis") return syntheticLegalDraft(data);
      if (phase === "workspace_legal_audit")
        return {
          pass: true,
          findings: [],
          unsupportedFactIds: [],
          legalClaimsSupported: true,
          strategyDetected: false,
        };
      throw new Error("SYNTHETIC_NATIVE_PHASE_UNSUPPORTED");
    },
  });
  const processor =
    options.native === "unavailable"
      ? null
      : await (async () => {
          const { createReworkNativeProcessor } = await import("./rework-native-processor");
          const { renderReworkPdf } = await import("./rework-pdf-processor");
          return createReworkNativeProcessor({ renderPdf: renderReworkPdf });
        })();
  const modelFailures: { phase: string; category: string; paths: string[] }[] = [];
  f.env.AI = {
    async run(name: string, raw: Record<string, unknown>) {
      try {
        return await model.binding.run(name, raw);
      } catch (cause) {
        modelFailures.push({
          phase: model.counters.at(-1) ?? "unknown",
          category: cause instanceof Error ? cause.name : "unknown",
          paths:
            cause instanceof z.ZodError
              ? cause.issues.map((issue) => `${issue.code}:${issue.path.join(".")}`)
              : [],
        });
        throw cause;
      }
    },
  } as unknown as Env["AI"];
  if (processor) f.env.FILE_PROCESSOR = processor.binding as unknown as Env["FILE_PROCESSOR"];
  // The real Workers class is not available in Bun. This is only its byte-bound
  // stream transport; all product export/storage admissions remain enabled.
  if (!(globalThis as Record<string, unknown>).FixedLengthStream) {
    (globalThis as Record<string, unknown>).FixedLengthStream = class extends (
      TransformStream<Uint8Array, Uint8Array>
    ) {
      constructor(size: number) {
        let count = 0;
        super({
          transform(chunk, controller) {
            count += chunk.byteLength;
            if (count > size) throw new Error("SYNTHETIC_FIXED_LENGTH_MISMATCH");
            controller.enqueue(chunk);
          },
          flush() {
            if (count !== size) throw new Error("SYNTHETIC_FIXED_LENGTH_MISMATCH");
          },
        });
      }
    };
  }
  const tasks = new Set<Promise<unknown>>(),
    backgroundFailures: string[] = [];
  const waitUntil = (task: Promise<unknown>) => {
    tasks.add(task);
    void task
      .catch(() => backgroundFailures.push("SYNTHETIC_BACKGROUND_FAILURE"))
      .finally(() => tasks.delete(task));
  };
  const runtimeOptions = {
    transport,
    waitUntil,
    reportDependencies: async (ownerId: string, caseId: string) => ({
      ...(await createCaseReportDependencies(f.env, f.core, ownerId, caseId)),
      fixedLength: checkedFixedLength,
    }),
  };
  const runtime = createReworkRuntime(f.core, f.env, runtimeOptions);
  let closed = false;
  function workflow<T>(run: (params: T, id: string) => Promise<unknown>) {
    const instances = new Map<string, { status: string; result?: unknown }>();
    return {
      async get(id: string) {
        const value = instances.get(id);
        if (!value) throw new Error("SYNTHETIC_WORKFLOW_ABSENT");
        return { id, status: async () => ({ status: value.status, output: value.result }) };
      },
      async create({ id, params }: { id: string; params: T }) {
        if (closed || instances.has(id)) throw new Error("SYNTHETIC_WORKFLOW_NOT_CREATED");
        const value = { status: "queued" } as { status: string; result?: unknown };
        instances.set(id, value);
        waitUntil(
          new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
            value.status = "running";
            try {
              value.result = await run(params, id);
              value.status = "complete";
            } catch {
              value.status = "errored";
              throw new Error("SYNTHETIC_WORKFLOW_FAILED");
            }
          }),
        );
        return { id };
      },
    };
  }
  f.env.WORKSPACE_PROCESSING = workflow<WorkspaceParams>((params, id) =>
    runWorkspaceRuntime(f.env, params, id, waitUntil, runtimeOptions),
  ) as unknown as Env["WORKSPACE_PROCESSING"];
  f.env.FILE_PROCESSING = workflow<FileProcessingParams>(async (params, id) => {
    const execution = await createFileProcessingRuntime(f.env, params, id, waitUntil);
    const step = {
      async do(...args: unknown[]) {
        const work = args.at(-1);
        if (typeof work !== "function") throw new Error("SYNTHETIC_WORKFLOW_STEP_INVALID");
        return work();
      },
    };
    const result = await runFileProcessing(
      execution,
      step as Parameters<typeof runFileProcessing>[1],
    );
    await runtime.resume(params.ownerId, params.workspaceId);
    return result;
  }) as unknown as Env["FILE_PROCESSING"];
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", crypto.randomUUID());
      await next();
    })
    .route(
      "/api/v2/cases",
      createReworkApi({ turnstile: async () => true, runtimeOptions: async () => runtimeOptions }),
    )
    .route(
      "/api/v2/cases",
      createWorkspacesApi({
        dependencies: async (env, core) => createWorkspaceDependencies(core, env),
        afterConfirmed: async (_env, _core, owner, caseId) => {
          await runtime.resume(owner, caseId);
        },
      }),
    )
    .route(
      "/api/v2/cases",
      createFilesApi({
        testOnlyMissingD1Meta: true,
        dependencies: async (env, core, owner, afterComplete) => ({
          bucket: env.CASE_PRIVATE_R2,
          paidStorage: createFileStorageBudget(core, "preview", owner),
          ...createFileProcessingAdmission(core, env, {}, undefined, afterComplete),
        }),
      }),
    )
    .route("/api/v2", createReportsApi({ testOnlyMissingD1Meta: true }))
    .route("/api", api);
  const ctx = { waitUntil, passThroughOnException() {} } as unknown as ExecutionContext;
  const fetch = (request: Request) => {
    const url = new URL(request.url);
    const forwarded = new Request(
      new URL(url.pathname + url.search, options.browserOrigin),
      request,
    );
    // Synthetic edge transport metadata, not an authorization override.
    forwarded.headers.set("cf-connecting-ip", "192.0.2.44");
    return app.fetch(forwarded, f.env, ctx);
  };
  const ownerRequest = (path: string, input?: unknown, method?: string) =>
    fetch(
      new Request(new URL(path, options.browserOrigin), {
        method: method ?? (input === undefined ? "GET" : "POST"),
        headers: {
          cookie: f.owner.cookie,
          origin: options.browserOrigin,
          [EXPECTED_OWNER_HEADER]: encodeURIComponent(f.owner.userId),
          ...(input === undefined
            ? {}
            : { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      }),
    );
  const response = await ownerRequest("/api/v2/cases/rework", {
    casePurpose: options.purpose,
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic-external-security-check",
    narrative:
      options.purpose === "prepare_claim"
        ? "합성 검증 사건입니다. 지인에게 빌려준 돈 중 일부를 받았고 남은 약속을 확인해 반환 청구를 준비하려고 합니다. 정확한 반환 날짜는 확인하지 못했습니다."
        : "합성 검증 사건입니다. 상대방은 빌린 돈을 모두 돌려달라고 하지만 저는 일부를 이미 보냈습니다. 남은 약속과 반환 날짜는 확인하지 못했습니다.",
  });
  if (response.status !== 201) {
    f.db.close();
    throw new Error(`SYNTHETIC_CASE_CREATE_${response.status}`);
  }
  const initial = v2ReworkCreateCaseResponseSchema.parse(await response.json()),
    caseId = initial.workspace.id;
  async function settleTasks() {
    for (let round = 0; tasks.size && round < 32; round++) await Promise.allSettled([...tasks]);
    if (tasks.size) throw new Error("SYNTHETIC_WORKFLOW_DRAIN_LIMIT");
  }
  return {
    browserOrigin: options.browserOrigin,
    info: {
      caseId,
      purpose: options.purpose,
      ownerCookie: { ...f.owner.browserCookie, url: options.browserOrigin },
      foreignCookie: { ...f.foreign.browserCookie, url: options.browserOrigin },
      startUrl: `/cases/${caseId}/intake`,
      reconciliationExplanation: "합성 검증을 위해 계약서 원본은 제가 보관하고 있습니다.",
    },
    fetch,
    request: ownerRequest,
    async control(request: Request) {
      const path = new URL(request.url).pathname.replace("/__rework-test/", "");
      if (request.method === "GET" && path === "stats")
        return Response.json({
          models: [...model.counters],
          modelFailures: [...modelFailures],
          sources: sourceRequests.length,
          queries: f.db.queryCount,
          native: processor?.counters ?? null,
          r2: f.bucket.counters,
          jobs: f.db.sqlite
            .query(
              "SELECT j.kind,j.status,count(*) total FROM v2_jobs j WHERE workspace_id=? GROUP BY kind,status",
            )
            .all(caseId),
          reports: f.db.sqlite
            .query(
              "SELECT count(*) total FROM v2_reports WHERE workspace_id=? AND id NOT LIKE 'export-%'",
            )
            .get(caseId),
          artifacts: {
            pdf: f.db.sqlite
              .query(
                "SELECT b.state,count(*) total,sum(b.logical_bytes) logicalBytes,sum(b.cipher_bytes) cipherBytes FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE r.workspace_id=? AND b.kind='report_pdf' GROUP BY b.state",
              )
              .all(caseId),
            reservations: f.db.sqlite
              .query(
                "SELECT r.state,count(*) total,sum(r.byte_length) bytes FROM v2_storage_reservations r JOIN v2_blobs b ON b.reservation_id=r.id WHERE r.workspace_id=? AND b.kind='report_pdf' GROUP BY r.state",
              )
              .all(caseId),
            pdfBindings: f.db.sqlite
              .query(
                "SELECT p.state,p.writer_state writerState,count(*) total,sum(p.maximum_cipher_bytes) maximumBytes FROM v2_physical_blob_bindings p JOIN v2_blobs b ON b.id=p.blob_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE r.workspace_id=? AND b.kind='report_pdf' GROUP BY p.state,p.writer_state",
              )
              .all(caseId),
            capacity: f.db.sqlite
              .query(
                "SELECT capacity_bytes capacityBytes,held_bytes heldBytes FROM v2_physical_storage_capacity WHERE environment='preview'",
              )
              .get(),
            totals: f.db.sqlite
              .query(
                "SELECT held_bytes heldBytes FROM v2_physical_storage_totals WHERE environment='preview'",
              )
              .get(),
            bindings: f.db.sqlite
              .query(
                "SELECT state,writer_state writerState,count(*) total,sum(maximum_cipher_bytes) maximumBytes FROM v2_physical_blob_bindings WHERE environment='preview' GROUP BY state,writer_state",
              )
              .all(),
          },
          backgroundFailures: [...backgroundFailures],
        });
      if (request.method !== "POST") return new Response(null, { status: 404 });
      const input = (await request.json()) as Record<string, unknown>;
      if (path === "provider" && (typeof input.phase === "string" || input.phase === null))
        model.controls.failPhase = input.phase;
      else if (path === "sources" && ["ready", "empty", "failure"].includes(String(input.mode)))
        legalOptions.mode = input.mode as typeof legalOptions.mode;
      else if (path === "native") {
        if (!processor) return new Response(null, { status: 503 });
        for (const key of ["failNative", "failProbe", "failProcess", "failReport"] as const)
          if (typeof input[key] === "boolean") processor.controls[key] = input[key];
        if (typeof input.delayMs === "number" && input.delayMs >= 0 && input.delayMs <= 5000)
          processor.controls.delayMs = input.delayMs;
      } else if (path === "settle") {
        await settleTasks();
      } else if (path === "quota") {
        // Explicit synthetic PRIOR usage condition. Never fabricate provider
        // calls, receipts, reservations, money or observation timestamps.
        f.db.sqlite
          .query(
            "INSERT INTO v2_daily_usage(owner_id,day,responses_used) VALUES(?,?,200) ON CONFLICT(owner_id,day) DO UPDATE SET responses_used=200",
          )
          .run(f.owner.userId, usageDateKst(new Date().toISOString()));
      } else if (path === "withdraw-consent") {
        // Synthetic authorization fault. There is no invented product revoke
        // endpoint: every product gate must re-read the actual consent table.
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      } else if (path === "peer-context") {
        const response = await ownerRequest(`/api/v2/cases/${caseId}/rework/context`);
        if (!response.ok) return response;
        const current = v2CaseContextViewSchema.parse(await response.json());
        return ownerRequest(
          `/api/v2/cases/${caseId}/rework/context`,
          {
            expectedRevision: current.workspaceRevision,
            ...current.context,
            procedure: {
              ...current.context.procedure,
              description: "동시에 기록한 합성 현재 상황",
            },
          },
          "PUT",
        );
      } else return new Response(null, { status: 400 });
      return Response.json({ accepted: true });
    },
    async close() {
      await settleTasks();
      closed = true;
      f.db.close();
    },
  };
}
