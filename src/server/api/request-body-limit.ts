import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ApiEnvironment, errorBody } from "./errors";

// Binary parts are bounded by the file handler after authorization. JSON retains
// the small API limit; do not buffer an unauthenticated binary upload here.
const binaryPartPath =
  /^(?:\/api)?\/v2\/cases\/[A-Za-z0-9_-]{1,128}\/files\/[A-Za-z0-9_-]{1,128}\/parts\/(?:0|[1-9]\d{0,2})$/;
const binaryProfileAssetPath =
  /^(?:\/api)?\/v2\/me\/lawyer\/assets\/[A-Za-z0-9_-]{1,128}\/content$/;
const jsonLimit = bodyLimit({
  maxSize: 65_536,
  onError: (context) =>
    context.json(errorBody(context, "BODY_TOO_LARGE", "입력이 너무 커요."), 413),
});

export const requestBodyLimit: MiddlewareHandler<ApiEnvironment> = (context, next) =>
  context.req.method === "PUT" &&
  (binaryPartPath.test(context.req.path) || binaryProfileAssetPath.test(context.req.path))
    ? next()
    : jsonLimit(context, next);
