import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../db/schema";
import { parseAuthEnvironment } from "./env";
import { AUTH_RETENTION_MS, SESSION_EXPIRES_SECONDS, SESSION_UPDATE_SECONDS } from "./policy";

function discardProviderCredentials<T extends Record<string, unknown>>(account: T): T {
  return {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  };
}

function createConfiguredAuth(env: Env) {
  const config = parseAuthEnvironment(env);
  const database = drizzle(env.DB, { schema: authSchema });
  const origin = new URL(config.BETTER_AUTH_URL).origin;

  return betterAuth({
    appName: "BARO",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    onAPIError: { errorURL: `${origin}/login` },
    // Adapter errors can include SQL parameters and provider tokens; keep them out of logs.
    logger: { disabled: true },
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
      },
      naver: {
        clientId: config.NAVER_CLIENT_ID,
        clientSecret: config.NAVER_CLIENT_SECRET,
      },
      kakao: {
        clientId: config.KAKAO_CLIENT_ID,
        clientSecret: config.KAKAO_CLIENT_SECRET,
      },
    },
    account: {
      accountLinking: {
        disableImplicitLinking: true,
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: SESSION_UPDATE_SECONDS,
      freshAge: 10 * 60,
      additionalFields: {
        oauthAuthenticatedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => ({
            data: {
              ...session,
              ipAddress: null,
              userAgent: null,
              // Only a completed provider callback can establish recent OAuth authentication.
              oauthAuthenticatedAt:
                context?.path === "/callback/:id" &&
                ["google", "naver", "kakao"].includes(context.params?.id ?? "")
                  ? new Date()
                  : null,
            },
          }),
        },
        update: {
          before: async (session, context) => {
            const { oauthAuthenticatedAt: _ignored, ...data } = session as Record<string, unknown>;
            const createdAt = context?.context.session?.session.createdAt;
            if (data.expiresAt instanceof Date && createdAt) {
              data.expiresAt = new Date(
                Math.min(data.expiresAt.getTime(), createdAt.getTime() + AUTH_RETENTION_MS),
              );
            }
            // Hooks merge data with the original patch; explicitly unset this key
            // so even internal updates cannot overwrite the callback timestamp.
            return {
              data: { ...data, oauthAuthenticatedAt: undefined, ipAddress: null, userAgent: null },
            };
          },
        },
      },
      account: {
        create: {
          before: async (account) => ({ data: discardProviderCredentials(account) }),
        },
        update: {
          before: async (account) => ({ data: discardProviderCredentials(account) }),
        },
      },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { disableIpTracking: true },
      database: {
        generateId: "uuid",
      },
    },
  });
}

type Auth = ReturnType<typeof createConfiguredAuth>;

const authByDatabase = new WeakMap<D1Database, Auth>();

export function getAuth(env: Env): Auth {
  const cached = authByDatabase.get(env.DB);
  if (cached) return cached;

  const auth = createConfiguredAuth(env);
  authByDatabase.set(env.DB, auth);
  return auth;
}
