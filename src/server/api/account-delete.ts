import { Hono } from "hono";
import { accountDeletionRequestSchema, deletionAccessSchema } from "../../contracts";
import { getAuth } from "../auth";
import { getSession, hasRecentOAuthAuthentication } from "../auth/session";
import { deleteAccount, deletionOwnerTag } from "../modules/deletion/service";
import { type ApiEnvironment, errorBody } from "./errors";
import { hasAllowedOrigin } from "./me";

export const accountDeleteApi = new Hono<ApiEnvironment>()
  .get("/deletion", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    const accounts = await c.env.DB.prepare("SELECT provider_id FROM account WHERE user_id=?")
      .bind(session.user.id)
      .all<{ provider_id: string }>();
    return c.json(
      deletionAccessSchema.parse({
        ownerTag: await deletionOwnerTag(c.env.BETTER_AUTH_SECRET, session.user.id),
        recentOAuth: hasRecentOAuthAuthentication(session.session),
        authenticatedAt: session.session.oauthAuthenticatedAt?.toISOString() ?? null,
        providers: accounts.results.map((a) => a.provider_id),
      }),
    );
  })
  .delete("/", async (c) => {
    if (!hasAllowedOrigin(c.req.raw, c.env.BETTER_AUTH_URL))
      return c.json(errorBody(c, "ORIGIN_NOT_ALLOWED", "허용되지 않은 요청이에요."), 403);
    const session = await getSession(c);
    if (!session) return c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
    const expectedOwner = c.req.header("x-baro-deletion-owner");
    if (
      expectedOwner &&
      expectedOwner !== (await deletionOwnerTag(c.env.BETTER_AUTH_SECRET, session.user.id))
    )
      return c.json(
        errorBody(
          c,
          "REAUTHENTICATION_REQUIRED",
          "계정이 변경됐어요. 삭제할 계정을 다시 확인해 주세요.",
        ),
        403,
      );
    if (!accountDeletionRequestSchema.safeParse(await c.req.json().catch(() => null)).success)
      return c.json(errorBody(c, "VALIDATION_ERROR", "삭제 확인을 다시 입력해 주세요."), 400);
    if (!hasRecentOAuthAuthentication(session.session))
      return c.json(
        errorBody(c, "REAUTHENTICATION_REQUIRED", "계정 삭제 전에 다시 인증해 주세요."),
        403,
      );
    if (!(await deleteAccount(c.env.DB, session.user.id, session.session.id, Date.now())))
      return c.json(
        errorBody(c, "REAUTHENTICATION_REQUIRED", "계정 삭제 전에 다시 인증해 주세요."),
        403,
      );
    const { headers } = await getAuth(c.env).api.signOut({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    return c.json({ status: "accepted" as const }, 202);
  });
