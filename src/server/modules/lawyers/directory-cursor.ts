import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";

export const directoryPositionSchema = z.strictObject({
  queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  day: z.string(),
  pivot: z.string().regex(/^[a-f0-9]{16}$/),
  epoch: z.number().int().positive(),
  phase: z.union([z.literal(0), z.literal(1)]),
  after: z.tuple([z.string().regex(/^[a-f0-9]{16}$/), opaqueIdSchema]).nullable(),
  expiresAt: z.iso.datetime(),
  viewId: z.uuid(),
  lead: z.strictObject({ kind: z.enum(["terms", "facets"]), key: z.string().max(1024) }),
});
export type DirectoryPosition = z.infer<typeof directoryPositionSchema>;
export class DirectoryIndexError extends Error {
  constructor(readonly code: "CURSOR_EXPIRED" | "INVALID_CURSOR" | "STORAGE_UNAVAILABLE") {
    super(code);
  }
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** Encrypted and authenticated: pagination must not reveal IDs belonging to
 * withdrawn candidates. Scope includes environment and release configuration. */
export function directoryCursorCodec(secret: string, scope: string) {
  if (secret.length < 32) throw new DirectoryIndexError("STORAGE_UNAVAILABLE");
  const encoder = new TextEncoder();
  const key = crypto.subtle
    .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
    .then((base) =>
      crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode("baro-directory-cursor-v1"),
          info: encoder.encode(scope),
        },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    );
  return {
    async seal(value: DirectoryPosition) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await key,
          encoder.encode(JSON.stringify(directoryPositionSchema.parse(value))),
        ),
      );
      const packed = new Uint8Array(iv.length + sealed.length);
      packed.set(iv);
      packed.set(sealed, iv.length);
      return encode(packed);
    },
    async open(cursor: string) {
      try {
        if (!/^[A-Za-z0-9_-]{32,2048}$/.test(cursor)) throw new Error();
        const bytes = Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
          c.charCodeAt(0),
        );
        if (encode(bytes) !== cursor) throw new Error();
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.slice(0, 12) },
          await key,
          bytes.slice(12),
        );
        return directoryPositionSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        );
      } catch {
        throw new DirectoryIndexError("INVALID_CURSOR");
      }
    },
  };
}
