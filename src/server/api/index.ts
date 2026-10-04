import { Hono } from "hono";
import { healthApi } from "./health";

export const api = new Hono<{ Bindings: Env }>()
  .use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
    context.header("x-request-id", requestId);
    await next();
  })
  .route("/health", healthApi);

export type AppType = typeof api;
