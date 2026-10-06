import { Hono } from "hono";
import { getAuth } from "../auth";
import { accountDeleteApi } from "./account-delete";
import { answersApi } from "./answers";
import { caseCreateApi } from "./case-create";
import { casesApi } from "./cases";
import { type ApiEnvironment, errorBody } from "./errors";
import { feedbackApi } from "./feedback";
import { healthApi } from "./health";
import { meApi } from "./me";
import { requestBodyLimit } from "./request-body-limit";
import { retryApi } from "./retry";
import { usageApi } from "./v2/usage";

export const api = new Hono<ApiEnvironment>()
  .onError((_error, context) =>
    context.json(errorBody(context, "INTERNAL_ERROR", "요청을 처리하지 못했어요.", true), 500),
  )
  .notFound((context) =>
    context.json(errorBody(context, "NOT_FOUND", "요청한 경로를 찾을 수 없어요."), 404),
  )
  .use("/v2/me/*", async (context, next) => {
    await next();
    context.header("cache-control", "private, no-store");
  })
  .use("*", async (context, next) => {
    const incomingId = context.req.header("x-request-id");
    const requestId =
      incomingId && /^[a-zA-Z0-9_-]{1,128}$/.test(incomingId) ? incomingId : crypto.randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    if (
      context.env?.APP_ENV === "production" &&
      context.env.PUBLIC_BETA_ENABLED !== "true" &&
      !context.req.path.startsWith("/api/health/") &&
      !context.req.path.startsWith("/health/")
    ) {
      return context.json(errorBody(context, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    }
    await next();
    return;
  })
  .use("*", requestBodyLimit)
  .all("/auth/*", async (context) => getAuth(context.env).handler(context.req.raw))
  .route("/health", healthApi)
  .route("/v2/me", usageApi)
  .route("/me", meApi)
  .route("/me", accountDeleteApi)
  .route("/cases", caseCreateApi)
  .route("/cases", casesApi)
  .route("/cases", answersApi)
  .route("/cases", retryApi)
  .route("/cases", feedbackApi);

export type AppType = typeof api;
