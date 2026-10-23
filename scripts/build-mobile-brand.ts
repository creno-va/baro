/** Rasterize the existing trusted SVG for native Image and app icon; never write the web source. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile("public/brand/logo.svg");
const directory = "apps/mobile/assets/brand";
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const outputs: Record<string, { width: number; height: number; sha256: string }> = {};
await mkdir(directory, { recursive: true });
for (const [name, size] of [
  ["logo.png", 64],
  ["logo@2x.png", 128],
  ["logo@3x.png", 192],
  ["icon.png", 1024],
] as const) {
  const icon = name === "icon.png";
  const logo = await sharp(source)
    .resize(icon ? 640 : size, icon ? 640 : size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const bytes = icon
    ? await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ffffff" } })
        .composite([{ input: logo, gravity: "centre" }])
        .removeAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer()
    : logo;
  await writeFile(`${directory}/${name}`, bytes);
  outputs[name] = { width: size, height: size, sha256: hash(bytes) };
}
await writeFile(
  `${directory}/manifest.json`,
  `${JSON.stringify({ version: 1, source: "public/brand/logo.svg", sourceSha256: hash(source), sharp: sharp.versions.sharp, outputs }, null, 2)}\n`,
);
console.log("Native logo/icon generated from existing shared SVG; web source unchanged");
