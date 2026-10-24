import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../db/schema";
import { createAppleCallbackBoundary, isAppleFormCallback } from "./apple-callback";
import { appleConfiguration } from "./apple-configuration";
import {
  appleLinkedAccountUpdateAllowed,
  appleLinkedSessionAllowed,
  createAppleIdentityBinding,
  hasVerifiedAppleCallback,
  isAppleLinkedCallback,
} from "./apple-identity";
import { parseAuthEnvironment } from "./env";
import { createNativeExpoIntegration, nativeAuthCallbackBase } from "./native-expo";
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
  const nativeCallback = nativeAuthCallbackBase(env.APP_ENV);
  const apple = appleConfiguration(env);

  return betterAuth({
    appName: "BARO",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: (request) => [
      origin,
      ...(nativeCallback ? [`${new URL(nativeCallback).protocol}//`] : []),
      ...(apple && isAppleFormCallback(request) ? ["https://appleid.apple.com"] : []),
    ],
    plugins: [
      createAppleCallbackBoundary(),
      createAppleIdentityBinding(env.DB),
      createNativeExpoIntegration(env),
    ],
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
      ...(apple ? { apple: { clientId: apple.clientId, clientSecret: apple.clientSecret } } : {}),
    },
    account: {
      accountLinking: {
        // The same verified email may use another OAuth provider without losing
        // its owner/data. Neither an unverified local email nor an unverified
        // provider claim is enough to attach a new sign-in method.
        enabled: true,
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        trustedProviders: [],
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
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
      user: {
        create: {
          before: async (_user, context) => {
            if (
              await isAppleLinkedCallback(
                context?.path === "/callback/:id" && context.params?.id === "apple",
              )
            )
              return false;
            return undefined;
          },
        },
        update: {
          before: async (_user, context) => {
            if (
              await isAppleLinkedCallback(
                context?.path === "/callback/:id" && context.params?.id === "apple",
              )
            )
              return false;
            return undefined;
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            if (
              !(await appleLinkedSessionAllowed(
                env.DB,
                session.userId,
                context?.path === "/callback/:id" && context.params?.id === "apple",
              ))
            )
              return false;
            return {
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
                // Only a completed provider callback can establish recent OAuth authentication.
                oauthAuthenticatedAt:
                  context?.path === "/callback/:id" &&
                  (["google", "naver", "kakao"].includes(context.params?.id ?? "") ||
                    (context.params?.id === "apple" &&
                      (await hasVerifiedAppleCallback(env.DB, session.userId))))
                    ? new Date()
                    : null,
              },
            };
          },
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
          before: async (account, context) => {
            if (
              await isAppleLinkedCallback(
                context?.path === "/callback/:id" && context.params?.id === "apple",
              )
            )
              return false;
            return { data: discardProviderCredentials(account) };
          },
        },
        update: {
          before: async (account, context) => {
            if (
              !(await appleLinkedAccountUpdateAllowed(
                env.DB,
                context?.path === "/callback/:id" && context.params?.id === "apple",
              ))
            )
              return false;
            return { data: discardProviderCredentials(account) };
          },
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

const authByEnvironment = new WeakMap<
  Env,
  { auth: Auth; apple: ReturnType<typeof appleConfiguration> }
>();

export function getAuth(env: Env): Auth {
  const apple = appleConfiguration(env);
  const cached = authByEnvironment.get(env);
  if (
    cached &&
    cached.apple?.clientId === apple?.clientId &&
    cached.apple?.clientSecret === apple?.clientSecret
  )
    return cached.auth;

  const auth = createConfiguredAuth(env);
  authByEnvironment.set(env, { auth, apple });
  return auth;
}
