import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { type ApiEnvironment, errorBody } from "../api/errors";
import { hasAllowedOrigin } from "../api/me";
import * as schema from "../db/schema";
import { hasCurrentConsent } from "../modules/consent/service";
import { getSession, hasRecentOAuthAuthentication } from "./session";

/** SQL role + signed session only. Headers/body never establish a role or OAuth freshness. */
export async function lawyerAccess(
  c: Context<ApiEnvironment>,
  options: {
    mutation?: boolean;
    moderator?: boolean;
    consent?: boolean;
  } = {},
) {
  if (options.mutation && !hasAllowedOrigin(c.req.raw, c.env.BETTER_AUTH_URL))
    return {
      response: c.json(errorBody(c, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."), 403),
    };
  const session = await getSession(c);
  if (!session)
    return { response: c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401) };
  if (options.consent && !(await hasCurrentConsent(drizzle(c.env.DB, { schema }), session.user.id)))
    return {
      response: c.json(errorBody(c, "CONSENT_REQUIRED", "현재 필수 동의가 필요해요."), 403),
    };
  if (options.moderator) {
    const role = await c.env.DB.prepare(
      "SELECT owner_id FROM v2_role_bindings WHERE owner_id=? AND role='moderator' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=owner_id)",
    )
      .bind(session.user.id)
      .first();
    if (!role)
      return { response: c.json(errorBody(c, "ROLE_REQUIRED", "심사 권한이 필요해요."), 403) };
    if (!hasRecentOAuthAuthentication(session.session))
      return {
        response: c.json(
          errorBody(c, "REAUTHENTICATION_REQUIRED", "다시 로그인한 뒤 심사해 주세요."),
          403,
        ),
      };
  }
  return { ownerId: session.user.id, sessionId: session.session.id };
}
