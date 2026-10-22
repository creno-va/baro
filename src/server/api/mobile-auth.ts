import { splitSetCookieHeader } from "better-auth/cookies";
import { Hono } from "hono";
import {
  mobileAuthExchangeResponseSchema,
  mobileAuthExchangeSchema,
} from "../../contracts/mobile-auth";
import { createNativeAuthCodeStore, NativeAuthProofError } from "../auth/native-codes";
import { type ApiEnvironment, errorBody } from "./errors";
import { hasAllowedOrigin } from "./me";

export const mobileAuthApi = new Hono<ApiEnvironment>().post("/exchange", async (c) => {
  c.header("cache-control", "private, no-store");
  c.header("x-content-type-options", "nosniff");
  if (!hasAllowedOrigin(c.req.raw, c.env.BETTER_AUTH_URL))
    return c.json(errorBody(c, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."), 403);
  const request = mobileAuthExchangeSchema.safeParse(await c.req.json().catch(() => null));
  if (!request.success)
    return c.json(errorBody(c, "VALIDATION_ERROR", "로그인을 다시 시작해 주세요."), 400);
  try {
    const cookie = await createNativeAuthCodeStore({
      db: c.env.DB,
      issuer: c.env.BETTER_AUTH_URL,
      secret: c.env.BETTER_AUTH_SECRET,
    }).exchange(request.data);
    for (const value of splitSetCookieHeader(cookie))
      c.header("set-cookie", value, { append: true });
    return c.json(mobileAuthExchangeResponseSchema.parse({ status: "accepted" }));
  } catch (error) {
    return error instanceof NativeAuthProofError
      ? c.json(errorBody(c, "UNAUTHENTICATED", "로그인을 다시 시작해 주세요."), 401)
      : c.json(
          errorBody(
            c,
            "DEPENDENCY_UNAVAILABLE",
            "로그인을 마치지 못했어요. 다시 시도해 주세요.",
            true,
          ),
          503,
        );
  }
});
