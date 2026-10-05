import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  CaseDataCryptoError,
  type CryptoErrorCode,
  createCaseDataCipher,
  createEnvelopeCipher,
  type EncryptionContext,
  type EnvelopeCipher,
  MAX_ENVELOPE_CHARACTERS,
  MAX_PLAINTEXT_BYTES,
} from "./index";

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
    character.charCodeAt(0),
  );
}

const key = encode(crypto.getRandomValues(new Uint8Array(32)));
const otherKey = encode(crypto.getRandomValues(new Uint8Array(32)));
const context: EncryptionContext = {
  table: "cases",
  column: "encrypted_input",
  rowId: "00000000-0000-4000-8000-000000000009",
  userId: "synthetic-owner",
};
const analysisContext: EncryptionContext = {
  table: "analyses",
  column: "encrypted_context",
  rowId: "00000000-0000-4000-8000-000000000008",
  userId: "synthetic-owner",
};
let cipher: EnvelopeCipher;

beforeAll(async () => {
  cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: key });
});

async function expectCryptoFailure(operation: Promise<unknown>, code: CryptoErrorCode) {
  try {
    await operation;
    throw new Error("Expected crypto failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CaseDataCryptoError);
    expect((error as CaseDataCryptoError).code).toBe(code);
    expect((error as Error).message).toBe(code);
    expect((error as Error).cause).toBeUndefined();
  }
}

async function expectDecryptFailure(envelope: string, aad: EncryptionContext = context) {
  await expectCryptoFailure(cipher.decrypt(envelope, aad), "CRYPTO_DECRYPT_FAILED");
}

async function rawEncrypt(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const rawKey = await crypto.subtle.importKey("raw", decode(key), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        `cases:${context.rowId}:encrypted_input:${context.userId}`,
      ),
      tagLength: 128,
    },
    rawKey,
    bytes,
  );
  return `v1.1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

describe("case data encryption", () => {
  test.each(["", "synthetic loan", "한글 사건 예시 🧪 e\u0301\n줄바꿈\u0000", "\uFEFFsynthetic"])(
    "roundtrips UTF-8 text without normalization (%#)",
    async (plaintext) => {
      const envelope = await cipher.encrypt(plaintext, context);
      expect(await cipher.decrypt(envelope, context)).toBe(plaintext);
      expect(envelope).toMatch(/^v1\.1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    },
  );

  test.each(["encrypted_context", "encrypted_answers", "encrypted_result"] as const)(
    "supports the analysis %s storage boundary",
    async (column) => {
      const aad = { ...analysisContext, column };
      const envelope = await cipher.encrypt("synthetic checkpoint", aad);
      expect(await cipher.decrypt(envelope, aad)).toBe("synthetic checkpoint");
    },
  );

  test("uses a fresh 96-bit IV for repeated concurrent writes", async () => {
    const envelopes = await Promise.all(
      Array.from({ length: 100 }, () => cipher.encrypt("same synthetic input", context)),
    );
    const ivs = envelopes.map((envelope) => envelope.split(".")[2] ?? "");
    expect(new Set(ivs).size).toBe(100);
    expect(ivs.every((iv) => decode(iv).length === 12)).toBe(true);
    expect(new Set(envelopes).size).toBe(100);
  });

  test("matches AES-256-GCM with the exact documented AAD and 128-bit tag", async () => {
    const plaintext = "synthetic interoperability input";
    const envelope = await cipher.encrypt(plaintext, context);
    const [, , iv = "", ciphertext = ""] = envelope.split(".");
    const imported = await crypto.subtle.importKey("raw", decode(key), "AES-GCM", false, [
      "decrypt",
    ]);
    const result = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: new TextEncoder().encode(
          `cases:${context.rowId}:encrypted_input:${context.userId}`,
        ),
        tagLength: 128,
      },
      imported,
      decode(ciphertext),
    );
    expect(new TextDecoder().decode(result)).toBe(plaintext);
    expect(decode(ciphertext).length).toBe(new TextEncoder().encode(plaintext).length + 16);
    expect(
      await cipher.decrypt(await rawEncrypt(new TextEncoder().encode(plaintext)), context),
    ).toBe(plaintext);
  });

  test("authenticates each AAD field and prevents transplant across owners and storage fields", async () => {
    const envelope = await cipher.encrypt("synthetic input", context);
    for (const aad of [
      { ...context, rowId: "another-row" },
      { ...context, userId: "another-owner" },
      { ...context, table: "analyses", column: "encrypted_context" },
    ]) {
      await expectDecryptFailure(envelope, aad as EncryptionContext);
    }
    const checkpoint = await cipher.encrypt("synthetic checkpoint", analysisContext);
    await expectDecryptFailure(checkpoint, { ...analysisContext, column: "encrypted_answers" });
    await expectDecryptFailure(checkpoint, { ...analysisContext, column: "encrypted_result" });
  });

  test("rejects IV, ciphertext and authentication-tag tampering", async () => {
    const envelope = await cipher.encrypt("synthetic authenticated input", context);
    const parts = envelope.split(".");
    for (const [part, offset] of [
      [2, 0],
      [3, 0],
      [3, -1],
    ] as const) {
      const changed = [...parts];
      const bytes = decode(changed[part] ?? "");
      const index = offset < 0 ? bytes.length - 1 : offset;
      bytes[index] = (bytes[index] ?? 0) ^ 1;
      changed[part] = encode(bytes);
      await expectDecryptFailure(changed.join("."));
    }
  });

  test("rejects a different key and unknown key IDs without fallback", async () => {
    const other = await createCaseDataCipher({ CASE_DATA_KEY_V1: otherKey });
    await expectDecryptFailure(await other.encrypt("synthetic input", context));
    const envelope = await cipher.encrypt("synthetic input", context);
    for (const keyId of ["2", "constructor", "__proto__", "CASE_DATA_KEY_V1"]) {
      await expectDecryptFailure(envelope.replace("v1.1.", `v1.${keyId}.`));
    }
  });

  test("rotates writes while retaining explicitly allowed old keys until migration is verified", async () => {
    const oldEnvelope = await cipher.encrypt("synthetic retained input", context);
    const rotating = await createEnvelopeCipher({
      activeKeyId: "2",
      keys: { "1": key, "2": otherKey },
    });
    expect(await rotating.decrypt(oldEnvelope, context)).toBe("synthetic retained input");
    const newEnvelope = await rotating.encrypt(
      await rotating.decrypt(oldEnvelope, context),
      context,
    );
    expect(newEnvelope.startsWith("v1.2.")).toBe(true);
    await expectDecryptFailure(newEnvelope);
    const retired = await createEnvelopeCipher({ activeKeyId: "2", keys: { "2": otherKey } });
    expect(await retired.decrypt(newEnvelope, context)).toBe("synthetic retained input");
    await expectCryptoFailure(retired.decrypt(oldEnvelope, context), "CRYPTO_DECRYPT_FAILED");
  });

  test("isolates imported keys from later caller configuration mutation", async () => {
    const keys = { "1": key };
    const isolated = await createEnvelopeCipher({ activeKeyId: "1", keys });
    keys["1"] = otherKey;
    expect(await cipher.decrypt(await isolated.encrypt("synthetic input", context), context)).toBe(
      "synthetic input",
    );
  });

  test("accepts the exact byte limit and rejects larger strings and multibyte input", async () => {
    const maximum = "a".repeat(MAX_PLAINTEXT_BYTES);
    expect(await cipher.decrypt(await cipher.encrypt(maximum, context), context)).toBe(maximum);
    for (const plaintext of [`${maximum}a`, "가".repeat(Math.floor(MAX_PLAINTEXT_BYTES / 3) + 1)]) {
      await expectCryptoFailure(cipher.encrypt(plaintext, context), "CRYPTO_ENCRYPT_FAILED");
    }
  });

  test("rejects invalid Unicode rather than silently replacing or stripping it", async () => {
    await expectCryptoFailure(cipher.encrypt("synthetic\ud800", context), "CRYPTO_ENCRYPT_FAILED");
    await expectDecryptFailure(await rawEncrypt(new Uint8Array([0xff, 0xfe])));
  });

  test("rejects malformed and noncanonical envelope encodings", async () => {
    const envelope = await cipher.encrypt("synthetic input", context);
    const [, , iv = "", ciphertext = ""] = envelope.split(".");
    const malformed = [
      "",
      "synthetic plaintext",
      `${envelope}.extra`,
      envelope.replace("v1.", "v2."),
      envelope.replace("v1.1.", "v1.."),
      envelope.replace("v1.1.", `v1.${"k".repeat(33)}.`),
      `v1.1..${ciphertext}`,
      `v1.1.${iv}.`,
      `v1.1.${iv.slice(1)}.${ciphertext}`,
      `v1.1.${iv}A.${ciphertext}`,
      `v1.1.${iv}=.${ciphertext}`,
      `v1.1.${iv}.${ciphertext}==`,
      `v1.1.${iv}.AA`,
      `v1.1.${iv}.A`,
      `v1.1.${iv}.____/___`,
      `v1.1.${iv}.++++`,
      ` v1.1.${iv}.${ciphertext}`,
      `v1.1.${iv}.${ciphertext}\n`,
      `v1.1.${iv}.${"A".repeat(21)}B`,
    ];
    for (const candidate of malformed) await expectDecryptFailure(candidate);
  });

  test("rejects oversized envelopes and decoded ciphertext before invoking Web Crypto", async () => {
    const oversizedCiphertext = encode(new Uint8Array(MAX_PLAINTEXT_BYTES + 17));
    const decrypt = spyOn(crypto.subtle, "decrypt");
    try {
      await expectDecryptFailure("x".repeat(MAX_ENVELOPE_CHARACTERS + 1));
      await expectDecryptFailure(`v1.1.${encode(new Uint8Array(12))}.${oversizedCiphertext}`);
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });

  test("rejects ambiguous or unapproved AAD inputs at runtime", async () => {
    const envelope = await cipher.encrypt("synthetic input", context);
    const invalid = [
      { ...context, rowId: "" },
      { ...context, userId: "" },
      { ...context, rowId: "a:b" },
      { ...context, userId: "a:b" },
      { ...context, rowId: "a".repeat(129) },
      { ...context, userId: "a".repeat(129) },
      { ...context, userId: "\nowner" },
      { ...context, column: "title" },
      { ...context, table: "account" },
      null,
    ];
    for (const aad of invalid) {
      await expectCryptoFailure(
        cipher.encrypt("synthetic input", aad as EncryptionContext),
        "CRYPTO_ENCRYPT_FAILED",
      );
      await expectDecryptFailure(envelope, aad as EncryptionContext);
    }
  });

  test("does not log plaintext, key material, ciphertext or platform error details", async () => {
    const loggers = ["log", "warn", "error", "info", "debug", "trace"] as const;
    const spies = loggers.map((method) => spyOn(console, method).mockImplementation(() => {}));
    try {
      const envelope = await cipher.encrypt("synthetic sensitive sentinel", context);
      await expectDecryptFailure(envelope, { ...context, userId: "wrong-owner" });
      await expectCryptoFailure(
        createCaseDataCipher({ CASE_DATA_KEY_V1: "synthetic-invalid-secret" }),
        "CRYPTO_CONFIGURATION_INVALID",
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("case data key configuration", () => {
  test("requires a canonical unpadded base64url 256-bit key", async () => {
    for (const invalid of [
      "",
      "replace-with-a-secret",
      encode(new Uint8Array(16)),
      encode(new Uint8Array(31)),
      encode(new Uint8Array(33)),
      `${key}=`,
      ` ${key}`,
      `${key}\n`,
      "_".repeat(43),
    ]) {
      await expectCryptoFailure(
        createCaseDataCipher({ CASE_DATA_KEY_V1: invalid }),
        "CRYPTO_CONFIGURATION_INVALID",
      );
    }
  });

  test("requires an active key in a bounded explicit allowlist", async () => {
    for (const keyring of [
      { activeKeyId: "1", keys: {} },
      { activeKeyId: "2", keys: { "1": key } },
      { activeKeyId: "a.b", keys: { "a.b": key } },
      { activeKeyId: "1", keys: { "1": key, "": otherKey } },
      {
        activeKeyId: "1",
        keys: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i}`, key])),
      },
    ]) {
      await expectCryptoFailure(createEnvelopeCipher(keyring), "CRYPTO_CONFIGURATION_INVALID");
    }
  });
});
