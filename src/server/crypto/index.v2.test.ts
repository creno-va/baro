import { expect, test } from "bun:test";
import {
  createEnvelopeCipher,
  type EncryptionContext,
  MAX_PLAINTEXT_BYTES,
  V2_PRIVATE_TABLES,
} from "./index";

const first = btoa("a".repeat(32)).replace(/=+$/, "");
const second = btoa("b".repeat(32)).replace(/=+$/, "");
test("v2 table purpose, owner, row, revision and exact context keys are authenticated", async () => {
  const cipher = await createEnvelopeCipher({ activeKeyId: "1", keys: { "1": first } });
  for (const table of V2_PRIVATE_TABLES) {
    const context = {
      table,
      column: "encrypted_payload",
      rowId: "row",
      userId: "owner",
      revision: 2,
    } as const;
    const envelope = await cipher.encrypt("합성 민감정보 🙂", context);
    expect(await cipher.decrypt(envelope, context)).toBe("합성 민감정보 🙂");
    for (const change of [
      { rowId: "other" },
      { userId: "other" },
      { revision: 3 },
      { column: "title" },
      { table: table === "v2_files" ? "v2_facts" : "v2_files" },
      { unexpected: "ignored" },
      { revision: "2" },
      { userId: 1 },
    ])
      await expect(
        cipher.decrypt(envelope, { ...context, ...change } as unknown as EncryptionContext),
      ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
    await expect(
      cipher.encrypt("text", { ...context, unexpected: true } as unknown as EncryptionContext),
    ).rejects.toThrow("CRYPTO_ENCRYPT_FAILED");
  }
});
test("v2 chunk AAD binds target, purpose, ordinal and rotation without changing v1 compatibility", async () => {
  const original = await createEnvelopeCipher({ activeKeyId: "1", keys: { "1": first } });
  const rotating = await createEnvelopeCipher({
    activeKeyId: "2",
    keys: { "1": first, "2": second },
  });
  const context = {
    table: "v2_private_parts",
    column: "encrypted_payload",
    rowId: "part-row",
    userId: "owner",
    revision: 2,
    targetId: "case",
    purpose: "summary",
    part: 0,
  } as const;
  const text = "🙂".repeat(MAX_PLAINTEXT_BYTES / 4);
  const old = await original.encrypt(text, context);
  expect(await rotating.decrypt(old, context)).toBe(text);
  const renewed = await rotating.encrypt(text, context);
  expect(renewed.startsWith("v1.2.")).toBe(true);
  for (const change of [
    { targetId: "other" },
    { purpose: "report" },
    { part: 1 },
    { revision: 3 },
    { rowId: "other" },
    { userId: "other" },
    { unknown: "ignored" },
    { part: "0" },
    { targetId: 1 },
  ])
    await expect(
      rotating.decrypt(old, { ...context, ...change } as unknown as EncryptionContext),
    ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  await expect(original.encrypt(`${text}🙂`, context)).rejects.toThrow("CRYPTO_ENCRYPT_FAILED");
  await expect(original.encrypt("\ud800", context)).rejects.toThrow("CRYPTO_ENCRYPT_FAILED");
  const retired = await createEnvelopeCipher({ activeKeyId: "2", keys: { "2": second } });
  await expect(retired.decrypt(old, context)).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
});
