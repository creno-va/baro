import { z } from "zod";
import { mobileAuthAttemptIdSchema, mobileAuthChallengeSchema } from "../../contracts/mobile-auth";
import {
  mobileDeletionExchangeSchema,
  mobileDeletionOutcomeSchema,
  mobileDeletionProofSchema,
} from "../../contracts/mobile-deletion";
import { AuthConfigurationError } from "./env";
import { NativeAuthProofError, nativeAuthChallenge } from "./native-codes";

export const NATIVE_DELETION_RECEIPT_TTL_MS = 10 * 60_000;
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const encode = (v: Uint8Array) =>
  btoa(Array.from(v, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const decode = (v: string) =>
  Uint8Array.from(
    atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (v.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
const envelopeSchema = z.strictObject({
  version: z.literal(1),
  expiresAt: z.number().int().nonnegative(),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z
    .string()
    .min(22)
    .max(8192)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const payloadSchema = z.strictObject({
  receiptId: z.uuid(),
  issuedAt: z.number().int().nonnegative(),
  challenge: mobileAuthChallengeSchema,
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  codeConsumed: z.boolean(),
  outcome: mobileDeletionOutcomeSchema,
});
export async function cleanupNativeDeletionReceipts(db: D1Database, now: number) {
  await db
    .prepare(`DELETE FROM app_metadata WHERE key>='native-deletion:v1:' AND key<'native-deletion:v1;'
    AND (json_valid(value)=0 OR json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt') IS NOT 'integer'
    OR json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.expiresAt')<=?)`)
    .bind(now)
    .run();
}

/** Tokenless completion only. It can never mint a session or serve as an authentication grant. */
export function createNativeDeletionReceipts(dependencies: {
  db: D1Database;
  issuer: string;
  secret: string;
  now?: () => number;
}) {
  if (typeof dependencies.secret !== "string" || dependencies.secret.length < 32)
    throw new AuthConfigurationError("BETTER_AUTH_SECRET");
  const issuer = new URL(dependencies.issuer).origin,
    now = dependencies.now ?? Date.now,
    encoder = new TextEncoder();
  const prefix = digest(issuer).then((v) => `native-deletion:v1:${v}:`);
  const name = async (attemptId: string) =>
    (await prefix) + (await digest(mobileAuthAttemptIdSchema.parse(attemptId)));
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
        info: encoder.encode("BARO native deletion completion v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  const aad = (storageKey: string, expiresAt: number) =>
    encoder.encode(JSON.stringify([issuer, storageKey, expiresAt, "delete-account", 1]));
  async function seal(
    storageKey: string,
    expiresAt: number,
    payload: z.infer<typeof payloadSchema>,
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(storageKey, expiresAt) },
      await key,
      encoder.encode(JSON.stringify(payload)),
    );
    return JSON.stringify({
      version: 1,
      expiresAt,
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(encrypted)),
    });
  }
  async function read(attemptId: string) {
    const storageKey = await name(attemptId),
      row = await dependencies.db
        .prepare("SELECT value FROM app_metadata WHERE key=?")
        .bind(storageKey)
        .first<{ value: string }>();
    if (!row) return null;
    try {
      const envelope = envelopeSchema.parse(JSON.parse(row.value)),
        time = now();
      if (envelope.expiresAt <= time || envelope.expiresAt > time + NATIVE_DELETION_RECEIPT_TTL_MS)
        throw new NativeAuthProofError();
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(envelope.iv),
          additionalData: aad(storageKey, envelope.expiresAt),
        },
        await key,
        decode(envelope.ciphertext),
      );
      const payload = payloadSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (
        payload.issuedAt > time ||
        payload.issuedAt + NATIVE_DELETION_RECEIPT_TTL_MS !== envelope.expiresAt
      )
        throw new NativeAuthProofError();
      return { storageKey, row: row.value, envelope, payload };
    } catch {
      throw new NativeAuthProofError();
    }
  }
  async function prove(raw: unknown) {
    const input = mobileDeletionProofSchema.parse(raw),
      record = await read(input.attemptId);
    if (!record) return null;
    if ((await nativeAuthChallenge(input.verifier)) !== record.payload.challenge)
      throw new NativeAuthProofError();
    return record;
  }
  return {
    async prepareCommit(raw: {
      attemptId: string;
      challenge: string;
      ownerTag: string;
      appleLinked: boolean;
    }) {
      const input = z
        .strictObject({
          attemptId: mobileAuthAttemptIdSchema,
          challenge: mobileAuthChallengeSchema,
          ownerTag: mobileDeletionOutcomeSchema.shape.ownerTag,
          appleLinked: z.boolean(),
        })
        .parse(raw);
      const storageKey = await name(input.attemptId),
        time = now(),
        code = encode(crypto.getRandomValues(new Uint8Array(32))),
        receiptId = crypto.randomUUID();
      const outcome = mobileDeletionOutcomeSchema.parse({
        contractVersion: 2,
        status: "accepted",
        ownerTag: input.ownerTag,
        appleRevocation: input.appleLinked ? "unconfirmed" : "not_linked",
      });
      const payload = payloadSchema.parse({
        receiptId,
        issuedAt: time,
        challenge: input.challenge,
        codeHash: await digest(code),
        codeConsumed: false,
        outcome,
      });
      return {
        attemptId: input.attemptId,
        receiptId,
        code,
        metadata: {
          key: storageKey,
          value: await seal(storageKey, time + NATIVE_DELETION_RECEIPT_TTL_MS, payload),
        },
      };
    },
    async status(raw: unknown) {
      return (await prove(raw))?.payload.outcome ?? null;
    },
    async exchange(raw: unknown) {
      const input = mobileDeletionExchangeSchema.parse(raw),
        record = await prove({ attemptId: input.attemptId, verifier: input.verifier });
      if (
        !record ||
        record.payload.codeConsumed ||
        (await digest(input.code)) !== record.payload.codeHash
      )
        throw new NativeAuthProofError();
      const value = await seal(record.storageKey, record.envelope.expiresAt, {
        ...record.payload,
        codeConsumed: true,
      });
      const result = await dependencies.db
        .prepare("UPDATE app_metadata SET value=?,updated_at=? WHERE key=? AND value=?")
        .bind(value, new Date(now()).toISOString(), record.storageKey, record.row)
        .run();
      if (result.meta.changes !== 1) throw new NativeAuthProofError();
      return record.payload.outcome;
    },
    async finish(
      handle: { attemptId: string; receiptId: string },
      status: "confirmed" | "unconfirmed",
    ) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const record = await read(handle.attemptId);
        if (
          !record ||
          record.payload.receiptId !== handle.receiptId ||
          record.payload.outcome.appleRevocation === "not_linked"
        )
          return false;
        if (record.payload.outcome.appleRevocation === "confirmed") return true;
        const payload = {
          ...record.payload,
          outcome: { ...record.payload.outcome, appleRevocation: status },
        };
        const result = await dependencies.db
          .prepare("UPDATE app_metadata SET value=?,updated_at=? WHERE key=? AND value=?")
          .bind(
            await seal(record.storageKey, record.envelope.expiresAt, payload),
            new Date(now()).toISOString(),
            record.storageKey,
            record.row,
          )
          .run();
        if (result.meta.changes === 1) return true;
      }
      return false;
    },
  };
}
