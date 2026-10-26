import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { internalIosEnvironment } from "../scripts/mobile-internal-ios-build";
import {
  nativeTextInputCompileSchema,
  nativeTextInputPatchPaths,
  nativeTextInputPatchSchema,
  verifyNativeTextInputCompilation,
  verifyNativeTextInputPatch,
} from "../scripts/mobile-ios-text-input-patch";
import { bytesHash, packageTreeHash, patchFilePaths } from "../scripts/toolchain-patches";

test("native patch preserves the exact registry version/license and reconstructs the unmodified release tree", async () => {
  const manifest = await verifyNativeTextInputPatch(process.cwd(), {
    bytesHash,
    packageTreeHash,
    patchFilePaths,
  });
  expect(manifest.nativeRuntimeVerified).toBe(false);
  expect(manifest.upstreamMergedAtAdoption).toBe(false);
  const owned = await mkdtemp(resolve(tmpdir(), "baro-native-input-before-"));
  try {
    const before = resolve(owned, "react-native");
    await cp("node_modules/react-native", before, { recursive: true });
    const reverse = Bun.spawn(
      [
        "git",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "apply",
        "--reverse",
        resolve(manifest.patch),
      ],
      {
        cwd: before,
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    expect(await reverse.exited).toBe(0);
    expect(await packageTreeHash(before)).toBe(manifest.beforeTreeSha256);
    expect(bytesHash(await readFile(resolve(before, "LICENSE")))).toBe(manifest.licenseSha256);
    for (const file of manifest.changes)
      expect(bytesHash(await readFile(resolve(before, file.path)))).toBe(file.beforeSha256);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}, 20000);
test("native patch manifest cannot silently claim a merged upstream/runtime or change package/path coverage", async () => {
  const manifest = await Bun.file("patches/react-native-ios-input.json").json();
  for (const patch of [
    { packageVersion: "0.88.1" },
    { upstreamMergedAtAdoption: true },
    { nativeRuntimeVerified: true },
    { upstreamHeadSha: "a".repeat(40) },
    { changes: [...manifest.changes, manifest.changes[0]] },
    { changes: manifest.changes.map(() => manifest.changes[0]) },
    { changes: [{ ...manifest.changes[0], path: "index.js" }, ...manifest.changes.slice(1)] },
    { patch: "../../other.patch" },
  ])
    expect(nativeTextInputPatchSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
});
function compilation(root: string) {
  return ["arm64", "x86_64"].flatMap((arch) =>
    nativeTextInputPatchPaths
      .filter((p) => p.endsWith(".mm"))
      .map(
        (path) =>
          `CompileC /owned/objects/${arch}/source.o ${resolve(root, path)} normal ${arch} objective-c++ com.apple.compilers.llvm.clang.1_0.compiler (in target 'React-RCTFabric' from project 'Pods')`,
      ),
  );
}
test("native source receipt rejects a prebuilt success, partial architecture, wrong source and unchanged build property", () => {
  const root = "/owned/node_modules/react-native",
    lines = compilation(root),
    properties = { "ios.buildReactNativeFromSource": "true" };
  expect(() =>
    verifyNativeTextInputCompilation(lines.join("\n"), [root], properties),
  ).not.toThrow();
  for (const output of [
    "** BUILD SUCCEEDED **",
    lines.slice(1).join("\n"),
    lines.join("\n").replaceAll("CompileC ", "echo CompileC "),
    compilation("/unowned/other").join("\n"),
    lines.join("\n").replaceAll("objective-c++ ", "objective-c "),
  ])
    expect(() => verifyNativeTextInputCompilation(output, [root], properties)).toThrow();
  for (const value of [
    {},
    null,
    { "ios.buildReactNativeFromSource": true },
    { "ios.buildReactNativeFromSource": "false" },
  ])
    expect(() => verifyNativeTextInputCompilation(lines.join("\n"), [root], value)).toThrow();
  for (const roots of [[], ["relative"], ["/owned with space"]])
    expect(() => verifyNativeTextInputCompilation(lines.join("\n"), roots, properties)).toThrow();
  const proof = {
    kind: "ios-text-input-patched-source-compile-only",
    reactNative: "0.88.0",
    patchSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    generatedSourceBuildPropertyVerified: true,
    prebuiltRnCoreDisabled: true,
    compiledArchitectures: ["arm64", "x86_64"],
    bothSourcesObservedForEveryArchitecture: true,
    nativeRuntimeVerified: false,
  };
  expect(nativeTextInputCompileSchema.safeParse(proof).success).toBe(true);
  for (const patch of [
    { nativeRuntimeVerified: true },
    { prebuiltRnCoreDisabled: false },
    { compiledArchitectures: ["arm64"] },
    { bothSourcesObservedForEveryArchitecture: false },
  ])
    expect(nativeTextInputCompileSchema.safeParse({ ...proof, ...patch }).success).toBe(false);
});
test("internal compiler cannot inherit flags that select an unpatched prebuilt RNCore", () => {
  const env = internalIosEnvironment({
    GITHUB_ACTIONS: "true",
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    TARGET_SHA: "a".repeat(40),
    RCT_USE_PREBUILT_RNCORE: "1",
    RCT_USE_RN_DEP: "1",
  });
  expect(env.RCT_USE_PREBUILT_RNCORE).toBe("0");
  expect(env.RCT_USE_RN_DEP).toBe("0");
});
