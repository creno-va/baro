import type { BetterAuthPlugin } from "better-auth";
import { getOAuthState } from "better-auth/api";
import { type OAuthProvider, verifyProviderIdToken } from "better-auth/oauth2";
import { z } from "zod";

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});
const linkedIdentitySchema = z.object({
  ownerId: z.string().min(1).max(128),
  email: z.email().max(320),
  emailVerified: z.boolean(),
});
type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;
// Keys are SDK request-local state objects, never client-supplied marker fields or durable tokens.
const linkedCallbacks = new WeakMap<object, { ownerId: string; subject: string }>();
async function linkedCallback() {
  try {
    const state = await getOAuthState();
    if (!state) throw new Error("APPLE_LINKED_CALLBACK_CONTEXT_REQUIRED");
    return linkedCallbacks.get(state) ?? null;
  } catch {
    throw new Error("APPLE_LINKED_CALLBACK_CONTEXT_REQUIRED");
  }
}
export async function isAppleLinkedCallback(inAppleCallback: boolean) {
  return inAppleCallback && Boolean(await linkedCallback());
}
export async function appleLinkedSessionAllowed(
  db: D1Database,
  ownerId: string,
  inAppleCallback: boolean,
) {
  if (!inAppleCallback) return true;
  const linked = await linkedCallback();
  if (!linked) return true;
  return (
    ownerId === linked.ownerId &&
    (await findAppleLinkedIdentity(db, linked.subject))?.ownerId === ownerId
  );
}
export async function appleLinkedAccountUpdateAllowed(db: D1Database, inAppleCallback: boolean) {
  if (!inAppleCallback) return true;
  const linked = await linkedCallback();
  return !linked || (await findAppleLinkedIdentity(db, linked.subject))?.ownerId === linked.ownerId;
}

/** Only an existing exact Apple subject supplies a missing email; no email-based owner guessing. */
export async function findAppleLinkedIdentity(
  db: D1Database,
  subject: string,
): Promise<LinkedIdentity | null> {
  const rows = await db
    .prepare(`SELECT u.id AS owner_id,u.email,u.email_verified FROM account a JOIN user u ON u.id=a.user_id
    WHERE a.provider_id='apple' AND a.account_id=?
    AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='account' AND t.target_id=u.id)
    LIMIT 2`)
    .bind(subject)
    .all<{ owner_id: string; email: string; email_verified: number }>();
  if (rows.results.length !== 1) return null;
  const row = rows.results[0];
  if (!row || ![0, 1].includes(row.email_verified)) return null;
  const result = linkedIdentitySchema.safeParse({
    ownerId: row.owner_id,
    email: row.email,
    emailVerified: row.email_verified === 1,
  });
  return result.success ? result.data : null;
}

/** Bind the installed SDK's Apple redirect flow to its server-generated OAuth-state nonce. */
export function bindAppleIdentity(
  provider: OAuthProvider,
  resolveLinkedIdentity?: (subject: string) => Promise<LinkedIdentity | null>,
): OAuthProvider {
  if (provider.id !== "apple") return provider;
  const config = provider.idToken;
  if (
    !config ||
    "verify" in config ||
    typeof config.audience !== "string" ||
    !config.audience ||
    (provider.callbackPath && provider.callbackPath !== "/callback/apple")
  )
    throw new Error("APPLE_IDENTITY_CONFIGURATION_REQUIRED");
  const verifier: OAuthProvider = {
    ...provider,
    // Do not permit provider options/custom verification to bypass these checks.
    options: {},
    idToken: {
      jwks: config.jwks,
      issuer: "https://appleid.apple.com",
      audience: config.audience,
      algorithms: ["RS256"],
      maxTokenAge: "1h",
      nonceComparison: "exact",
      verifyClaims(payload) {
        const claims = claimsSchema.safeParse(payload);
        return claims.success && claims.data.exp > Math.floor(Date.now() / 1000);
      },
    },
  };
  return {
    ...provider,
    idToken: verifier.idToken,
    requiresIdTokenNonce: true,
    // Only the browser callback carrying server state may establish Apple identity.
    options: { ...provider.options, disableIdTokenSignIn: true, overrideUserInfoOnSignIn: false },
    async createAuthorizationURL(input) {
      const nonce = nonceSchema.safeParse(input.idTokenNonce);
      if (!nonce.success) throw new Error("APPLE_AUTH_NONCE_REQUIRED");
      const url = await provider.createAuthorizationURL(input);
      if (`${url.origin}${url.pathname}` !== "https://appleid.apple.com/auth/authorize")
        throw new Error("APPLE_AUTHORIZATION_ENDPOINT_REQUIRED");
      url.searchParams.set("nonce", nonce.data);
      return url;
    },
    async getUserInfo(tokens) {
      if (
        !tokens.idToken ||
        tokens.idToken.length > 16_384 ||
        !nonceSchema.safeParse(tokens.expectedIdTokenNonce).success ||
        !(await verifyProviderIdToken(verifier, tokens.idToken, tokens.expectedIdTokenNonce))
      )
        return null;
      const info = await provider.getUserInfo(tokens);
      if (!info || info.user.email || !resolveLinkedIdentity) return info;
      const claims = claimsSchema.safeParse(info.data);
      if (!claims.success) return null;
      const linked = await resolveLinkedIdentity(claims.data.sub);
      if (!linked) return null;
      return {
        ...info,
        // A stored email is not a new Apple email-verification claim and cannot authorize implicit linking.
        user: { ...info.user, email: linked.email, emailVerified: false },
      };
    },
  };
}

/** Does not configure or advertise Apple; existing three providers pass through unchanged. */
export function createAppleIdentityBinding(db: D1Database): BetterAuthPlugin {
  return {
    id: "baro-apple-identity",
    init(context) {
      return {
        context: {
          socialProviders: context.socialProviders.map((provider) =>
            bindAppleIdentity(provider, async (subject) => {
              const identity = await findAppleLinkedIdentity(db, subject);
              if (!identity) return null;
              const state = await getOAuthState();
              if (!state) return null;
              linkedCallbacks.set(state, { ownerId: identity.ownerId, subject });
              return identity;
            }),
          ),
        },
      };
    },
  };
}
