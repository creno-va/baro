import type { z } from "zod";
import { mobileAuthChallengeSchema } from "../../contracts/mobile-auth";
import { mobileDeletionActivityRequestSchema } from "../../contracts/mobile-deletion";
import { AuthConfigurationError } from "./env";
import { NativeAuthProofError, nativeAuthChallenge } from "./native-codes";

const contextSchema = mobileDeletionActivityRequestSchema
  .omit({ verifier: true, activityProof: true })
  .extend({ challenge: mobileAuthChallengeSchema });
/** Observation-only proof survives ephemeral-row cleanup. It grants neither login nor a deletion outcome. */
export function createNativeDeletionActivityProof(dependencies: {
  issuer: string;
  secret: string;
  now?: () => number;
}) {
  if (typeof dependencies.secret !== "string" || dependencies.secret.length < 32)
    throw new AuthConfigurationError("BETTER_AUTH_SECRET");
  const issuer = new URL(dependencies.issuer).origin,
    encoder = new TextEncoder(),
    now = dependencies.now ?? Date.now;
  const key = (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(dependencies.secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(issuer),
        info: encoder.encode("BARO native deletion activity observation v1"),
      },
      material,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    );
  })();
  const bytes = (input: z.infer<typeof contextSchema>) =>
    encoder.encode(
      JSON.stringify([
        issuer,
        "delete-account",
        "activity",
        1,
        input.attemptId,
        input.challenge,
        input.ownerTag,
        input.startedAt,
      ]),
    );
  return {
    async sign(raw: unknown) {
      const input = contextSchema.parse(raw);
      if (input.startedAt > now()) throw new NativeAuthProofError();
      const signature = await crypto.subtle.sign("HMAC", await key, bytes(input));
      return Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    async verify(raw: unknown) {
      const input = mobileDeletionActivityRequestSchema.parse(raw);
      if (input.startedAt > now()) throw new NativeAuthProofError();
      const context = contextSchema.parse({
        attemptId: input.attemptId,
        ownerTag: input.ownerTag,
        startedAt: input.startedAt,
        challenge: await nativeAuthChallenge(input.verifier),
      });
      const signature = Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(input.activityProof.slice(index * 2, index * 2 + 2), 16),
      );
      if (!(await crypto.subtle.verify("HMAC", await key, signature, bytes(context))))
        throw new NativeAuthProofError();
      return context;
    },
  };
}
