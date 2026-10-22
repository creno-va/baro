import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeUploadReader } from "../apps/mobile/src/platform/files/upload-reader";

const directory = await mkdtemp(join(tmpdir(), "baro-m5-io-"));
try {
  for (const size of process.argv.includes("--large")
    ? [100_000_000, 1_000_000_000]
    : [100_000_000]) {
    const path = join(directory, "synthetic.bin"),
      fd = await open(path, "w");
    const block = Uint8Array.from({ length: 262144 }, (_, i) => (i * 17 + 9) % 251);
    const expected = createHash("sha256");
    try {
      for (let at = 0; at < size; at += block.length) {
        const bytes = block.subarray(0, Math.min(block.length, size - at));
        await fd.write(bytes);
        expected.update(bytes);
      }
    } finally {
      await fd.close();
    }
    let maxRead = 0,
      maxBody = 0,
      opened = 0,
      closed = 0,
      maxRss = process.memoryUsage().rss;
    const start = performance.now(),
      final = createHash("sha256");
    const reader = createNativeUploadReader(
      {
        size,
        open() {
          const nativeFd = openSync(path, "r");
          opened++;
          let offset = 0;
          return {
            get size() {
              return fstatSync(nativeFd).size;
            },
            get offset() {
              return offset;
            },
            set offset(value) {
              offset = value ?? 0;
            },
            async readBytes(count) {
              maxRead = Math.max(maxRead, count);
              const bytes = new Uint8Array(count);
              const actual = readSync(nativeFd, bytes, 0, count, offset);
              offset += actual;
              maxRss = Math.max(maxRss, process.memoryUsage().rss);
              return bytes.subarray(0, actual);
            },
            close() {
              closeSync(nativeFd);
              closed++;
            },
          };
        },
      },
      new AbortController().signal,
    );
    const fingerprint = await reader.fingerprint(),
      expectedHash = expected.digest("hex");
    if (fingerprint !== expectedHash) throw new Error("fingerprint mismatch");
    for (let at = 0; at < size; at += 8 * 1024 * 1024) {
      const part = await reader.part(at, Math.min(size, at + 8 * 1024 * 1024));
      maxBody = Math.max(maxBody, part.byteLength);
      final.update(new Uint8Array(part.body as ArrayBuffer));
    }
    await reader.close();
    if (final.digest("hex") !== expectedHash || opened !== closed)
      throw new Error("body/descriptor mismatch");
    console.log(
      JSON.stringify({
        size,
        kind: "synthetic-local-filesystem-port-not-native-device",
        sha256Matches: true,
        partsMatch: true,
        maxNativeReadBytes: maxRead,
        maxPartBodyBytes: maxBody,
        opened,
        closed,
        elapsedMs: Math.round(performance.now() - start),
        maxRssBytes: maxRss,
      }),
    );
    await rm(path);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
