import { z } from "zod";
import { mobileReauthPrepareV2Schema, mobileReauthProofSchema } from "../../contracts/mobile-auth";
import {
  mobileDeletionPrepareSchema,
  mobileDeletionProofSchema,
} from "../../contracts/mobile-deletion";
import { AuthConfigurationError } from "./env";
import { NativeAuthProofError, nativeAuthChallenge } from "./native-codes";
import { AUTH_RETENTION_MS, RECENT_OAUTH_MS } from "./policy";

export const NATIVE_REAUTH_TTL_MS = 10 * 60_000;
type Actor = { userId: string; sessionId: string };
const encoder = new TextEncoder();
const envelopeSchema = z.strictObject({
  version: z.literal(1),
  expiresAt: z.number().int().nonnegative(),
  userId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  operation: z.literal("delete-account").optional(),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z
    .string()
    .min(22)
    .max(8192)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const payloadSchema = mobileReauthPrepareV2Schema.extend({
  startedAt: z.number().int().nonnegative(),
  newSessionId: z.string().min(1).max(128).nullable(),
  operation: z.literal("delete-account").optional(),
});
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
const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const active = `EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=? AND s.user_id=?
  AND s.expires_at>? AND s.created_at>? AND s.created_at<=?
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='account' AND t.target_id=s.user_id))`;
const linked = "EXISTS(SELECT 1 FROM account a WHERE a.user_id=? AND a.provider_id=?)";
const fresh = `EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>?
  AND s.created_at>? AND s.created_at<=? AND s.oauth_authenticated_at>=? AND s.oauth_authenticated_at<=?
  AND s.oauth_authenticated_at>=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='account' AND t.target_id=s.user_id))`;
const activeArgs = (a: Actor, now: number) => [
  a.sessionId,
  a.userId,
  now,
  now - AUTH_RETENTION_MS,
  now,
];
const freshArgs = (a: Actor, startedAt: number, now: number) => [
  ...activeArgs(a, now),
  startedAt,
  now,
  now - RECENT_OAUTH_MS,
];

export async function cleanupNativeReauthentication(db: D1Database, now: number) {
  await db
    .prepare(`DELETE FROM app_metadata WHERE key>='native-reauth:v1:' AND key<'native-reauth:v1;'
    AND (json_valid(value)=0 OR json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt') IS NOT 'integer'
    OR json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt')<=?)`)
    .bind(now)
    .run();
}
/** One live preparation per original native session. No cookie, token, verifier or case contents are stored. */
export function createNativeReauthentication(dependencies: {
  db: D1Database;
  issuer: string;
  secret: string;
  now?: () => number;
}) {
  if (typeof dependencies.secret !== "string" || dependencies.secret.length < 32)
    throw new AuthConfigurationError("BETTER_AUTH_SECRET");
  const issuer = new URL(dependencies.issuer).origin,
    now = dependencies.now ?? Date.now;
  const prefix = digest(issuer).then((hash) => `native-reauth:v1:${hash}:`);
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
        info: encoder.encode("BARO native reauthentication v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  const storageKey = async (attemptId: string) => (await prefix) + (await digest(attemptId));
  const aad = (
    name: string,
    record: Pick<
      z.infer<typeof envelopeSchema>,
      "userId" | "sessionId" | "expiresAt" | "operation"
    >,
  ) =>
    encoder.encode(
      JSON.stringify([
        issuer,
        name,
        record.userId,
        record.sessionId,
        record.expiresAt,
        1,
        ...(record.operation ? [record.operation] : []),
      ]),
    );
  async function seal(
    name: string,
    metadata: Pick<
      z.infer<typeof envelopeSchema>,
      "userId" | "sessionId" | "expiresAt" | "operation"
    >,
    payload: z.infer<typeof payloadSchema>,
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(name, metadata) },
      await key,
      encoder.encode(JSON.stringify(payload)),
    );
    return JSON.stringify({
      version: 1,
      ...metadata,
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(encrypted)),
    });
  }
  async function read(attemptId: string) {
    const name = await storageKey(attemptId),
      row = await dependencies.db
        .prepare("SELECT value FROM app_metadata WHERE key=?")
        .bind(name)
        .first<{ value: string }>();
    if (!row) throw new NativeAuthProofError();
    try {
      const envelope = envelopeSchema.parse(JSON.parse(row.value)),
        time = now();
      if (envelope.expiresAt <= time || envelope.expiresAt > time + NATIVE_REAUTH_TTL_MS)
        throw new NativeAuthProofError();
      const raw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(envelope.iv), additionalData: aad(name, envelope) },
        await key,
        decode(envelope.ciphertext),
      );
      const payload = payloadSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
      if (
        payload.attemptId !== attemptId ||
        payload.startedAt + NATIVE_REAUTH_TTL_MS !== envelope.expiresAt ||
        payload.startedAt > time ||
        payload.operation !== envelope.operation
      )
        throw new NativeAuthProofError();
      return { name, row: row.value, envelope, payload };
    } catch {
      throw new NativeAuthProofError();
    }
  }
  async function prepare(
    input: z.infer<typeof mobileReauthPrepareV2Schema>,
    actor: Actor,
    operation: "reauthenticate" | "delete-account",
  ) {
    const time = now(),
      name = await storageKey(input.attemptId);
    const value = await seal(
      name,
      {
        ...actor,
        expiresAt: time + NATIVE_REAUTH_TTL_MS,
        ...(operation === "delete-account" ? { operation } : {}),
      },
      {
        ...input,
        startedAt: time,
        newSessionId: null,
        ...(operation === "delete-account" ? { operation } : {}),
      },
    );
    const low = await prefix,
      high = `${low.slice(0, -1)};`;
    const unusedReceipt =
      operation === "delete-account"
        ? " AND NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?)"
        : "";
    const unusedArgs =
      operation === "delete-account" ? [name.replace("native-reauth:", "native-deletion:")] : [];
    const result = await dependencies.db.batch([
      dependencies.db
        .prepare(
          `DELETE FROM app_metadata WHERE key>=? AND key<? AND key<>? AND json_valid(value)=1 AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.sessionId')=? AND ${active} AND ${linked}${unusedReceipt}`,
        )
        .bind(
          low,
          high,
          name,
          actor.sessionId,
          ...activeArgs(actor, time),
          actor.userId,
          input.provider,
          ...unusedArgs,
        ),
      dependencies.db
        .prepare(
          `INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? WHERE ${active} AND ${linked}${unusedReceipt} ON CONFLICT(key) DO NOTHING`,
        )
        .bind(
          name,
          value,
          new Date(time).toISOString(),
          ...activeArgs(actor, time),
          actor.userId,
          input.provider,
          ...unusedArgs,
        ),
    ]);
    if (result[1]?.meta.changes !== 1) throw new NativeAuthProofError();
    try {
      await cleanupNativeReauthentication(dependencies.db, time);
    } catch {
      /* Maintenance cannot invalidate an accepted preparation. */
    }
    return { startedAt: time };
  }
  async function authorize(
    input: { attemptId: string; challenge: string },
    provider: string,
    actor: Actor,
    operation: "reauthenticate" | "delete-account",
  ) {
    const record = await read(input.attemptId),
      { payload, envelope } = record;
    if (
      (payload.operation ?? "reauthenticate") !== operation ||
      payload.newSessionId ||
      envelope.userId !== actor.userId ||
      payload.provider !== provider ||
      payload.challenge !== input.challenge ||
      envelope.sessionId === actor.sessionId
    )
      throw new NativeAuthProofError();
    const value = await seal(record.name, envelope, {
      ...payload,
      newSessionId: actor.sessionId,
    });
    const time = now();
    if (envelope.expiresAt <= time) throw new NativeAuthProofError();
    const result = await dependencies.db
      .prepare(
        `UPDATE app_metadata SET value=?,updated_at=? WHERE key=? AND value=? AND ${active} AND ${fresh} AND ${linked}`,
      )
      .bind(
        value,
        new Date(time).toISOString(),
        record.name,
        record.row,
        ...activeArgs({ userId: envelope.userId, sessionId: envelope.sessionId }, time),
        ...freshArgs(actor, payload.startedAt, time),
        actor.userId,
        provider,
      )
      .run();
    if (result.meta.changes !== 1) throw new NativeAuthProofError();
    return {
      originalSessionId: envelope.sessionId,
      guard: { key: record.name, value, originalSessionId: envelope.sessionId },
    };
  }
  return {
    prepare(raw: unknown, actor: Actor) {
      return prepare(mobileReauthPrepareV2Schema.parse(raw), actor, "reauthenticate");
    },
    prepareDeletion(raw: unknown, actor: Actor) {
      const { confirmation: _confirmation, ...input } = mobileDeletionPrepareSchema.parse(raw);
      return prepare(input, actor, "delete-account");
    },
    async authorize(
      input: { attemptId: string; challenge: string },
      provider: string,
      actor: Actor,
    ) {
      const result = await authorize(input, provider, actor, "reauthenticate");
      return { originalSessionId: result.originalSessionId };
    },
    authorizeDeletion(
      input: { attemptId: string; challenge: string },
      provider: string,
      actor: Actor,
    ) {
      return authorize(input, provider, actor, "delete-account");
    },
    async cancelDeletion(raw: unknown) {
      const input = mobileDeletionProofSchema.parse(raw);
      for (let attempt = 0; attempt < 2; attempt++) {
        const record = await read(input.attemptId);
        if (
          record.payload.operation !== "delete-account" ||
          (await nativeAuthChallenge(input.verifier)) !== record.payload.challenge
        )
          throw new NativeAuthProofError();
        const result = await dependencies.db
          .prepare("DELETE FROM app_metadata WHERE key=? AND value=?")
          .bind(record.name, record.row)
          .run();
        if (result.meta.changes === 1) return true;
      }
      return false;
    },
    async verify(raw: unknown, actor: Actor) {
      const input = mobileReauthProofSchema.parse(raw),
        record = await read(input.attemptId);
      if (
        record.payload.operation !== undefined ||
        record.envelope.userId !== actor.userId ||
        record.payload.newSessionId !== actor.sessionId ||
        (await nativeAuthChallenge(input.verifier)) !== record.payload.challenge
      )
        throw new NativeAuthProofError();
      const time = now();
      if (record.envelope.expiresAt <= time) throw new NativeAuthProofError();
      const exists = await dependencies.db
        .prepare(`SELECT 1 AS ok WHERE ${fresh}`)
        .bind(...freshArgs(actor, record.payload.startedAt, time))
        .first();
      if (!exists) throw new NativeAuthProofError();
      return { startedAt: record.payload.startedAt };
    },
  };
}
