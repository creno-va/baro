// Offline tooling only: small synthetic fixture integrity, not product admission/parser proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Track = { handler: string; timescale: number; durationSeconds: number; sampleCount: number };
type Fixture = {
  fixtureId: string;
  path: string;
  category: string;
  synthetic: boolean;
  byteLength: number;
  format?: string;
  declaredFormat?: string;
  pageCount?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  sampleCount?: number;
  frameCount?: number;
  verifiedTracks?: Track[];
  expectedVisibleText?: string[];
};
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repo, "tests/fixtures/media");
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  fixtureOnly: boolean;
  fixtureAssetCount: number;
  totalInputBytes: number;
  fixtures: Fixture[];
};
assert.equal(manifest.fixtureOnly, true);
assert.equal(manifest.fixtureAssetCount, 11);
assert.equal(manifest.fixtures.length, 11);
assert.equal(new Set(manifest.fixtures.map((f) => f.fixtureId)).size, 11);
assert.equal(manifest.totalInputBytes, 644318);

type Box = { tag: string; start: number; end: number };
function boxes(data: Buffer, start: number, end: number): Box[] {
  const result: Box[] = [];
  while (start < end) {
    assert.ok(start + 8 <= end);
    let length = data.readUInt32BE(start);
    let header = 8;
    if (length === 1) {
      assert.ok(start + 16 <= end);
      const extended = data.readBigUInt64BE(start + 8);
      assert.ok(extended <= BigInt(Number.MAX_SAFE_INTEGER));
      length = Number(extended);
      header = 16;
    }
    if (length === 0) length = end - start;
    assert.ok(length >= header && start + length <= end);
    result.push({
      tag: data.toString("ascii", start + 4, start + 8),
      start: start + header,
      end: start + length,
    });
    start += length;
  }
  return result;
}
function one(data: Buffer, start: number, end: number, tag: string): Box {
  const matches = boxes(data, start, end).filter((b) => b.tag === tag);
  assert.equal(matches.length, 1);
  const match = matches[0];
  assert.ok(match);
  return match;
}
function mp4Tracks(data: Buffer): Track[] {
  const moov = one(data, 0, data.length, "moov");
  return boxes(data, moov.start, moov.end)
    .filter((b) => b.tag === "trak")
    .map((track) => {
      const mdia = one(data, track.start, track.end, "mdia");
      const mdhd = one(data, mdia.start, mdia.end, "mdhd");
      const hdlr = one(data, mdia.start, mdia.end, "hdlr");
      assert.equal(data[mdhd.start], 0);
      assert.ok(mdhd.start + 20 <= mdhd.end);
      const timescale = data.readUInt32BE(mdhd.start + 12);
      assert.ok(timescale > 0);
      const duration = data.readUInt32BE(mdhd.start + 16);
      const handler = data.toString("ascii", hdlr.start + 8, hdlr.start + 12);
      const minf = one(data, mdia.start, mdia.end, "minf");
      const stbl = one(data, minf.start, minf.end, "stbl");
      const stsz = one(data, stbl.start, stbl.end, "stsz");
      return {
        handler,
        timescale,
        durationSeconds: duration / timescale,
        sampleCount: data.readUInt32BE(stsz.start + 8),
      };
    });
}
function jpegSize(data: Buffer): [number, number] {
  assert.equal(data.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 4 <= data.length) {
    assert.equal(data[offset++], 0xff);
    while (data[offset] === 0xff) offset++;
    const marker = data.readUInt8(offset++);
    assert.notEqual(marker, 0xda); // SOF must precede the compressed scan.
    const length = data.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= data.length);
    if (marker === 0xc0 || marker === 0xc2)
      return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)];
    offset += length;
  }
  throw new Error("Synthetic JPEG frame metadata missing");
}
function wavCheck(data: Buffer, fixture: Fixture): void {
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WAVE");
  assert.equal(data.readUInt32LE(4) + 8, data.length);
  let format: Buffer | undefined;
  let pcm: Buffer | undefined;
  for (let at = 12; at + 8 <= data.length; ) {
    const tag = data.toString("ascii", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= data.length);
    if (tag === "fmt ") format = data.subarray(at + 8, at + 8 + size);
    if (tag === "data") pcm = data.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  assert.ok(format && pcm);
  assert.equal(format.readUInt16LE(0), 1);
  assert.equal(format.readUInt16LE(2), fixture.channels);
  assert.equal(format.readUInt32LE(4), fixture.sampleRate);
  assert.equal(format.readUInt16LE(14), 16);
  assert.equal(pcm.length / 2, fixture.sampleCount);
  const sampleRate = fixture.sampleRate;
  assert.ok(sampleRate && sampleRate > 0);
  assert.equal(pcm.length / 2 / sampleRate, fixture.durationSeconds);
  let peak = 0;
  for (let at = 0; at < pcm.length; at += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(at)));
  assert.ok(peak > 1000); // Non-silent PCM only; does not prove intelligibility or ASR.
}

const receiptFlag = process.argv.indexOf("--private-receipt");
let receipt: { fixtures: { fixtureId: string; byteLength: number; sha256: string }[] } | undefined;
if (receiptFlag !== -1) {
  const receiptPath = process.argv[receiptFlag + 1];
  assert.ok(receiptPath);
  receipt = JSON.parse(await readFile(resolve(receiptPath), "utf8"));
}
let bytes = 0;
for (const fixture of manifest.fixtures) {
  assert.equal(fixture.synthetic, true);
  assert.ok(fixture.path.startsWith("tests/fixtures/media/") && !fixture.path.includes("\\"));
  const path = resolve(repo, fixture.path);
  assert.ok(path.startsWith(fixtureRoot + sep));
  const data = await readFile(path);
  assert.equal(data.length, fixture.byteLength);
  bytes += data.length;
  if (receipt) {
    const original = receipt.fixtures.find((f) => f.fixtureId === fixture.fixtureId);
    assert.ok(original);
    assert.equal(original.byteLength, data.length);
    const actualHash = createHash("sha256").update(data).digest("hex");
    assert.ok(actualHash === original.sha256, "Private integrity check failed"); // Never print hashes.
  }
  if (fixture.format === "pdf") {
    assert.equal(data.toString("ascii", 0, 5), "%PDF-");
    assert.ok(data.subarray(-50).toString("ascii").includes("%%EOF"));
    assert.equal(
      [...data.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,
      fixture.pageCount,
    );
  } else if (fixture.format === "txt") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    assert.ok(fixture.expectedVisibleText?.every((line) => text.includes(line)));
  } else if (fixture.format === "png") {
    assert.ok(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(data.toString("ascii", 12, 16), "IHDR");
    assert.equal(data.readUInt32BE(16), fixture.width);
    assert.equal(data.readUInt32BE(20), fixture.height);
  } else if (fixture.format === "jpeg") {
    assert.deepEqual(jpegSize(data), [fixture.width, fixture.height]);
  } else if (fixture.format === "wav") wavCheck(data, fixture);
  else if (fixture.format === "mp4") {
    assert.deepEqual(mp4Tracks(data), fixture.verifiedTracks);
    const video = fixture.verifiedTracks?.find((track) => track.handler === "vide");
    assert.equal(video?.sampleCount, fixture.frameCount);
    assert.equal(video?.durationSeconds, fixture.durationSeconds);
  } else if (fixture.declaredFormat === "pdf")
    assert.notEqual(data.toString("ascii", 0, 5), "%PDF-");
  else if (fixture.declaredFormat === "mp4") assert.throws(() => mp4Tracks(data));
  else throw new Error("Unexpected synthetic fixture format");
}
assert.equal(bytes, manifest.totalInputBytes);
console.log(
  `Synthetic fixture integrity passed: ${manifest.fixtures.length} files / ${bytes} bytes${receipt ? " / private hashes verified" : ""}.`,
);
console.log(
  "Local fixture structure only; no ASR/OCR/Container/R2/product processing success claimed.",
);
