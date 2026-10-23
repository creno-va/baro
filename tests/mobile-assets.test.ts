import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { nativeAssets } from "../apps/mobile/config/assets";
import { BARO_FONT_FAMILY } from "../apps/mobile/src/theme/font";
import { tokens } from "../apps/mobile/src/theme/tokens";
import { assetHash, inspectMobileFont } from "../scripts/mobile-assets";

const font = readFileSync("apps/mobile/assets/fonts/BaroMobile.ttf");
test("native font preserves complete Hangul/Unicode repertoire, named 400/600/700 faces, distinct family and the entire original OFL", () => {
  const inspected = inspectMobileFont(font),
    manifest = JSON.parse(readFileSync("apps/mobile/assets/fonts/manifest.json", "utf8"));
  expect(inspected.codepoints).toBe(14336);
  expect(inspected.glyphs).toBe(manifest.glyphs);
  expect(inspected.hangul).toBe(11172);
  expect(inspected.weight).toMatchObject({ min: 45, default: 400, max: 930 });
  for (const weight of [400, 600, 700]) expect(inspected.weight.instances).toContain(weight);
  expect(inspected.names.get(13)).toBe(readFileSync("public/fonts/OFL.txt", "utf8"));
  expect(inspected.names.get(1)).toBe(BARO_FONT_FAMILY);
  expect(manifest.outputSha256).toBe(assetHash(font));
  expect(nativeAssets.family).toBe(BARO_FONT_FAMILY);
  expect(tokens.type.body.fontFamily).toBe(BARO_FONT_FAMILY);
  expect(nativeAssets.weights).toEqual([400, 600, 700]);
});
test("font validation rejects truncated or misdirected table data and cannot silently accept a renamed family", () => {
  expect(() => inspectMobileFont(font.subarray(0, 11))).toThrow("MOBILE_FONT_INVALID");
  const corrupted = Buffer.from(font);
  corrupted.writeUInt32BE(corrupted.length + 4, 20);
  expect(() => inspectMobileFont(corrupted)).toThrow("MOBILE_FONT_INVALID");
  const renamed = Buffer.from(font);
  const count = renamed.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const offset = 12 + i * 16;
    if (renamed.toString("ascii", offset, offset + 4) !== "name") continue;
    const base = renamed.readUInt32BE(offset + 8),
      records = renamed.readUInt16BE(base + 2),
      strings = base + renamed.readUInt16BE(base + 4);
    for (let n = 0; n < records; n++) {
      const at = base + 6 + n * 12;
      if (
        renamed.readUInt16BE(at) === 3 &&
        renamed.readUInt16BE(at + 4) === 0x409 &&
        renamed.readUInt16BE(at + 6) === 1
      )
        renamed.writeUInt16BE(88, strings + renamed.readUInt16BE(at + 10));
    }
  }
  expect(() => inspectMobileFont(renamed)).toThrow("MOBILE_FONT_INVALID");
});
