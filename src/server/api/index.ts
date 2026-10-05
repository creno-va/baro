import { Hono } from "hono";
import { getAuth } from "../auth";
import { healthApi } from "./health";
import { meApi } from "./me";

export const api = new Hono<{ Bindings: Env }>()
  .use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
    context.header("x-request-id", requestId);
    await next();
  })
  .all("/auth/*", async (context) => getAuth(context.env).handler(context.req.raw))
  .route("/health", healthApi)
  .route("/me", meApi);

export type AppType = typeof api;
