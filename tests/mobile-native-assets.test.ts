import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { verifyCompiledMobileFont } from "../scripts/mobile-native-assets";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "baro-font-proof-")),
    font = "apps/mobile/assets/fonts/BaroMobile.ttf",
    license = "public/fonts/OFL.txt";
  for (const path of [font, license]) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await copyFile(path, resolve(root, path));
  }
  const res = resolve(root, "apps/mobile/android/app/src/main/res/font");
  await mkdir(res, { recursive: true });
  const xml = `<font-family>${[400, 600, 700].map((weight) => `<font app:fontWeight="${weight}" app:fontVariationSettings="'wght' ${weight}"/>`).join("")}</font-family>`;
  await writeFile(resolve(res, "xml_baro_mobile.xml"), xml);
  const staging = resolve(root, "synthetic-archive/res/font"),
    apk = resolve(root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk");
  await mkdir(staging, { recursive: true });
  await mkdir(dirname(apk), { recursive: true });
  const archive = async (tamper = false) => {
    await rm(apk, { force: true });
    await copyFile(font, resolve(staging, "baro_mobile.ttf"));
    if (tamper)
      await writeFile(resolve(staging, "baro_mobile.ttf"), "synthetic wrong compiled font");
    const child = Bun.spawn(["zip", "-q", "-0", apk, "res/font/baro_mobile.ttf"], {
      cwd: resolve(root, "synthetic-archive"),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (await child.exited) throw new Error("SYNTHETIC_ARCHIVE_FAILED");
  };
  await archive();
  return { root, archive, xml, res };
}
test("compiled-resource proof reads actual ZIP font bytes and records matching source/license without claiming runtime or device success", async () => {
  const f = await fixture();
  try {
    expect(await verifyCompiledMobileFont("android", f.root)).toMatchObject({
      family: "BaroMobile",
      codepoints: 14336,
      hangul: 11172,
      compiledBytesMatch: true,
      licenseEmbedded: true,
      appRuntimeVerified: false,
    });
    expect(
      JSON.parse(
        await readFile(resolve(f.root, ".wrangler/mobile-build/assets-android.json"), "utf8"),
      ),
    ).toMatchObject({ kind: "compiled-resource-only", appRuntimeVerified: false });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("missing weight declarations or substituted archived bytes cannot produce a successful font bundle proof", async () => {
  const f = await fixture();
  try {
    await writeFile(
      resolve(f.res, "xml_baro_mobile.xml"),
      f.xml.replace('app:fontWeight="600"', 'app:fontWeight="500"'),
    );
    await expect(verifyCompiledMobileFont("android", f.root)).rejects.toThrow(
      "ANDROID_FONT_FACES_MISSING",
    );
    await writeFile(resolve(f.res, "xml_baro_mobile.xml"), f.xml);
    await f.archive(true);
    await expect(verifyCompiledMobileFont("android", f.root)).rejects.toThrow(
      "COMPILED_FONT_BYTES_OR_LICENSE_CHANGED",
    );
    expect(
      await Bun.file(resolve(f.root, ".wrangler/mobile-build/assets-android.json")).exists(),
    ).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("Release font verification cannot accidentally accept a valid neighboring Debug APK", async () => {
  const f = await fixture();
  try {
    const debug = resolve(f.root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"),
      release = resolve(
        f.root,
        "apps/mobile/android/app/build/outputs/apk/release/app-release.apk",
      );
    await mkdir(dirname(release), { recursive: true });
    await f.archive(true);
    await copyFile(debug, release);
    await f.archive(false);
    await expect(verifyCompiledMobileFont("android", f.root, "Release")).rejects.toThrow(
      "COMPILED_FONT_BYTES_OR_LICENSE_CHANGED",
    );
    await copyFile(debug, release);
    expect(await verifyCompiledMobileFont("android", f.root, "Release")).toMatchObject({
      compiledBytesMatch: true,
      appRuntimeVerified: false,
    });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
