import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  createSanitizedEncoder,
  decryptSanitizedFrame,
} from "../src/server/modules/file-processing/sanitized-binary";
import { sanitizedManifestSchema } from "../src/server/modules/file-processing/sanitized-protocol";
import { createProcessorTransport } from "../src/server/modules/file-processing/transport";
import { digest, hex } from "../src/server/modules/files/binary";

// Synthetic wire payloads exercise actual crypto/protocol boundaries; image
// codecs are separately verified by the native Linux synthetic fixture script.
const bytes = new TextEncoder().encode("synthetic sanitized bytes");
const identity = {
  environment: "preview" as const,
  ownerId: "owner",
  profileId: "profile",
  assetId: "asset",
  assetRevision: 2,
  sourceBlobId: "original",
  blobId: "sanitized",
};
async function manifest() {
  return sanitizedManifestSchema.parse({
    version: 1,
    passes: 2,
    probe: { category: "image", format: "png", byteLength: 4, width: 1, height: 1 },
    format: "jpeg",
    byteLength: bytes.length,
    contentHash: await digest(bytes),
    chunkCount: 1,
  });
}
async function cipher() {
  return createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))).replace(/=+$/, ""),
  });
}
async function wire(change: (rows: unknown[]) => unknown[] = (rows) => rows, revoke = false) {
  const m = await manifest();
  const data = btoa(String.fromCharCode(...bytes));
  const rows = change([
    { type: "sanitized_manifest", value: m },
    { type: "sanitized_chunk", pass: 0, index: 0, data },
    { type: "sanitized_chunk", pass: 1, index: 0, data },
    { type: "complete" },
  ]);
  let permitted = true,
    calls = 0,
    stops = 0;
  const receipts: string[] = [];
  const transport = createProcessorTransport({
    fetch: async (request) => {
      calls++;
      expect(new URL(request.url).pathname).toBe("/sanitize");
      return new Response(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    },
    stop: async () => {
      stops++;
    },
    costs: {
      before: async () => {
        if (revoke) permitted = false;
        return { attemptId: "synthetic-permit", dispatchToken: null };
      },
      after: async (_, r) => {
        receipts.push(r.transport);
      },
    },
  });
  const source = {
    byteLength: 4,
    contentHash: "a".repeat(64),
    open: () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(4));
          c.close();
        },
      }),
  };
  const access = { authorize: async () => permitted, signal: new AbortController().signal };
  return {
    stream: transport.sanitize(source, access),
    calls: () => calls,
    stops: () => stops,
    receipts,
  };
}

test("actual asset AES two-pass ciphertext equals prePUT receipt; independent AAD rejects every foreign tuple", async () => {
  const c = await cipher(),
    m = await manifest();
  const encoder = await createSanitizedEncoder(c, identity, m);
  await encoder.observe(0, bytes);
  const planned = encoder.seal();
  const frame = await encoder.replay(0, bytes);
  expect(frame.length).toBe(planned.cipherBytes);
  expect(await digest(frame)).toBe(planned.cipherHash);
  expect(encoder.complete()).toBe(true);
  const expected = { index: 0, byteLength: m.byteLength, contentHash: m.contentHash };
  expect(await decryptSanitizedFrame(c, identity, frame, expected)).toEqual(bytes);
  for (const change of [
    { ownerId: "foreign" },
    { environment: "production" as const },
    { profileId: "foreign" },
    { assetId: "foreign" },
    { assetRevision: 3 },
    { sourceBlobId: "foreign" },
    { blobId: "foreign" },
  ])
    await expect(
      decryptSanitizedFrame(c, { ...identity, ...change }, frame, expected),
    ).rejects.toMatchObject({ code: "FILE_REJECTED" });
  const corrupt = frame.slice();
  corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;
  await expect(decryptSanitizedFrame(c, identity, corrupt, expected)).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
});
test("changed pass1 plaintext is rejected before saved-IV encryption and does not advance replay", async () => {
  const encoder = await createSanitizedEncoder(await cipher(), identity, await manifest());
  await encoder.observe(0, bytes);
  encoder.seal();
  const changed = bytes.slice();
  changed[0] = (changed[0] ?? 0) ^ 1;
  await expect(encoder.replay(0, changed)).rejects.toMatchObject({ code: "FILE_REJECTED" });
  expect(encoder.complete()).toBe(false);
  expect((await encoder.replay(0, bytes)).length).toBeGreaterThan(bytes.length);
});
test("actual two-frame boundary retains only per-frame metadata and reproduces exact fullcipher hash", async () => {
  const content = new Uint8Array(1_048_579).fill(7);
  const m = {
    ...(await manifest()),
    byteLength: content.length,
    contentHash: await digest(content),
    chunkCount: 2,
  };
  const c = await cipher();
  const encoder = await createSanitizedEncoder(c, identity, m);
  await encoder.observe(0, content.slice(0, 1_048_576));
  await encoder.observe(1, content.slice(1_048_576));
  const receipt = encoder.seal();
  const hash = sha256.create();
  let size = 0;
  for (let index = 0; index < 2; index++) {
    const original = content.slice(index * 1_048_576, (index + 1) * 1_048_576);
    const frame = await encoder.replay(index, original);
    hash.update(frame);
    size += frame.length;
    expect(
      await decryptSanitizedFrame(c, identity, frame, {
        index,
        byteLength: m.byteLength,
        contentHash: m.contentHash,
      }),
    ).toEqual(original);
  }
  expect(size).toBe(receipt.cipherBytes);
  expect(hex(hash.digest())).toBe(receipt.cipherHash);
  expect(encoder.complete()).toBe(true);
});
test("incomplete/unsealed pass0 cannot authorize encryption replay", async () => {
  const encoder = await createSanitizedEncoder(await cipher(), identity, await manifest());
  await expect(encoder.replay(0, bytes)).rejects.toMatchObject({ code: "FILE_REJECTED" });
  await encoder.observe(0, bytes);
  await expect(encoder.replay(0, bytes)).rejects.toMatchObject({ code: "FILE_REJECTED" });
  const invalid = await createSanitizedEncoder(await cipher(), identity, {
    ...(await manifest()),
    contentHash: "f".repeat(64),
  });
  await invalid.observe(0, bytes);
  expect(() => invalid.seal()).toThrow();
});
test("strict native two-pass wire yields chunks only in order and clears yielded plaintext on advance", async () => {
  const f = await wire();
  let chunks = 0;
  const retained: Uint8Array[] = [];
  for await (const record of f.stream) {
    if (record.type === "chunk") {
      expect(record.bytes).toEqual(bytes);
      retained.push(record.bytes);
      chunks++;
    }
  }
  expect(chunks).toBe(2);
  expect(f.calls()).toBe(1);
  expect(f.stops()).toBe(1);
  expect(retained.every((value) => value.every((byte) => byte === 0))).toBe(true);
});
test("changed native pass1 is rejected before it reaches encryption or storage consumer", async () => {
  const changed = bytes.slice();
  changed[0] = (changed[0] ?? 0) ^ 1;
  const f = await wire((rows) =>
    rows.map((r, i) =>
      i === 2
        ? {
            type: "sanitized_chunk",
            pass: 1,
            index: 0,
            data: btoa(String.fromCharCode(...changed)),
          }
        : r,
    ),
  );
  let pass1 = 0;
  await expect(
    (async () => {
      for await (const record of f.stream)
        if (record.type === "chunk" && record.pass === 1) pass1++;
    })(),
  ).rejects.toMatchObject({ code: "FILE_REJECTED" });
  expect(pass1).toBe(0);
  expect(f.stops()).toBe(1);
});
for (const [name, change] of [
  ["missing pass1", (r: unknown[]) => [r[0], r[1], r[3]]],
  ["pass1 before pass0", (r: unknown[]) => [r[0], r[2], r[1], r[3]]],
  [
    "unknown extra field",
    (r: unknown[]) => [{ ...(r[0] as object), privateUrl: "untrusted" }, ...r.slice(1)],
  ],
] as const)
  test(`native sanitized rejects ${name}`, async () => {
    const f = await wire(change);
    await expect(
      (async () => {
        for await (const _ of f.stream) {
        }
      })(),
    ).rejects.toMatchObject({ code: "FILE_REJECTED" });
    expect(f.stops()).toBe(1);
  });
test("consent revoked during sanitizer paid reservation makes zero native calls", async () => {
  const f = await wire(undefined, true);
  await expect(
    (async () => {
      for await (const _ of f.stream) {
      }
    })(),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.calls()).toBe(0);
  expect(f.receipts).toEqual(["not_sent"]);
});
