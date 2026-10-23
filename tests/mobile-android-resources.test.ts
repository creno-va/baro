import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  androidFontResources,
  verifyCompiledAndroidFontFaces,
} from "../scripts/mobile-android-font";
import {
  inspectPreservedAndroidBundle,
  verifyPinnedAndroidInspection,
} from "../scripts/mobile-internal-android-reverify";

const resources = `Binary APK
Package name=site.baro.app.preview id=7f
  type font id=09 entryCount=2
    resource 0x7f090000 font/baro_mobile
      () (file) res/Yd.ttf
    resource 0x7f090001 font/xml_baro_mobile
      () (file) res/dr.xml type=XML
  type id id=0a entryCount=1
    resource 0x7f0a0000 id/other
`;
const xml = `N: app=http://schemas.android.com/apk/res-auto (line=1)
  E: font-family (line=1)
${[400, 600, 700]
  .map(
    (w, i) => `      E: font (line=${i + 2})
        A: http://schemas.android.com/apk/res-auto:font(0x7f040249)=@0x7f090000
        A: http://schemas.android.com/apk/res-auto:fontStyle(0x7f040253)=0
        A: http://schemas.android.com/apk/res-auto:fontVariationSettings(0x7f040254)="'wght' ${w}" (Raw: "'wght' ${w}")
        A: http://schemas.android.com/apk/res-auto:fontWeight(0x7f040255)=${w}
`,
  )
  .join("")}`;
test("optimized resource names resolve through their actual font identifiers and compiled XML references", () => {
  const resolved = androidFontResources(resources);
  expect(resolved).toEqual({
    font: { id: "0x7f090000", path: "res/Yd.ttf" },
    family: { id: "0x7f090001", path: "res/dr.xml" },
  });
  expect(() => verifyCompiledAndroidFontFaces(xml, resolved.font.id)).not.toThrow();
  expect(
    androidFontResources(resources.replace("res/Yd.ttf", "res/font/another_name.ttf")).font.path,
  ).toBe("res/font/another_name.ttf");
  for (const bad of [
    resources.replace("site.baro.app.preview", "site.baro.app"),
    resources.replace("res/Yd.ttf", "res/../../private.ttf"),
    resources.replace("() (file) res/Yd.ttf", "(ja) (file) res/Yd.ttf"),
    resources.replace("() (file) res/Yd.ttf", "() @0x7f090002"),
    resources.replace(
      "  type id",
      "    resource 0x7f090002 font/baro_mobile\n      () (file) res/other.ttf\n  type id",
    ),
  ])
    expect(() => androidFontResources(bad)).toThrow();
  for (const bad of [
    xml.replace("=@0x7f090000", "=@0x7f090002"),
    xml.replace("fontWeight(0x7f040255)=600", "fontWeight(0x7f040255)=400"),
    xml.replace("'wght' 600", "'wght' 500"),
    xml.replace("fontStyle(0x7f040253)=0", "fontStyle(0x7f040253)=1"),
    xml.replace("E: font (line=4)", "E: unexpected (line=4)"),
  ])
    expect(() => verifyCompiledAndroidFontFaces(bad, "0x7f090000")).toThrow(
      "ANDROID_FONT_COMPILED_FACES_REQUIRED",
    );
});
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
test("preserved binary reuse binds the pinned original unaccepted report and every retained file before SDK execution", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-android-pin-test-")),
    directory = resolve(root, "input/inspection"),
    source = "a".repeat(40);
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(resolve(root, "tests/fixtures"), { recursive: true });
    const report = JSON.parse(
      await readFile(
        "docs/quality/mobile-internal-android-2026-10-23/inspection-dedcd0e.json",
        "utf8",
      ),
    );
    report.sourceSha = source;
    const bodies = [
      Buffer.from("synthetic-not-an-apk"),
      Buffer.concat([Buffer.from("c61fbc03c103191f", "hex"), Buffer.alloc(32)]),
      Buffer.from("synthetic-font-declarations"),
    ];
    const names = [
      `compiled-android-${source}.apk`,
      "generated-index.android.bundle",
      "font-faces.xml",
    ];
    for (let i = 0; i < 3; i++) {
      const body = bodies[i]!,
        name = names[i]!;
      await writeFile(resolve(directory, name), body);
      const field = ["apk", "generatedBundle", "fontDeclaration"][i]!;
      report[field] = { ...report[field], name, bytes: body.length, sha256: hash(body) };
    }
    const raw = Buffer.from(JSON.stringify(report));
    await writeFile(resolve(directory, "inspection.json"), raw);
    await writeFile(
      resolve(root, "tests/fixtures/android-internal-inspection.json"),
      JSON.stringify({
        version: 1,
        sourceSha: source,
        workflowRunId: "1",
        artifactId: "2",
        artifactName: `mobile-internal-android-failure-${source}`,
        inspectionSha256: hash(raw),
      }),
    );
    expect(
      (await verifyPinnedAndroidInspection(root, resolve(root, "input"))).report.accepted,
    ).toBe(false);
    const generated = bodies[1]!;
    expect(inspectPreservedAndroidBundle(generated, generated, report.graph, [])).toMatchObject({
      compiledBytesMatch: true,
      sourceModules: 1455,
    });
    expect(() =>
      inspectPreservedAndroidBundle(generated, Buffer.alloc(generated.length), report.graph, []),
    ).toThrow("INTERNAL_ANDROID_BUNDLE_BYTES_MISMATCH");
    expect(() =>
      inspectPreservedAndroidBundle(generated, generated, report.graph, [
        "assets/index.android.bundle.map",
      ]),
    ).toThrow("INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED");
    for (const name of names) {
      const path = resolve(directory, name),
        original = await readFile(path);
      await writeFile(path, Buffer.from("modified-synthetic-bytes"));
      await expect(verifyPinnedAndroidInspection(root, resolve(root, "input"))).rejects.toThrow(
        "INTERNAL_ANDROID_INSPECTION_FILE_CHANGED",
      );
      await writeFile(path, original);
    }
    await writeFile(
      resolve(directory, "inspection.json"),
      Buffer.from(JSON.stringify({ ...report, accepted: true })),
    );
    await expect(verifyPinnedAndroidInspection(root, resolve(root, "input"))).rejects.toThrow(
      "INTERNAL_ANDROID_INSPECTION_BYTES_CHANGED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
