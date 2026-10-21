import { Hono } from "hono";
import { z } from "zod";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import {
  createPrecedentResearchService,
  PrecedentResearchError,
} from "../../modules/legal-retrieval/research/service";
import { abuseAllowed, caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";

export function createPrecedentsApi(
  options: {
    service?: (core: V2Core, env: Env) => ReturnType<typeof createPrecedentResearchService>;
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
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json(
        errorBody(c, "VALIDATION_ERROR", "검색 주제와 요청 조건을 확인해 주세요."),
        400,
      );
    if (error instanceof PrecedentResearchError) {
      const messages = {
        NOT_FOUND: "사건 또는 판례를 다시 확인해 주세요.",
        CONSENT_REQUIRED: "현재 필수 동의를 확인해 주세요.",
        REVIEW_REQUIRED: "최신 사건 요약을 확인한 뒤 판례를 찾아 주세요.",
        CONFLICT: "사건 내용이 바뀌었어요. 최신 요약으로 다시 찾아 주세요.",
        UNAVAILABLE: "공식 판례를 지금 확인할 수 없어요.",
      };
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONSENT_REQUIRED"
            ? 403
            : error.code === "UNAVAILABLE"
              ? 503
              : 409;
      return c.json(errorBody(c, error.code, messages[error.code], status === 503), status);
    }
    reportDependencyFailure(error);
    return c.json(
      errorBody(
        c,
        "DEPENDENCY_UNAVAILABLE",
        "판례를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        true,
      ),
      503,
    );
  });
  const service = async (env: Env) => {
    const core = createV2Core(env.DB, await createCaseDataCipher(env), {
      applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
      monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
    });
    return options.service?.(core, env) ?? createPrecedentResearchService(core, env);
  };
  const empty = z.strictObject({});
  app.get("/:id/precedents", async (c) => {
    const access = await caseAccess(c, false, true, true, { customerConsentSnapshot: true });
    if (access.response) return access.response;
    empty.parse(c.req.query());
    return c.json(await (await service(c.env)).context(access.ownerId, c.req.param("id")));
  });
  for (const action of ["search", "read"] as const)
    app.post(`/:id/precedents/${action}`, async (c) => {
      const access = await caseAccess(c, true, true, true, { customerConsentSnapshot: true });
      if (access.response) return access.response;
      empty.parse(c.req.query());
      if (!(await abuseAllowed(c, access.ownerId, false)))
        return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
      const s = await service(c.env),
        input = await c.req.json();
      return c.json(
        action === "search"
          ? await s.search(access.ownerId, c.req.param("id"), input, c.req.raw.signal)
          : await s.read(access.ownerId, c.req.param("id"), input),
      );
    });
  return app;
}
