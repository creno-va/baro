import { CURRENT_POLICY_VERSIONS } from "../../src/contracts/consent";
import { type createTestDatabase, signedSessionCookie, testEnvironment } from "./d1";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

/** Seed SQL in an isolated test database; never a product route or runtime auth switch. */
export async function seedTestSession(
  database: TestDatabase,
  options: {
    now?: number;
    expiresAt?: number;
    userId?: string;
    consent?: boolean;
    oauthAuthenticatedAt?: number;
  } = {},
) {
  const now = options.now ?? Date.now();
  const userId = options.userId ?? crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const token = `synthetic-session-${sessionId}`;
  database.sqlite
    .query(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    )
    .run(userId, "Synthetic test owner", `${userId}@example.test`, now, now);
  database.sqlite
    .query(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      sessionId,
      userId,
      token,
      options.expiresAt ?? now + 3_600_000,
      now,
      now,
      options.oauthAuthenticatedAt ?? null,
    );
  if (options.consent) {
    database.sqlite
      .query(
        "INSERT INTO user_consents(user_id,terms_version,privacy_version,ai_notice_version,over_14_confirmed,consented_at) VALUES(?,?,?,?,1,?)",
      )
      .run(
        userId,
        CURRENT_POLICY_VERSIONS.termsVersion,
        CURRENT_POLICY_VERSIONS.privacyVersion,
        CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        new Date(now).toISOString(),
      );
  }
  const env = testEnvironment(database.binding);
  const cookie = await signedSessionCookie(token, env.BETTER_AUTH_SECRET);
  const separator = cookie.indexOf("=");
  return {
    userId,
    sessionId,
    cookie,
    env,
    // Playwright's browserContext.addCookies accepts this; no Playwright runtime dependency.
    browserCookie: {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: env.BETTER_AUTH_URL,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    },
  };
}
