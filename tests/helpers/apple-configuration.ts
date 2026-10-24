const seconds = Math.floor(Date.now() / 1000);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
export function syntheticAppleConfiguration(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  // Shape-only operator metadata, deliberately not an Apple-accepted credential.
  return {
    APPLE_AUTH_ENABLED: "true",
    APPLE_CLIENT_ID: "site.baro.synthetic",
    APPLE_CLIENT_SECRET: `${encode({ alg: "ES256", kid: "SYNTHKEY01", ...header })}.${encode({ iss: "SYNTHTEAM1", aud: "https://appleid.apple.com", sub: "site.baro.synthetic", iat: seconds - 60, exp: seconds + 3600, ...claims })}.${"a".repeat(86)}`,
  };
}
