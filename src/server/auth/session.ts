import type { Context } from "hono";
import type { ApiEnvironment } from "../api/errors";
import { getAuth } from ".";

export { hasRecentOAuthAuthentication } from "./policy";

export async function getSession(context: Context<ApiEnvironment>) {
  const { response, headers } = await getAuth(context.env).api.getSession({
    headers: context.req.raw.headers,
    returnHeaders: true,
  });
  // A database sliding refresh must also extend the browser cookie. Expired
  // sessions use the same headers to clear the cookie on the 401 response.
  for (const cookie of headers.getSetCookie()) {
    context.header("set-cookie", cookie, { append: true });
  }
  context.header("cache-control", "no-store");
  return response;
}
