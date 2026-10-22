import { ApiError } from "@baro/api-client";
import { mobileAuthChallengeSchema, mobileAuthVerifierSchema } from "@baro/contracts/mobile-auth";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function encodeProofBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("MOBILE_AUTH_ENTROPY_INVALID");
  let encoded = "",
    bits = 0,
    buffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += alphabet[(buffer >>> bits) & 63];
    }
  }
  if (bits) encoded += alphabet[(buffer << (6 - bits)) & 63];
  return mobileAuthVerifierSchema.parse(encoded);
}
export async function createNativeProof(dependencies: {
  randomBytes: () => Promise<Uint8Array>;
  sha256: (verifier: string) => Promise<Uint8Array>;
}) {
  try {
    const verifier = encodeProofBytes(await dependencies.randomBytes());
    const challenge = mobileAuthChallengeSchema.parse(
      encodeProofBytes(await dependencies.sha256(verifier)),
    );
    return { verifier, challenge };
  } catch {
    throw new ApiError(
      "UNAVAILABLE",
      "안전한 로그인을 시작하지 못했어요. 다시 시도해 주세요.",
      true,
    );
  }
}
