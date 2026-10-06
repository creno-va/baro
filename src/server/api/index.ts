import { type Context, Hono, type Next } from "hono";
import { getAuth } from "../auth";
import { AuthConfigurationError } from "../auth/env";
import { createStorageBudgetService } from "../modules/budget/storage-ledger";
import { createAssetProcessingAdmission } from "../runtime/asset-admission";
import { createFileProcessingAdmission } from "../runtime/file-admission";
import { createSanitizedReaders } from "../runtime/sanitized-reader";
import { createWorkspaceDependencies } from "../runtime/workspace";
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
import { workspaceDeleteApi } from "./v2/delete";
import { createDirectoryApi } from "./v2/directory";
import { createFilesApi } from "./v2/files";
import { createLawyersApi } from "./v2/lawyers";
import { createModerationApi } from "./v2/moderation";
import { createReportsApi } from "./v2/reports";
import { usageApi } from "./v2/usage";
import { createWorkspacesApi } from "./v2/workspaces";

async function privateAuthResponse(context: Context<ApiEnvironment>, next: Next) {
  await next();
  context.header("cache-control", "private, no-store");
  context.header("x-content-type-options", "nosniff");
}

export const api = new Hono<ApiEnvironment>()
  .onError((error, context) => {
    if (error instanceof AuthConfigurationError)
      return context.json(
        errorBody(context, "DEPENDENCY_UNAVAILABLE", "로그인 서비스를 준비하고 있어요.", true),
        503,
      );
    return context.json(
      errorBody(context, "INTERNAL_ERROR", "요청을 처리하지 못했어요.", true),
      500,
    );
  })
  .notFound((context) =>
    context.json(errorBody(context, "NOT_FOUND", "요청한 경로를 찾을 수 없어요."), 404),
  )
  .use("/me/*", privateAuthResponse)
  .use("/auth/*", privateAuthResponse)
  .use("/v2/me/*", async (context, next) => {
    await next();
    context.header("cache-control", "private, no-store");
  })
  .use("/v2/cases/*", async (context, next) => {
    await next();
    context.header("cache-control", "private, no-store");
    context.header("x-content-type-options", "nosniff");
  })
  .use("/v2/reports/*", async (context, next) => {
    await next();
    context.header("cache-control", "private, no-store");
    context.header("x-content-type-options", "nosniff");
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
  .route("/v2/lawyers", createDirectoryApi())
  .route("/v2/me", usageApi)
  .route(
    "/v2/cases",
    createWorkspacesApi({
      dependencies: async (env, core) => createWorkspaceDependencies(core, env),
    }),
  )
  .route(
    "/v2/me",
    createLawyersApi({
      dependencies: async (env, core, ownerId) => ({
        bucket: env.CASE_PRIVATE_R2,
        paidStorage: (requestedOwnerId) => {
          if (requestedOwnerId !== ownerId) throw new Error("Owner scope mismatch");
          return createStorageBudgetService({
            core,
            ownerId,
            environment: env.APP_ENV === "production" ? "production" : "preview",
          });
        },
        ...createAssetProcessingAdmission(core, env),
      }),
    }),
  )
  .route(
    "/v2/moderation",
    createModerationApi({
      dependencies: async (env, core) => ({
        bucket: env.CASE_PRIVATE_R2,
        ...(env.CASE_PRIVATE_R2
          ? {
              openSanitized: createSanitizedReaders(core, {
                environment: env.APP_ENV === "production" ? "production" : "preview",
                bucket: env.CASE_PRIVATE_R2,
              }).moderation,
            }
          : {}),
      }),
    }),
  )
  .route(
    "/v2/cases",
    createFilesApi({
      dependencies: async (env, core, ownerId) => ({
        bucket: env.CASE_PRIVATE_R2,
        paidStorage: createStorageBudgetService({
          core,
          ownerId,
          environment: env.APP_ENV === "production" ? "production" : "preview",
        }),
        ...createFileProcessingAdmission(core, env),
      }),
    }),
  )
  .route("/v2/cases", workspaceDeleteApi)
  .route("/v2", createReportsApi())
  .route("/me", meApi)
  .route("/me", accountDeleteApi)
  .route("/cases", caseCreateApi)
  .route("/cases", casesApi)
  .route("/cases", answersApi)
  .route("/cases", retryApi)
  .route("/cases", feedbackApi);

export type AppType = typeof api;
