import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assetHash, inspectMobileFont } from "./mobile-assets";

async function bytesFrom(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer());
  await new Response(child.stderr).arrayBuffer();
  if (await child.exited) throw new Error("COMPILED_FONT_READ_FAILED");
  return bytes;
}
export async function compiledMobileFontProof(root: string, compiled: Uint8Array) {
  const source = await readFile(resolve(root, "apps/mobile/assets/fonts/BaroMobile.ttf")),
    inspected = inspectMobileFont(source),
    expected = assetHash(source);
  if (
    assetHash(compiled) !== expected ||
    inspected.names.get(13) !== (await readFile(resolve(root, "public/fonts/OFL.txt"), "utf8"))
  )
    throw new Error("COMPILED_FONT_BYTES_OR_LICENSE_CHANGED");
  return {
    kind: "compiled-resource-only" as const,
    family: "BaroMobile" as const,
    sha256: expected,
    weights: [400, 600, 700] as [400, 600, 700],
    glyphs: inspected.glyphs,
    codepoints: inspected.codepoints,
    hangul: inspected.hangul,
    licenseEmbedded: true as const,
    compiledBytesMatch: true as const,
    appRuntimeVerified: false as const,
  };
}
/** Compiled resources only: does not claim an RN/device/font-rendering session. */
export async function verifyCompiledMobileFont(
  platform: "android" | "ios",
  root: string,
  configuration: "Debug" | "Release" = "Debug",
) {
  if (configuration !== "Debug" && configuration !== "Release")
    throw new Error("COMPILED_FONT_CONFIGURATION_REQUIRED");
  const mobile = resolve(root, "apps/mobile");
  let compiled: Uint8Array;
  if (platform === "android") {
    const xml = await readFile(
      resolve(mobile, "android/app/src/main/res/font/xml_baro_mobile.xml"),
      "utf8",
    );
    for (const weight of [400, 600, 700])
      if (
        !xml.includes(`app:fontWeight="${weight}"`) ||
        !xml.includes(`app:fontVariationSettings="'wght' ${weight}"`)
      )
        throw new Error("ANDROID_FONT_FACES_MISSING");
    compiled = await bytesFrom([
      "unzip",
      "-p",
      resolve(
        mobile,
        `android/app/build/outputs/apk/${configuration.toLowerCase()}/app-${configuration.toLowerCase()}.apk`,
      ),
      "res/font/baro_mobile.ttf",
    ]);
  } else {
    const products = resolve(
        root,
        `.wrangler/mobile-build/ios/Build/Products/${configuration}-iphonesimulator`,
      ),
      apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw new Error("IOS_COMPILED_APP_MISSING");
    const app = resolve(products, apps[0]);
    const plist = new TextDecoder().decode(
      await bytesFrom([
        "/usr/libexec/PlistBuddy",
        "-c",
        "Print :UIAppFonts",
        resolve(app, "Info.plist"),
      ]),
    );
    if (!plist.split(/\r?\n/).some((line) => line.trim() === "BaroMobile.ttf"))
      throw new Error("IOS_FONT_DECLARATION_MISSING");
    compiled = await readFile(resolve(app, "BaroMobile.ttf"));
  }
  const proof = await compiledMobileFontProof(root, compiled);
  const directory = resolve(root, ".wrangler/mobile-build");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `assets-${platform}.json`),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(
    `Compiled ${platform} font bytes, weight declarations and embedded OFL verified; device rendering unverified`,
  );
  return proof;
}
