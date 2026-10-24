import type { BetterAuthPlugin } from "better-auth";
import { type OAuthProvider, verifyProviderIdToken } from "better-auth/oauth2";
import { z } from "zod";

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});

/** Bind the installed SDK's Apple redirect flow to its server-generated OAuth-state nonce. */
export function bindAppleIdentity(provider: OAuthProvider): OAuthProvider {
  if (provider.id !== "apple") return provider;
  const config = provider.idToken;
  if (!config || "verify" in config || typeof config.audience !== "string" || !config.audience)
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
    options: { ...provider.options, disableIdTokenSignIn: true },
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
      return provider.getUserInfo(tokens);
    },
  };
}

/** Does not configure or advertise Apple; existing three providers pass through unchanged. */
export function createAppleIdentityBinding(): BetterAuthPlugin {
  return {
    id: "baro-apple-identity",
    init(context) {
      return { context: { socialProviders: context.socialProviders.map(bindAppleIdentity) } };
    },
  };
}
