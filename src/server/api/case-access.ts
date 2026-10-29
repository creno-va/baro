import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { readAccountType, readCustomerConsentSnapshot } from "../auth/account-type";
import { getSession } from "../auth/session";
import * as schema from "../db/schema";
import { hasCurrentConsent } from "../modules/consent/service";
import { type ApiEnvironment, errorBody } from "./errors";
import { hasAllowedOrigin } from "./me";

export async function caseAccess(
  context: Context<ApiEnvironment>,
  mutation = false,
  consent = false,
  customer = true,
  options: { customerConsentSnapshot?: true } = {},
) {
  if (mutation && !hasAllowedOrigin(context.req.raw, context.env.BETTER_AUTH_URL))
    return {
      response: context.json(
        errorBody(context, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."),
        403,
      ),
    };
  const session = await getSession(context);
  if (!session)
    return {
      response: context.json(errorBody(context, "UNAUTHENTICATED", "로그인이 필요해요."), 401),
    };
  const snapshot =
    customer && consent && options.customerConsentSnapshot
      ? await readCustomerConsentSnapshot(context.env.DB, session.user.id)
      : undefined;
  if (
    customer &&
    !["customer", "lawyer"].includes(
      snapshot?.accountType ?? (await readAccountType(context.env.DB, session.user.id)),
    )
  )
    return {
      response: context.json(
        errorBody(context, "ROLE_REQUIRED", "로그인 상태를 다시 확인해 주세요."),
        403,
      ),
    };
  if (
    consent &&
    !(snapshot
      ? snapshot.currentConsent
      : await hasCurrentConsent(drizzle(context.env.DB, { schema }), session.user.id))
  )
    return {
      response: context.json(
        errorBody(context, "CONSENT_REQUIRED", "현재 필수 동의가 필요해요."),
        403,
      ),
    };
  return { ownerId: session.user.id, sessionId: session.session.id };
}
export async function abuseAllowed(
  context: Context<ApiEnvironment>,
  ownerId: string,
  create: boolean,
) {
  const account = create ? context.env.CASE_ACCOUNT_LIMIT : context.env.ANALYSIS_ACCOUNT_LIMIT;
  if (!account || !(await account.limit({ key: ownerId }).then((result) => result.success)))
    return false;
  if (create) {
    const ip = context.req.header("cf-connecting-ip");
    if (
      !ip ||
      !context.env.CASE_IP_LIMIT ||
      !(await context.env.CASE_IP_LIMIT.limit({ key: ip }).then((result) => result.success))
    )
      return false;
  }
  return true;
}
