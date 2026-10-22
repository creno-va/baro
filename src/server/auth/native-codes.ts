import { z } from "zod";
import {
  type MobileAuthExchange,
  type MobileAuthStart,
  mobileAuthExchangeSchema,
  mobileAuthStartSchema,
} from "../../contracts/mobile-auth";
import { AuthConfigurationError } from "./env";
import { AUTH_RETENTION_MS, RECENT_OAUTH_MS } from "./policy";

export const NATIVE_AUTH_CODE_TTL_MS = 60_000;
const encoder = new TextEncoder();
const storedSchema = z.strictObject({
  version: z.literal(1),
  expiresAt: z.number().int().nonnegative(),
  userId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z
    .string()
    .min(22)
    .max(44000)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const payloadSchema = mobileAuthStartSchema.extend({
  sessionId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  cookie: z.string().min(1).max(16000),
});
export class NativeAuthProofError extends Error {
  constructor() {
    super("NATIVE_AUTH_PROOF_INVALID");
    this.name = "NativeAuthProofError";
  }
}
const encode = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
export async function nativeAuthChallenge(verifier: string) {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const activeSession = `EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id
  WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND s.created_at>? AND s.created_at<=?
  AND s.oauth_authenticated_at IS NOT NULL AND s.oauth_authenticated_at<=? AND s.oauth_authenticated_at>=?
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='account' AND t.target_id=s.user_id))`;

export async function cleanupNativeAuthCodes(db: D1Database, now: number) {
  await db
    .prepare(`DELETE FROM app_metadata WHERE key>='native-auth:v1:' AND key<'native-auth:v1;'
    AND (json_valid(value)=0 OR json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt') IS NOT 'integer'
    OR json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt')<=?)`)
    .bind(now)
    .run();
}

/** An opaque one-use grant. Cookie/session claims are encrypted and never appear in redirect URLs. */
export function createNativeAuthCodeStore(dependencies: {
  db: D1Database;
  secret: string;
  issuer: string;
  now?: () => number;
}) {
  if (typeof dependencies.secret !== "string" || dependencies.secret.length < 32)
    throw new AuthConfigurationError("BETTER_AUTH_SECRET");
  const issuer = new URL(dependencies.issuer).origin;
  const now = dependencies.now ?? Date.now;
  const namespace = digest(issuer).then((hash) => `native-auth:v1:${hash}:`);
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
        info: encoder.encode("BARO native OAuth code v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  const sessionArgs = (sessionId: string, userId: string, time: number) => [
    sessionId,
    userId,
    time,
    time - AUTH_RETENTION_MS,
    time,
    time,
    time - RECENT_OAUTH_MS,
  ];
  const aad = (
    storageKey: string,
    record: { expiresAt: number; userId: string; sessionId: string },
  ) =>
    encoder.encode(
      JSON.stringify([issuer, storageKey, record.expiresAt, record.userId, record.sessionId, 1]),
    );
  return {
    async issue(raw: MobileAuthStart & { sessionId: string; userId: string; cookie: string }) {
      const payload = payloadSchema.parse(raw);
      const code = encode(crypto.getRandomValues(new Uint8Array(32)));
      const prefix = await namespace;
      const storageKey = prefix + (await digest(code));
      const time = now(),
        expiresAt = time + NATIVE_AUTH_CODE_TTL_MS;
      const metadata = { expiresAt, userId: payload.userId, sessionId: payload.sessionId };
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(storageKey, metadata) },
        await key,
        encoder.encode(JSON.stringify(payload)),
      );
      const value = JSON.stringify({
        version: 1,
        ...metadata,
        iv: encode(iv),
        ciphertext: encode(new Uint8Array(encrypted)),
      });
      const result = await dependencies.db
        .prepare(
          `INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? WHERE ${activeSession}`,
        )
        .bind(
          storageKey,
          value,
          new Date(time).toISOString(),
          ...sessionArgs(payload.sessionId, payload.userId, time),
        )
        .run();
      if (result.meta.changes !== 1) throw new NativeAuthProofError();
      // Cron performs observable cleanup too; maintenance cannot lose an issued grant.
      try {
        await cleanupNativeAuthCodes(dependencies.db, time);
      } catch {
        /* Cron retries safely. */
      }
      return { code, attemptId: payload.attemptId };
    },
    async exchange(raw: MobileAuthExchange): Promise<string> {
      const request = mobileAuthExchangeSchema.safeParse(raw);
      if (!request.success) throw new NativeAuthProofError();
      const storageKey = (await namespace) + (await digest(request.data.code));
      const row = await dependencies.db
        .prepare("SELECT value FROM app_metadata WHERE key=?")
        .bind(storageKey)
        .first<{ value: string }>();
      if (!row) throw new NativeAuthProofError();
      let payload: z.infer<typeof payloadSchema>;
      let record: z.infer<typeof storedSchema>;
      const time = now();
      try {
        record = storedSchema.parse(JSON.parse(row.value));
        if (record.expiresAt <= time || record.expiresAt > time + NATIVE_AUTH_CODE_TTL_MS)
          throw new NativeAuthProofError();
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(record.iv),
            additionalData: aad(storageKey, record),
          },
          await key,
          decode(record.ciphertext),
        );
        payload = payloadSchema.parse(JSON.parse(new TextDecoder().decode(decrypted)));
        if (payload.userId !== record.userId || payload.sessionId !== record.sessionId)
          throw new NativeAuthProofError();
      } catch {
        throw new NativeAuthProofError();
      }
      const challenge = await nativeAuthChallenge(request.data.verifier);
      let difference = 0;
      for (let i = 0; i < challenge.length; i++)
        difference |= challenge.charCodeAt(i) ^ (payload.challenge.charCodeAt(i) || 0);
      if (
        difference ||
        challenge.length !== payload.challenge.length ||
        payload.attemptId !== request.data.attemptId
      )
        throw new NativeAuthProofError();
      const consumedAt = now();
      if (record.expiresAt <= consumedAt || record.expiresAt > consumedAt + NATIVE_AUTH_CODE_TTL_MS)
        throw new NativeAuthProofError();
      // A valid proof consumes once and rechecks the exact active OAuth session atomically.
      const consumed = await dependencies.db
        .prepare(
          `DELETE FROM app_metadata WHERE key=? AND value=? AND ${activeSession} RETURNING key`,
        )
        .bind(storageKey, row.value, ...sessionArgs(payload.sessionId, payload.userId, consumedAt))
        .first<{ key: string }>();
      if (!consumed) throw new NativeAuthProofError();
      return payload.cookie;
    },
  };
}
