import { splitSetCookieHeader } from "better-auth/cookies";
import { Hono } from "hono";
import {
  mobileAuthExchangeResponseSchema,
  mobileAuthExchangeSchema,
  mobileReauthPrepareSchema,
  mobileReauthProofSchema,
  mobileReauthReceiptSchema,
} from "../../contracts/mobile-auth";
import { createNativeAuthCodeStore, NativeAuthProofError } from "../auth/native-codes";
import { createNativeReauthentication } from "../auth/native-reauth";
import { getSession } from "../auth/session";
import { deletionOwnerTag } from "../modules/deletion/service";
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
    const session = request.data.purpose === "reauthenticate" ? await getSession(c) : undefined;
    if (request.data.purpose === "reauthenticate" && !session) throw new NativeAuthProofError();
    const cookie = await createNativeAuthCodeStore({
      db: c.env.DB,
      issuer: c.env.BETTER_AUTH_URL,
      secret: c.env.BETTER_AUTH_SECRET,
    }).exchange(
      request.data,
      session ? { userId: session.user.id, sessionId: session.session.id } : undefined,
    );
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

for (const operation of ["prepare", "verify"] as const)
  mobileAuthApi.post(`/reauth/${operation}`, async (c) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (!hasAllowedOrigin(c.req.raw, c.env.BETTER_AUTH_URL))
      return c.json(errorBody(c, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."), 403);
    const session = await getSession(c);
    if (!session) return c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    const input =
      operation === "prepare"
        ? mobileReauthPrepareSchema.safeParse(await c.req.json().catch(() => null))
        : mobileReauthProofSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(errorBody(c, "VALIDATION_ERROR", "재인증을 다시 시작해 주세요."), 400);
    try {
      const store = createNativeReauthentication({
        db: c.env.DB,
        issuer: c.env.BETTER_AUTH_URL,
        secret: c.env.BETTER_AUTH_SECRET,
      });
      const result = await store[operation](input.data, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
      return c.json(
        mobileReauthReceiptSchema.parse({
          ...result,
          ownerTag: await deletionOwnerTag(c.env.BETTER_AUTH_SECRET, session.user.id),
        }),
      );
    } catch (error) {
      return error instanceof NativeAuthProofError
        ? c.json(errorBody(c, "UNAUTHENTICATED", "같은 계정으로 재인증을 다시 시작해 주세요."), 401)
        : c.json(
            errorBody(
              c,
              "DEPENDENCY_UNAVAILABLE",
              "재인증 상태를 확인하지 못했어요. 다시 시도해 주세요.",
              true,
            ),
            503,
          );
    }
  });
