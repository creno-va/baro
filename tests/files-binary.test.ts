import { expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  decryptPart,
  encryptPart,
  FileError,
  type PartIdentity,
  readBounded,
  readHeader,
} from "../src/server/modules/files/binary";

const identity: PartIdentity = {
  environment: "preview",
  ownerId: "synthetic-owner",
  fileId: "synthetic-file",
  uploadId: "synthetic-upload",
  revision: 1,
  index: 0,
  byteLength: 5,
};
const cipher = () =>
  createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, "") });
test("binary AEAD wraps a per-file key and binds every immutable identity field", async () => {
  const c = await cipher();
  const original = new TextEncoder().encode("hello");
  const bytes = await encryptPart(c, identity, original);
  expect(new TextDecoder().decode(bytes).includes("hello")).toBe(false);
  expect(await decryptPart(c, identity, bytes)).toEqual(original);
  for (const override of [
    { environment: "production" as const },
    { ownerId: "other" },
    { fileId: "other" },
    { uploadId: "other" },
    { revision: 2 },
    { index: 1 },
    { byteLength: 4 },
  ])
    await expect(decryptPart(c, { ...identity, ...override }, bytes)).rejects.toThrow(
      "INVALID_FILE",
    );
  const modified = bytes.slice();
  modified[modified.length - 1] = (modified[modified.length - 1] ?? 0) ^ 1;
  await expect(decryptPart(c, identity, modified)).rejects.toThrow("INVALID_FILE");
  await expect(decryptPart(c, identity, bytes.slice(0, -1))).rejects.toThrow("INVALID_FILE");
});
test("subsequent parts reuse only the authoritative wrapped key with distinct nonces", async () => {
  const c = await cipher();
  const bytes = new Uint8Array(5);
  const first = await encryptPart(c, identity, bytes);
  const h = (await readHeader(c, identity, first)).header;
  const nextId = { ...identity, index: 1 };
  const next = await encryptPart(c, nextId, bytes, h.wrappedKey);
  expect((await readHeader(c, nextId, next)).header.iv).not.toBe(h.iv);
  expect(await decryptPart(c, nextId, next, h.wrappedKey)).toEqual(bytes);
  const other = await encryptPart(c, identity, bytes);
  await expect(
    decryptPart(c, nextId, next, (await readHeader(c, identity, other)).header.wrappedKey),
  ).rejects.toThrow("INVALID_FILE");
  await expect(encryptPart(c, nextId, bytes)).rejects.toThrow("CONFLICT");
});
test("bounded body rejects truncation and forged extra chunks, cancels source", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readBounded(body, 5)).rejects.toThrow("BODY_TOO_LARGE");
  expect(cancelled).toBe(true);
  await expect(readBounded(new Response(new Uint8Array(4)).body, 5)).rejects.toThrow(
    "INVALID_FILE",
  );
  expect(await readBounded(new Response(new Uint8Array(5)).body, 5)).toEqual(new Uint8Array(5));
  expect(new FileError("NOT_FOUND").message).toBe("NOT_FOUND");
});
