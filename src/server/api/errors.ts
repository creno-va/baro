import type { Context } from "hono";

export type ApiEnvironment = {
  Bindings: Env;
  Variables: { requestId: string };
};

export function errorBody(
  context: Context<ApiEnvironment>,
  code: string,
  message: string,
  retryable = false,
) {
  return {
    error: {
      code,
      message,
      requestId: context.get("requestId"),
      retryable,
      details: {},
    },
  };
}
