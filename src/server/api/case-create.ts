import { Hono } from "hono";
import { createCaseRequestSchema, idempotencyKeySchema } from "../../contracts";
import { reconcileDispatch } from "../modules/dispatch/service";
import { admitCase, verifyTurnstile } from "../modules/intake/service";
import { abuseAllowed, caseAccess } from "./case-access";
import { type ApiEnvironment, errorBody } from "./errors";

export function createCaseApi(verify = verifyTurnstile) {
  return new Hono<ApiEnvironment>().post("/", async (context) => {
    const access = await caseAccess(context, true, true);
    if (access.response) return access.response;
    const input = createCaseRequestSchema.safeParse(await context.req.json().catch(() => null));
    const key = idempotencyKeySchema.safeParse(context.req.header("idempotency-key"));
    if (!input.success || !key.success)
      return context.json(
        errorBody(context, "INVALID_INPUT", "입력과 요청 키를 확인해 주세요."),
        400,
      );
    if (!(await abuseAllowed(context, access.ownerId, true))) {
      context.header("retry-after", "60");
      return context.json(
        errorBody(context, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true),
        429,
      );
    }
    const outcome = await admitCase(
      context.env,
      access.ownerId,
      key.data,
      input.data,
      new Date().toISOString(),
      verify,
    );
    if (outcome.kind === "created") {
      // The durable outbox survives response/dispatch crashes. The cron owns retries.
      await reconcileDispatch(context.env).catch(() => undefined);
      return context.json(outcome.response, 201);
    }
    if (outcome.kind === "conflict")
      return context.json(
        errorBody(context, "IDEMPOTENCY_CONFLICT", "다른 입력에 사용된 요청 키예요."),
        409,
      );
    if (outcome.kind === "challenge")
      return context.json(
        errorBody(context, "TURNSTILE_FAILED", "보안 확인을 다시 진행해 주세요."),
        403,
      );
    return context.json(
      errorBody(context, "DAILY_QUOTA_EXCEEDED", "오늘은 새 사건을 10개까지 입력할 수 있어요."),
      429,
    );
  });
}
export const caseCreateApi = createCaseApi();
