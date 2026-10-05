import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { CURRENT_POLICY_VERSIONS, consentInputSchema } from "../../contracts/consent";
import { getSession } from "../auth/session";
import * as schema from "../db/schema";
import { hasCurrentConsent, readConsent, saveConsent } from "../modules/consent/service";

function errorBody(
  context: { req: { header(name: string): string | undefined } },
  code: string,
  message: string,
) {
  return {
    error: {
      code,
      message,
      requestId: context.req.header("x-request-id") ?? "unknown",
      retryable: false,
      details: {},
    },
  };
}

function hasAllowedOrigin(request: Request, expectedBaseUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(expectedBaseUrl).origin;
  } catch {
    return false;
  }
}

export const meApi = new Hono<{ Bindings: Env }>()
  .get("/consent", async (context) => {
    const session = await getSession(context.env, context.req.raw.headers);
    if (!session) {
      return context.json(errorBody(context, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    }

    const database = drizzle(context.env.DB, { schema });
    const [consent, current] = await Promise.all([
      readConsent(database, session.user.id),
      hasCurrentConsent(database, session.user.id),
    ]);

    return context.json({
      required: CURRENT_POLICY_VERSIONS,
      consent: consent ?? null,
      needsConsent: !current,
    });
  })
  .put("/consent", async (context) => {
    if (!hasAllowedOrigin(context.req.raw, context.env.BETTER_AUTH_URL)) {
      return context.json(
        errorBody(context, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."),
        403,
      );
    }

    const session = await getSession(context.env, context.req.raw.headers);
    if (!session) {
      return context.json(errorBody(context, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    }

    const input = consentInputSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) {
      return context.json(
        errorBody(
          context,
          "INVALID_CONSENT",
          "현재 정책 전체와 만 14세 이상 여부를 확인해 주세요.",
        ),
        400,
      );
    }

    const database = drizzle(context.env.DB, { schema });
    const consent = await saveConsent(database, session.user.id, input.data);

    return context.json({
      required: CURRENT_POLICY_VERSIONS,
      consent,
      needsConsent: false,
    });
  });

export { hasAllowedOrigin };
