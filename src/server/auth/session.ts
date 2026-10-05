import { getAuth } from ".";

export async function getSession(env: Env, headers: Headers) {
  return getAuth(env).api.getSession({ headers });
}
