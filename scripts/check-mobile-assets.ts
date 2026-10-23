import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { assetHash, inspectMobileFont } from "./mobile-assets";

const root = "apps/mobile/assets";
const font = JSON.parse(await readFile(`${root}/fonts/manifest.json`, "utf8")) as {
  version: number;
  family: string;
  source: string;
  sourceSha256: string;
  licenseSha256: string;
  outputSha256: string;
  glyphs: number;
  codepoints: number;
  hangul: number;
};
const bytes = await readFile(`${root}/fonts/BaroMobile.ttf`),
  license = await readFile("public/fonts/OFL.txt"),
  inspected = inspectMobileFont(bytes);
if (
  font.version !== 1 ||
  font.family !== "BaroMobile" ||
  font.source !== "public/fonts/PretendardVariable.woff2" ||
  font.sourceSha256 !== assetHash(await readFile(font.source)) ||
  font.licenseSha256 !== assetHash(license) ||
  font.outputSha256 !== assetHash(bytes) ||
  font.glyphs !== inspected.glyphs ||
  font.codepoints !== inspected.codepoints ||
  font.hangul !== inspected.hangul ||
  inspected.names.get(13) !== license.toString("utf8") ||
  assetHash(await readFile(`${root}/fonts/OFL.txt`)) !== assetHash(license)
)
  throw new Error("MOBILE_FONT_DRIFT");
const brand = JSON.parse(await readFile(`${root}/brand/manifest.json`, "utf8")) as {
  version: number;
  source: string;
  sourceSha256: string;
  outputs: Record<string, { width: number; height: number; sha256: string }>;
};
if (
  brand.version !== 1 ||
  brand.source !== "public/brand/logo.svg" ||
  brand.sourceSha256 !== assetHash(await readFile(brand.source))
)
  throw new Error("MOBILE_BRAND_SOURCE_DRIFT");
const sizes = { "logo.png": 64, "logo@2x.png": 128, "logo@3x.png": 192, "icon.png": 1024 };
if (Object.keys(brand.outputs).sort().join() !== Object.keys(sizes).sort().join())
  throw new Error("MOBILE_BRAND_FILES");
for (const [file, size] of Object.entries(sizes)) {
  const value = await readFile(`${root}/brand/${file}`),
    metadata = await sharp(value).metadata(),
    expected = brand.outputs[file];
  if (
    metadata.format !== "png" ||
    metadata.width !== size ||
    metadata.height !== size ||
    expected?.width !== size ||
    expected.height !== size ||
    expected.sha256 !== assetHash(value) ||
    (file === "icon.png" && metadata.hasAlpha)
  )
    throw new Error("MOBILE_BRAND_DRIFT");
}
console.log(
  "Native font glyphs/weights/names/OFL and generated SVG brand hashes verified; actual device rendering remains separate",
);
