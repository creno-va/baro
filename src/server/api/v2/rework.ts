import { type Context, Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import {
  v2ConversationActionRequestSchema,
  v2ConversationActionResultSchema,
  v2ReworkCreateCaseRequestSchema,
  v2SummaryReconciliationSchema,
} from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core, V2RepositoryError } from "../../db/v2-core";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import { verifyTurnstile } from "../../modules/intake/service";
import { SummaryReconciliationError } from "../../modules/intake/summary-reconciliation";
import { createCaseReportDependencies } from "../../modules/reports/runtime";
import { createReportsService } from "../../modules/reports/service";
import { ReportError } from "../../modules/reports/source";
import { ResolutionError } from "../../modules/resolution/service";
import { createReworkCaseService, ReworkError } from "../../modules/rework/case-context";
import { createReworkRuntime, type ReworkRuntimeOptions } from "../../modules/rework/runtime";
import { createReworkStateService } from "../../modules/rework/state";
import { ConversationAgentError } from "../../modules/workspace/conversation-agent";
import { abuseAllowed, caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";
import { createReworkResolutionApi } from "./rework-resolution";

export function createReworkApi(
  options: {
    turnstile?: typeof verifyTurnstile;
    runtimeOptions?: (
      env: Env,
      core: V2Core,
      ownerId: string,
      sessionId: string,
    ) => Promise<ReworkRuntimeOptions>;
    stateDependencies?: (
      env: Env,
      core: V2Core,
      ownerId: string,
    ) => Promise<Parameters<typeof createReworkStateService>[1]>;
  } = {},
) {
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
    return;
  });
  app.onError((error, c) => {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof V2RepositoryError && error.code === "REPOSITORY_INPUT_INVALID")
    )
      return c.json(errorBody(c, "VALIDATION_ERROR", "입력과 요청 조건을 확인해 주세요."), 400);
    if (
      error instanceof ReworkError ||
      error instanceof ConversationAgentError ||
      error instanceof SummaryReconciliationError ||
      error instanceof ResolutionError ||
      error instanceof ReportError
    ) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONSENT_REQUIRED"
            ? 403
            : error.code === "USER_QUOTA_EXCEEDED" || error.code === "RATE_LIMITED"
              ? 429
              : error.code === "EXPORT_LIMIT_EXCEEDED"
                ? 413
                : error.code === "VALIDATION_ERROR" || error.code === "RESOLUTION_TOO_LARGE"
                  ? 400
                  : [
                        "DEPENDENCY_UNAVAILABLE",
                        "STORAGE_UNAVAILABLE",
                        "BUDGET_UNAVAILABLE",
                        "LEGAL_SOURCE_UNAVAILABLE",
                      ].includes(error.code)
                    ? 503
                    : 409;
      return c.json(
        errorBody(
          c,
          error.code,
          "사건의 현재 상태와 요청 조건을 다시 확인해 주세요.",
          status === 503,
        ),
        status,
      );
    }
    reportDependencyFailure(error);
    return c.json(errorBody(c, "DEPENDENCY_UNAVAILABLE", "사건을 불러오지 못했어요.", true), 503);
  });
  const access = (c: Context<ApiEnvironment>, mutation = false) =>
    caseAccess(c, mutation, mutation, true, { customerConsentSnapshot: true });
  const domainCore = async (c: Context<ApiEnvironment>) =>
    createV2Core(c.env.DB, await createCaseDataCipher(c.env), {
      applicationCostLimitsEnabled: c.env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      monthlyBudgetCapEnabled: c.env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
  const runtime = async (c: Context<ApiEnvironment>, ownerId: string, sessionId: string) => {
    const core = await domainCore(c);
    return createReworkRuntime(core, c.env, {
      ...(await options.runtimeOptions?.(c.env, core, ownerId, sessionId)),
      waitUntil: (work) => {
        try {
          c.executionCtx.waitUntil(work);
        } catch {
          void work.catch(() => undefined);
        }
      },
      admissionAllowed: () => abuseAllowed(c, ownerId, false),
      sessionId,
    });
  };
  const service = async (c: Context<ApiEnvironment>) =>
    createReworkCaseService(await domainCore(c));
  app.post("/rework", async (c) => {
    const a = await access(c, true);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const input = v2ReworkCreateCaseRequestSchema.parse(await c.req.json());
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const s = await service(c),
      replay = await s.replayCreate(a.ownerId, key, input);
    if (replay) return c.json(replay, 201);
    if (!(await abuseAllowed(c, a.ownerId, true)))
      return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
    if (!(await (options.turnstile ?? verifyTurnstile)(c.env, input.turnstileToken)))
      return c.json(errorBody(c, "TURNSTILE_FAILED", "보안 확인을 다시 진행해 주세요."), 403);
    return c.json(await s.create(a.ownerId, key, input), 201);
  });
  app.get("/:id/rework/context", async (c) => {
    const a = await access(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await service(c)).get(a.ownerId, opaqueIdSchema.parse(c.req.param("id"))));
  });
  for (const readPath of ["conversation", "conversation-progress"] as const)
    app.get(`/:id/rework/${readPath}`, async (c) => {
      const a = await access(c);
      if (a.response) return a.response;
      z.strictObject({}).parse(c.req.query());
      const core = await domainCore(c),
        id = opaqueIdSchema.parse(c.req.param("id")),
        dependencies = (await options.stateDependencies?.(c.env, core, a.ownerId)) ?? {
          peekReport: async (ownerId: string, id: string) =>
            createReportsService(
              core,
              await createCaseReportDependencies(c.env, core, ownerId, id),
            ).peek(ownerId, id),
        },
        state = createReworkStateService(core, { ...dependencies, sessionId: a.sessionId });
      // Publication can advance the case between the independently fenced reads.
      // Re-read only this passive snapshot; never replay admission or a mutation.
      for (let attempt = 0; ; attempt++) {
        if (attempt) {
          const fresh = await access(c);
          if (fresh.response) return fresh.response;
          if (fresh.ownerId !== a.ownerId || fresh.sessionId !== a.sessionId)
            return c.json(
              errorBody(c, "UNAUTHENTICATED", "로그인 상태를 다시 확인해 주세요."),
              401,
            );
        }
        try {
          return c.json(
            await (readPath === "conversation-progress"
              ? state.getProgress(a.ownerId, id)
              : state.get(a.ownerId, id)),
          );
        } catch (error) {
          if (
            attempt >= 2 ||
            !(
              (error instanceof ReworkError || error instanceof ReportError) &&
              error.code === "STALE_REVISION"
            )
          )
            throw error;
        }
      }
    });
  app.get("/:id/rework/report", async (c) => {
    const a = await access(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const core = await domainCore(c);
    return c.json(
      await createReportsService(core, {
        ...(await createCaseReportDependencies(c.env, core, a.ownerId, c.req.param("id"))),
        sessionId: a.sessionId,
      }).peek(a.ownerId, opaqueIdSchema.parse(c.req.param("id"))),
    );
  });
  app.post("/:id/rework/actions", async (c) => {
    const a = await access(c, true);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id")),
      key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const input = v2ConversationActionRequestSchema.parse(await c.req.json());
    const result = await (await runtime(c, a.ownerId, a.sessionId)).act(a.ownerId, id, input, key);
    if (result.status === "pending") c.header("retry-after", "2");
    return c.json(
      v2ConversationActionResultSchema.parse(result),
      result.status === "pending" ? 202 : 200,
    );
  });
  app.get("/:id/rework/summary-reconciliation", async (c) => {
    const a = await access(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id")),
      reconciliation = (await runtime(c, a.ownerId, a.sessionId)).reconciliation.service;
    for (let attempt = 0; ; attempt++) {
      if (attempt) {
        const fresh = await access(c);
        if (fresh.response) return fresh.response;
        if (fresh.ownerId !== a.ownerId || fresh.sessionId !== a.sessionId)
          return c.json(errorBody(c, "UNAUTHENTICATED", "로그인 상태를 다시 확인해 주세요."), 401);
      }
      try {
        const result = await reconciliation.read({ ownerId: a.ownerId, caseId: id });
        return c.json(v2SummaryReconciliationSchema.parse(result.state));
      } catch (error) {
        if (
          attempt >= 2 ||
          !(
            (error instanceof ReworkError || error instanceof SummaryReconciliationError) &&
            error.code === "STALE_REVISION"
          )
        )
          throw error;
      }
    }
  });
  for (const action of ["request", "confirm", "cancel"] as const)
    app.post(`/:id/rework/summary-reconciliation/${action}`, async (c) => {
      const a = await access(c, true);
      if (a.response) return a.response;
      z.strictObject({}).parse(c.req.query());
      const id = opaqueIdSchema.parse(c.req.param("id")),
        key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
      const input: unknown = await c.req.json(),
        r = await runtime(c, a.ownerId, a.sessionId);
      const result = await r.reconciliation.service[action](
        { ownerId: a.ownerId, caseId: id },
        key,
        input,
      );
      if (action === "request") {
        await r.analysis.dispatch();
        c.header("retry-after", "2");
      }
      return c.json(v2SummaryReconciliationSchema.parse(result), action === "request" ? 202 : 200);
    });
  app.route(
    "/",
    createReworkResolutionApi({
      runtime: async (env, owner, session) => {
        const core = createV2Core(env.DB, await createCaseDataCipher(env), {
          applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
          monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
        });
        return createReworkRuntime(core, env, {
          ...(await options.runtimeOptions?.(env, core, owner, session)),
          sessionId: session,
        }).resolution;
      },
    }),
  );
  app.put("/:id/rework/context", async (c) => {
    const a = await access(c, true);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const id = opaqueIdSchema.parse(c.req.param("id"));
    const result = await (await service(c)).update(
      a.ownerId,
      id,
      idempotencyKeySchema.parse(c.req.header("idempotency-key")),
      await c.req.json(),
    );
    const r = await runtime(c, a.ownerId, a.sessionId);
    // Make the bounded admitted job visible to the immediate fresh read.
    // A preparation failure cannot undo the already committed context change.
    await r.resume(a.ownerId, id).catch(() => undefined);
    return c.json(result);
  });
  return app;
}
