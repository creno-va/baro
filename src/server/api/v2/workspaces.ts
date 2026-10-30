import { type Context, Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, timestampSchema } from "../../../contracts";
import { v2CreateCaseRequestSchema } from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createPreviewD1Timing, type PreviewD1Operation } from "../../db/preview-d1-timing";
import { createV2Core, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import { lookupCatalog, lookupConfiguration } from "../../modules/external-tools/catalog";
import { verifyTurnstile } from "../../modules/intake/service";
import { backgroundDispatch } from "../../modules/workspace/background-dispatch";
import {
  createWorkspaceService,
  type WorkspaceDependencies,
  WorkspaceError,
} from "../../modules/workspace/service";
import { abuseAllowed, caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";

const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().max(1000).optional(),
});
const beforeSchema = z.strictObject({ createdAt: timestampSchema, id: opaqueIdSchema });
function before(value?: string) {
  if (!value) return undefined;
  try {
    return beforeSchema.parse(JSON.parse(atob(value)));
  } catch {
    throw new z.ZodError([{ code: "custom", path: ["before"], message: "Invalid cursor" }]);
  }
}
const afterQuery = z.strictObject({ after: opaqueIdSchema.optional() });
const emptyQuery = z.strictObject({});
async function customerAccess(c: Context<ApiEnvironment>, mutation = false, consent = false) {
  // Role and consent share one fresh DB snapshot, so no intervening consent
  // read can invalidate a separately read role. Domain/CAS fences remain fresh.
  return caseAccess(c, mutation, consent, true, { customerConsentSnapshot: true });
}
export function createWorkspacesApi(
  options: {
    dependencies?: (env: Env, core: V2Core, ownerId: string) => Promise<WorkspaceDependencies>;
    turnstile?: typeof verifyTurnstile;
  } = {},
) {
  const app = new Hono<ApiEnvironment>();
  const timings = new WeakMap<
    Context<ApiEnvironment>,
    NonNullable<ReturnType<typeof createPreviewD1Timing>>
  >();
  const domainBinding = (c: Context<ApiEnvironment>, operation: PreviewD1Operation) => {
    const timing = createPreviewD1Timing(c.env.DB, c.env.APP_ENV, operation);
    if (!timing) return c.env.DB;
    timings.set(c, timing);
    return timing.binding;
  };
  app.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
    // Only these non-streaming preview domain operations are observed. Auth
    // keeps the original Env/binding and its existing Better Auth cache.
    try {
      const timing = timings.get(c)?.finish();
      if (timing) {
        c.header("server-timing", timing, { append: true });
        // The same bounded numeric/enum receipt is readable in preview logs
        // without enabling browser debugging or recording request identifiers.
        console.info(JSON.stringify({ event: "preview_d1_timing", measurements: timing }));
      }
    } catch {
      // An optional response diagnostic must not change the product result.
    }
    c.header("cache-control", "private, no-store");
    return;
  });
  app.onError((error, c) => {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof V2RepositoryError && error.code === "REPOSITORY_INPUT_INVALID")
    )
      return c.json(errorBody(c, "VALIDATION_ERROR", "입력과 요청 조건을 확인해 주세요."), 400);
    if (error instanceof WorkspaceError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "USER_QUOTA_EXCEEDED"
            ? 429
            : error.code === "BUDGET_UNAVAILABLE"
              ? 503
              : 409;
      const messages = {
        NOT_FOUND: "사건을 찾을 수 없어요.",
        STALE_REVISION: "상태가 바뀌었어요. 다시 확인한 뒤 저장해 주세요.",
        REVIEW_REQUIRED: "질문에 답하고 최신 요약을 확인해 주세요.",
        USER_QUOTA_EXCEEDED: "오늘의 사용 한도에 도달했어요.",
        BUDGET_UNAVAILABLE: "AI 처리를 지금 시작할 수 없어요. 저장된 내용은 보존돼요.",
        IDEMPOTENCY_CONFLICT: "다른 입력에 사용된 요청 키예요.",
      };
      return c.json(errorBody(c, error.code, messages[error.code], status === 503), status);
    }
    reportDependencyFailure(error);
    return c.json(errorBody(c, "DEPENDENCY_UNAVAILABLE", "사건을 불러오지 못했어요.", true), 503);
  });
  const service = async (c: Context<ApiEnvironment>, ownerId: string, binding = c.env.DB) => {
    const env = c.env;
    const core = createV2Core(binding, await createCaseDataCipher(env), {
      applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    return createWorkspaceService(
      core,
      backgroundDispatch((await options.dependencies?.(env, core, ownerId)) ?? {}, (work) =>
        c.executionCtx.waitUntil(work),
      ),
    );
  };
  app.get("/", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    const q = pageQuery.parse(c.req.query());
    const s = await service(c, a.ownerId);
    const items = await s.list(a.ownerId, q.limit, before(q.before));
    const last = items.at(-1);
    return c.json({
      schemaVersion: "2",
      items,
      previews: await s.previews(a.ownerId, items),
      nextCursor:
        items.length === q.limit && last
          ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
          : null,
    });
  });
  app.post("/", async (c) => {
    const a = await customerAccess(c, true, true);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    const request = v2CreateCaseRequestSchema.parse(await c.req.json());
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const s = await service(c, a.ownerId);
    const replay = await s.replayCreate(a.ownerId, key, request);
    if (replay) return c.json(replay, 201);
    if (!(await abuseAllowed(c, a.ownerId, true)))
      return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
    if (!(await (options.turnstile ?? verifyTurnstile)(c.env, request.turnstileToken)))
      return c.json(errorBody(c, "TURNSTILE_FAILED", "보안 확인을 다시 진행해 주세요."), 403);
    return c.json(await s.create(a.ownerId, key, request), 201);
  });
  app.get("/:id/workspace", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c, a.ownerId, domainBinding(c, "workspace_read"))).find(
        a.ownerId,
        c.req.param("id"),
      ),
    );
  });
  app.get("/:id/lookup-tools", async (c) => {
    const a = await customerAccess(c, false, true);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    await (await service(c, a.ownerId)).find(a.ownerId, c.req.param("id"));
    return c.json({ schemaVersion: "2", tools: lookupCatalog(lookupConfiguration(c.env)) });
  });
  app.get("/:id/intake", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c, a.ownerId, domainBinding(c, "intake_read"))).intake(
        a.ownerId,
        c.req.param("id"),
      ),
    );
  });
  app.get("/:id/messages/:messageId/tool-results", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    const s = await service(c, a.ownerId);
    return c.json({
      schemaVersion: "2",
      results: await s.toolResults(a.ownerId, c.req.param("id"), c.req.param("messageId")),
    });
  });
  app.get("/:id/summary", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    const s = await service(c, a.ownerId);
    if (!(await s.summaryAvailable(a.ownerId, c.req.param("id"))))
      throw new WorkspaceError("NOT_FOUND");
    const fragments = s.summary(a.ownerId, c.req.param("id"))[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    let complete = false;
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const part = await fragments.next();
              if (part.done) {
                if (!complete) throw new WorkspaceError("STALE_REVISION");
                controller.close();
              } else {
                complete = part.value.complete;
                controller.enqueue(encoder.encode(part.value.text));
              }
            } catch (error) {
              controller.error(error);
            }
          },
          async cancel() {
            await fragments.return?.();
          },
        },
        { highWaterMark: 0 },
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  });
  for (const name of ["answers", "advance", "editSummary", "confirm", "send", "state"] as const) {
    const path = {
      answers: "intake/answers",
      advance: "intake/advance",
      editSummary: "summary",
      confirm: "summary/confirm",
      send: "messages",
      state: "state",
    }[name];
    const method =
      name === "answers" || name === "editSummary" || name === "state" ? "put" : "post";
    app[method](`/:id/${path}`, async (c) => {
      const a = await customerAccess(c, true, true);
      if (a.response) return a.response;
      emptyQuery.parse(c.req.query());
      const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
      const body: unknown = await c.req.json(),
        s = await service(
          c,
          a.ownerId,
          name === "answers" ? domainBinding(c, "answers_save") : c.env.DB,
        ),
        id = c.req.param("id");
      if (name === "advance" || name === "send") {
        if (!(await abuseAllowed(c, a.ownerId, false)))
          return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
        c.header("retry-after", "2");
        return c.json(await s[name](a.ownerId, id, key, body), 202);
      }
      const result = await s[name](a.ownerId, id, key, body);
      if (result && "edit" in result) {
        c.header("retry-after", "1");
        return c.json(result, 202);
      }
      return c.json(result);
    });
  }
  app.get("/:id/messages", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    const q = pageQuery.parse(c.req.query());
    const items = await (await service(c, a.ownerId)).messages(
      a.ownerId,
      c.req.param("id"),
      q.limit,
      before(q.before),
    );
    const last = items.at(-1);
    return c.json({
      items,
      nextCursor:
        items.length === q.limit && last
          ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
          : null,
    });
  });
  for (const name of ["actions", "timeline"] as const)
    app.get(`/:id/${name}`, async (c) => {
      const a = await customerAccess(c);
      if (a.response) return a.response;
      const q = afterQuery.parse(c.req.query());
      const items = await (await service(c, a.ownerId))[name](
        a.ownerId,
        c.req.param("id"),
        q.after,
      );
      return c.json({ items, nextCursor: items.length === 8 ? (items.at(-1)?.id ?? null) : null });
    });
  for (const name of ["actions", "timeline"] as const)
    app.put(`/:id/${name}/:entityId`, async (c) => {
      const a = await customerAccess(c, true, true);
      if (a.response) return a.response;
      emptyQuery.parse(c.req.query());
      const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
      const s = await service(c, a.ownerId),
        body: unknown = await c.req.json();
      return c.json(
        await s[name === "actions" ? "updateAction" : "editTimeline"](
          a.ownerId,
          c.req.param("id"),
          c.req.param("entityId"),
          key,
          body,
        ),
      );
    });
  app.post("/:id/timeline", async (c) => {
    const a = await customerAccess(c, true, true);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c, a.ownerId)).createTimeline(
        a.ownerId,
        c.req.param("id"),
        idempotencyKeySchema.parse(c.req.header("idempotency-key")),
        await c.req.json(),
      ),
      201,
    );
  });
  app.get("/:id/workspace-jobs/latest", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c, a.ownerId, domainBinding(c, "latest_job_read"))).latestJob(
        a.ownerId,
        c.req.param("id"),
      ),
    );
  });
  app.get("/:id/workspace-jobs/:jobId", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c, a.ownerId)).job(a.ownerId, c.req.param("id"), c.req.param("jobId")),
    );
  });
  app.post("/:id/workspace-jobs/:jobId/retry", async (c) => {
    const a = await customerAccess(c, true, true);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    if (!(await abuseAllowed(c, a.ownerId, false)))
      return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
    const result = await (await service(c, a.ownerId)).retry(
      a.ownerId,
      c.req.param("id"),
      c.req.param("jobId"),
      await c.req.json(),
    );
    c.header("retry-after", "2");
    return c.json(result, 202);
  });
  return app;
}
