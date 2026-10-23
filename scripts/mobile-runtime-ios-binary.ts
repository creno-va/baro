import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertIosNativeInputs } from "./mobile-ios-keychain-host";
import { attestXcodeSimulatorControl, xcodeControlReceiptSchema } from "./mobile-ios-xcode-control";
import { verifyPinnedXcodeCompilerInput } from "./mobile-ios-xcode-input";
import { verifyCompiledMobileFont } from "./mobile-native-assets";
import { pinnedRuntimeBinarySchema } from "./mobile-runtime-receipt";

export async function preparePinnedIosRuntime(root: string, toolingSourceSha: string) {
  const input = await verifyPinnedXcodeCompilerInput(
      root,
      resolve(root, ".wrangler/ios-xcode-input"),
    ),
    control = xcodeControlReceiptSchema.parse(
      JSON.parse(
        await readFile(resolve(root, ".wrangler/mobile-build/xcode-control-ios.json"), "utf8"),
      ),
    );
  if (
    control.toolingSourceSha !== toolingSourceSha ||
    control.sourceSha !== input.manifest.sourceSha ||
    control.infoPlistSha256 !== input.inspection.infoPlistSha256 ||
    control.executableSha256 !== input.inspection.executableSha256
  )
    throw new Error("RUNTIME_IOS_PIN_SOURCE_MISMATCH");
  await assertIosNativeInputs(root, input.manifest.sourceSha, toolingSourceSha);
  const evidence = pinnedRuntimeBinarySchema.parse({
    kind: "pinned-xcode-simulator-control",
    applicationId: "site.baro.app.preview",
    binarySourceSha: input.manifest.sourceSha,
    toolingSourceSha,
    compilerRunId: input.manifest.workflowRunId,
    archiveSha256: input.inspection.archive.sha256,
    infoPlistSha256: control.infoPlistSha256,
    executableSha256: control.executableSha256,
    nativeInputsMatch: true,
    simulatorRightsVerified: true,
    recompiled: false,
    resigned: false,
  });
  return { input, control, evidence };
}
export async function extractPinnedIosRuntime(
  work: string,
  pinned: Awaited<ReturnType<typeof preparePinnedIosRuntime>>,
  command: (args: string[]) => Promise<string>,
) {
  const products = resolve(work, ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator");
  await mkdir(products, { recursive: true });
  await mkdir(resolve(work, ".wrangler/ios-xcode-control"), { recursive: true });
  if ((await readdir(products)).length) throw new Error("RUNTIME_IOS_PIN_FRESH_OUTPUT_REQUIRED");
  await command(["/usr/bin/unzip", "-q", pinned.input.zip, "-d", products]);
  const actual = await attestXcodeSimulatorControl(
    work,
    pinned.evidence.binarySourceSha,
    pinned.evidence.toolingSourceSha,
  );
  if (
    actual.infoPlistSha256 !== pinned.evidence.infoPlistSha256 ||
    actual.executableSha256 !== pinned.evidence.executableSha256 ||
    JSON.stringify(actual.sectionHashes) !== JSON.stringify(pinned.control.sectionHashes)
  )
    throw new Error("RUNTIME_IOS_PIN_COMPILED_BYTES_CHANGED");
  await verifyCompiledMobileFont("ios", work);
}
