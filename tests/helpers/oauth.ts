import { getAuth } from "../../src/server/auth";
import { createTestDatabase, testEnvironment } from "./d1";

export type SyntheticProvider = "google" | "naver" | "kakao";

export function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

// Only provider exchange/profile methods are replaced. Better Auth's real state,
// cookie verification, callback route, database hooks and D1 SQL remain in use.
export async function createOAuthFixture(
  providerId: SyntheticProvider,
  email?: string,
  origin?: string,
) {
  const database = await createTestDatabase();
  const env = testEnvironment(database.binding);
  if (origin) env.BETTER_AUTH_URL = origin;
  const auth = getAuth(env);
  const context = await auth.$context;
  const provider = context.socialProviders.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error("Synthetic provider missing");
  let exchanges = 0;
  provider.validateAuthorizationCode = async () => {
    exchanges += 1;
    return {
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      idToken: "synthetic-id-token",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: new Date(Date.now() + 7_200_000),
      scopes: ["email", "profile"],
    };
  };
  provider.getUserInfo = async () => ({
    user: {
      name: "Synthetic",
      email: email ?? `${providerId}@example.test`,
      emailVerified: true,
    },
    data: {
      sub: "synthetic-subject",
      id: "synthetic-subject",
      response: { id: "synthetic-subject" },
    },
  });

  async function begin() {
    const response = await auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL },
        body: JSON.stringify({
          provider: providerId,
          callbackURL: "/consent",
          errorCallbackURL: "/login",
          disableRedirect: true,
        }),
      }),
    );
    const body = (await response.json()) as { url: string };
    const url = new URL(body.url);
    return {
      response,
      url,
      state: url.searchParams.get("state") ?? "",
      cookie: responseCookies(response),
    };
  }

  async function callback(state: string, cookie: string, error?: string) {
    const query = new URLSearchParams(error ? { state, error } : { state, code: "synthetic-code" });
    return auth.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/callback/${providerId}?${query}`, {
        headers: { cookie, "user-agent": "Synthetic Browser", "x-forwarded-for": "192.0.2.1" },
      }),
    );
  }

  return { database, env, auth, context, begin, callback, exchanges: () => exchanges };
}
