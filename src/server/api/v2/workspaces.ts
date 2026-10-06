import { type Context, Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, timestampSchema } from "../../../contracts";
import { v2CreateCaseRequestSchema } from "../../../contracts/v2";
import { readAccountType } from "../../auth/account-type";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import { verifyTurnstile } from "../../modules/intake/service";
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
  const access = await caseAccess(c, mutation, consent);
  if (access.response) return access;
  if ((await readAccountType(c.env.DB, access.ownerId)) !== "customer")
    return { response: c.json(errorBody(c, "NOT_FOUND", "고객 사건을 찾을 수 없어요."), 404) };
  return access;
}
export function createWorkspacesApi(
  options: {
    dependencies?: (env: Env, core: V2Core, ownerId: string) => Promise<WorkspaceDependencies>;
    turnstile?: typeof verifyTurnstile;
  } = {},
) {
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
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
  const service = async (env: Env, ownerId: string) => {
    const core = createV2Core(env.DB, await createCaseDataCipher(env), {
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    return createWorkspaceService(core, await options.dependencies?.(env, core, ownerId));
  };
  app.get("/", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    const q = pageQuery.parse(c.req.query());
    const s = await service(c.env, a.ownerId);
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
    const s = await service(c.env, a.ownerId);
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
    return c.json(await (await service(c.env, a.ownerId)).find(a.ownerId, c.req.param("id")));
  });
  app.get("/:id/intake", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(await (await service(c.env, a.ownerId)).intake(a.ownerId, c.req.param("id")));
  });
  app.get("/:id/summary", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    const s = await service(c.env, a.ownerId);
    const intake = await s.intake(a.ownerId, c.req.param("id"));
    if (!intake?.summary) throw new WorkspaceError("NOT_FOUND");
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
        s = await service(c.env, a.ownerId),
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
    const items = await (await service(c.env, a.ownerId)).messages(
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
      const items = await (await service(c.env, a.ownerId))[name](
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
      const s = await service(c.env, a.ownerId),
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
      await (await service(c.env, a.ownerId)).createTimeline(
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
    return c.json(await (await service(c.env, a.ownerId)).latestJob(a.ownerId, c.req.param("id")));
  });
  app.get("/:id/workspace-jobs/:jobId", async (c) => {
    const a = await customerAccess(c);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    return c.json(
      await (await service(c.env, a.ownerId)).job(
        a.ownerId,
        c.req.param("id"),
        c.req.param("jobId"),
      ),
    );
  });
  app.post("/:id/workspace-jobs/:jobId/retry", async (c) => {
    const a = await customerAccess(c, true, true);
    if (a.response) return a.response;
    emptyQuery.parse(c.req.query());
    idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    if (!(await abuseAllowed(c, a.ownerId, false)))
      return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
    const result = await (await service(c.env, a.ownerId)).retry(
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
