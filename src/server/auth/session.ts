import { getAuth } from ".";

export { hasRecentOAuthAuthentication } from "./policy";

export async function getSession(env: Env, headers: Headers) {
  return getAuth(env).api.getSession({ headers });
}
