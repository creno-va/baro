import { z } from "zod";

const configurationSchema = z.object({
  APPLE_AUTH_ENABLED: z.literal("true"),
  APPLE_CLIENT_ID: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]+$/),
  APPLE_CLIENT_SECRET: z.string().min(1).max(16384),
});
const headerSchema = z.object({ alg: z.literal("ES256"), kid: z.string().regex(/^[A-Z0-9]{10}$/) });
const claimsSchema = z.object({
  iss: z.string().regex(/^[A-Z0-9]{10}$/),
  sub: z.string(),
  aud: z.literal("https://appleid.apple.com"),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
function decode(value: string) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(
        atob(
          value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4),
        ),
        (char) => char.charCodeAt(0),
      ),
    ),
  );
}
/** Configuration metadata only; Apple still verifies the developer signature and actual credential. */
export function appleConfiguration(environment: unknown, now = Date.now()) {
  const parsed = configurationSchema.safeParse(environment);
  if (!parsed.success) return null;
  try {
    const segments = parsed.data.APPLE_CLIENT_SECRET.split(".");
    if (
      segments.length !== 3 ||
      segments.some((value) => !value || !/^[A-Za-z0-9_-]+$/.test(value)) ||
      segments[2]?.length !== 86
    )
      return null;
    headerSchema.parse(decode(segments[0] ?? ""));
    const claims = claimsSchema.parse(decode(segments[1] ?? "")),
      seconds = Math.floor(now / 1000);
    if (
      claims.sub !== parsed.data.APPLE_CLIENT_ID ||
      claims.iat > seconds ||
      claims.exp <= seconds ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 15777000 ||
      claims.exp - seconds > 15777000
    )
      return null;
    return { clientId: parsed.data.APPLE_CLIENT_ID, clientSecret: parsed.data.APPLE_CLIENT_SECRET };
  } catch {
    return null;
  }
}
