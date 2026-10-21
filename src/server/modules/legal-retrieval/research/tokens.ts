import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../../contracts";

const claims = z.strictObject({
  ownerId: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  revision: revisionSchema,
  sourceId: opaqueIdSchema,
  citationId: opaqueIdSchema,
  verifiedAt: timestampSchema,
  citationHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type ResearchClaims = z.infer<typeof claims>;
const prefix = "baro:precedent-research:v1:";
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("INVALID_RESEARCH_PROOF");
  return Uint8Array.from(
    atob(
      text
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(text.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
}
async function key(secret: string) {
  if (secret.length < 32) throw new Error("RESEARCH_NOT_CONFIGURED");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signResearchToken(secret: string, value: ResearchClaims) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(claims.parse(value))));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    new TextEncoder().encode(prefix + payload),
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyResearchToken(secret: string, token: string, now: number) {
  try {
    if (token.length > 4096) return null;
    const pieces = token.split(".");
    if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
    const signature = decode(pieces[1]);
    if (
      signature.length !== 32 ||
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        signature,
        new TextEncoder().encode(prefix + pieces[0]),
      ))
    )
      return null;
    const parsed = claims.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(pieces[0]))),
    );
    if (
      !parsed.success ||
      parsed.data.issuedAt > now ||
      parsed.data.expiresAt <= now ||
      parsed.data.expiresAt - parsed.data.issuedAt !== 600000
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}
