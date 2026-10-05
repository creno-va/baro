import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../db/schema";
import { parseAuthEnvironment } from "./env";

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
    databaseHooks: {
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
