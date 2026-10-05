export const MAX_PLAINTEXT_BYTES = 256 * 1024;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_ID_LENGTH = 32;
const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + TAG_BYTES;
const MAX_CIPHERTEXT_CHARACTERS = Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3);
export const MAX_ENVELOPE_CHARACTERS = 2 + 3 + MAX_KEY_ID_LENGTH + 16 + MAX_CIPHERTEXT_CHARACTERS;

export const V2_PRIVATE_TABLES = [
  "v2_workspaces",
  "v2_intakes",
  "v2_question_batches",
  "v2_answers",
  "v2_facts",
  "v2_parties",
  "v2_messages",
  "v2_actions",
  "v2_timeline",
  "v2_files",
  "v2_file_derivatives",
  "v2_file_observations",
  "v2_applications",
  "v2_profile_revisions",
  "v2_moderation_decisions",
  "v2_assets",
  "v2_reports",
  "v2_consents",
  "v2_job_checkpoints",
  "v2_private_snapshots",
  "v2_moderation_reports",
  "v2_upload_parts",
  "v2_upload_sessions",
  "v2_upgrade_stages",
  "v2_file_edit_stages",
  "v2_summary_edit_stages",
  "v2_summary_edit_cursors",
  "v2_blobs",
  "v2_report_selections",
] as const;
export const V2_SNAPSHOT_PURPOSES = [
  "summary",
  "report",
  "file_coverage",
  "file_manifest",
  "legacy_snapshot",
  "profile_revision",
] as const;
type EncryptedField =
  | { table: "cases"; column: "encrypted_input" }
  | {
      table: "analyses";
      column: "encrypted_context" | "encrypted_answers" | "encrypted_result";
    }
  | { table: (typeof V2_PRIVATE_TABLES)[number]; column: "encrypted_payload"; revision: number }
  | {
      table: "v2_private_parts";
      column: "encrypted_payload";
      revision: number;
      targetId: string;
      purpose: (typeof V2_SNAPSHOT_PURPOSES)[number];
      part: number;
    };

export type EncryptionContext = EncryptedField & { rowId: string; userId: string };

export interface EnvelopeCipher {
  encrypt(plaintext: string, context: EncryptionContext): Promise<string>;
  decrypt(envelope: string, context: EncryptionContext): Promise<string>;
}

export interface EnvelopeKeyring {
  activeKeyId: string;
  /** Explicit server-owned allowlist; values are canonical unpadded base64url 32-byte secrets. */
  keys: Readonly<Record<string, string>>;
}

export type CryptoErrorCode =
  | "CRYPTO_CONFIGURATION_INVALID"
  | "CRYPTO_ENCRYPT_FAILED"
  | "CRYPTO_DECRYPT_FAILED";

export class CaseDataCryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode) {
    super(code);
    this.name = "CaseDataCryptoError";
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const opaqueIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const base64urlPattern = /^[A-Za-z0-9_-]+$/;

function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64url(encoded: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (
    typeof encoded !== "string" ||
    encoded.length > Math.ceil((maxBytes * 4) / 3) ||
    !base64urlPattern.test(encoded)
  ) {
    throw new Error();
  }
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  // Reject padding, alternate alphabets and nonzero unused bits, not just invalid bytes.
  if (bytes.byteLength > maxBytes || encodeBase64url(bytes) !== encoded) throw new Error();
  return bytes;
}

function additionalData(context: EncryptionContext): Uint8Array<ArrayBuffer> {
  if (context.table.startsWith("v2_")) {
    const v2 = context as Extract<EncryptionContext, { revision: number }>;
    const allowedKeys =
      v2.table === "v2_private_parts"
        ? ["table", "column", "rowId", "userId", "revision", "targetId", "purpose", "part"]
        : ["table", "column", "rowId", "userId", "revision"];
    if (
      Object.keys(v2).length !== allowedKeys.length ||
      Object.keys(v2).some((key) => !allowedKeys.includes(key)) ||
      typeof v2.rowId !== "string" ||
      typeof v2.userId !== "string" ||
      !opaqueIdPattern.test(v2.rowId) ||
      !opaqueIdPattern.test(v2.userId) ||
      v2.column !== "encrypted_payload" ||
      !Number.isSafeInteger(v2.revision) ||
      v2.revision < 1
    )
      throw new Error();
    if (v2.table === "v2_private_parts") {
      if (
        typeof v2.targetId !== "string" ||
        !opaqueIdPattern.test(v2.targetId) ||
        !V2_SNAPSHOT_PURPOSES.includes(v2.purpose) ||
        !Number.isSafeInteger(v2.part) ||
        v2.part < 0
      )
        throw new Error();
      return encoder.encode(
        `v2:${v2.table}:${v2.rowId}:${v2.column}:${v2.userId}:${v2.revision}:${v2.purpose}:${v2.targetId}:${v2.part}`,
      );
    }
    if (!V2_PRIVATE_TABLES.includes(v2.table)) throw new Error();
    return encoder.encode(`v2:${v2.table}:${v2.rowId}:${v2.column}:${v2.userId}:${v2.revision}`);
  }
  const validField =
    (context.table === "cases" && context.column === "encrypted_input") ||
    (context.table === "analyses" &&
      ["encrypted_context", "encrypted_answers", "encrypted_result"].includes(context.column));
  if (
    !validField ||
    typeof context.rowId !== "string" ||
    typeof context.userId !== "string" ||
    !opaqueIdPattern.test(context.rowId) ||
    !opaqueIdPattern.test(context.userId)
  ) {
    throw new Error();
  }
  return encoder.encode(`${context.table}:${context.rowId}:${context.column}:${context.userId}`);
}

/** No DB access, logging or key discovery: callers authorize the owner before invoking this API. */
export async function createEnvelopeCipher(keyring: EnvelopeKeyring): Promise<EnvelopeCipher> {
  let activeKeyId: string;
  let activeKey: CryptoKey;
  const keys = new Map<string, CryptoKey>();
  try {
    activeKeyId = keyring.activeKeyId;
    const entries = Object.entries(keyring.keys);
    if (!keyIdPattern.test(activeKeyId) || entries.length === 0 || entries.length > 8) {
      throw new Error();
    }
    for (const [keyId, encodedKey] of entries) {
      if (!keyIdPattern.test(keyId)) throw new Error();
      const rawKey = decodeBase64url(encodedKey, 32);
      try {
        if (rawKey.byteLength !== 32) throw new Error();
        keys.set(
          keyId,
          await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]),
        );
      } finally {
        rawKey.fill(0);
      }
    }
    const selectedKey = keys.get(activeKeyId);
    if (!selectedKey) throw new Error();
    activeKey = selectedKey;
  } catch {
    throw new CaseDataCryptoError("CRYPTO_CONFIGURATION_INVALID");
  }

  return {
    async encrypt(plaintext, context) {
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      try {
        // Check string length before allocating the bounded UTF-8 representation.
        if (typeof plaintext !== "string" || plaintext.length > MAX_PLAINTEXT_BYTES) {
          throw new Error();
        }
        bytes = encoder.encode(plaintext);
        if (bytes.byteLength > MAX_PLAINTEXT_BYTES || decoder.decode(bytes) !== plaintext) {
          throw new Error();
        }
        const aad = additionalData(context);
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad, tagLength: TAG_BYTES * 8 },
          activeKey,
          bytes,
        );
        return `v1.${activeKeyId}.${encodeBase64url(iv)}.${encodeBase64url(new Uint8Array(ciphertext))}`;
      } catch {
        throw new CaseDataCryptoError("CRYPTO_ENCRYPT_FAILED");
      } finally {
        bytes?.fill(0);
      }
    },
    async decrypt(envelope, context) {
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      try {
        if (typeof envelope !== "string" || envelope.length > MAX_ENVELOPE_CHARACTERS) {
          throw new Error();
        }
        const parts = envelope.split(".");
        const [version, keyId, encodedIv, encodedCiphertext] = parts;
        if (
          parts.length !== 4 ||
          version !== "v1" ||
          !keyId ||
          !keyIdPattern.test(keyId) ||
          !encodedIv ||
          !encodedCiphertext
        ) {
          throw new Error();
        }
        const key = keys.get(keyId);
        if (!key) throw new Error();
        const iv = decodeBase64url(encodedIv, IV_BYTES);
        const ciphertext = decodeBase64url(encodedCiphertext, MAX_CIPHERTEXT_BYTES);
        if (iv.byteLength !== IV_BYTES || ciphertext.byteLength < TAG_BYTES) throw new Error();
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: additionalData(context),
            tagLength: TAG_BYTES * 8,
          },
          key,
          ciphertext,
        );
        bytes = new Uint8Array(plaintext);
        return decoder.decode(bytes);
      } catch {
        // Never attach cause, supplied ciphertext, owner IDs or platform crypto diagnostics.
        throw new CaseDataCryptoError("CRYPTO_DECRYPT_FAILED");
      } finally {
        bytes?.fill(0);
      }
    },
  };
}

/** Key ID 1 is explicitly mapped to its Worker secret; envelope input cannot select env fields. */
export function createCaseDataCipher(env: { CASE_DATA_KEY_V1: string }): Promise<EnvelopeCipher> {
  return createEnvelopeCipher({ activeKeyId: "1", keys: { "1": env.CASE_DATA_KEY_V1 } });
}
