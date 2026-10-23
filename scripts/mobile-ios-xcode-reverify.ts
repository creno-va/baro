import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertIosNativeInputs } from "./mobile-ios-keychain-host";
import {
  attestXcodeSimulatorControl,
  xcodeControlBuildFailure,
  xcodeControlEnvironment,
} from "./mobile-ios-xcode-control";
import { verifyPinnedXcodeCompilerInput } from "./mobile-ios-xcode-input";
import { verifyCompiledMobileFont } from "./mobile-native-assets";
import { verifyPreviewArtifact } from "./mobile-preview-artifact";

async function main() {
  if (process.platform !== "darwin") throw new Error("XCODE_REVERIFY_MAC_REQUIRED");
  const root = process.cwd(),
    env = xcodeControlEnvironment(process.env),
    tooling = env.TARGET_SHA,
    base = resolve(root, ".wrangler/ios-xcode-reverify");
  if (
    (await Bun.file(resolve(root, ".wrangler/mobile-build/xcode-control-ios.json")).exists()) ||
    (await Bun.file(resolve(root, ".wrangler/mobile-handoff/receipt-ios.json")).exists())
  )
    throw new Error("XCODE_CONTROL_FRESH_OUTPUT_REQUIRED");
  await mkdir(base, { recursive: true });
  const owned = await mkdtemp(resolve(base, "owned-")),
    work = resolve(owned, "checkout");
  let phase = "source",
    checkout = false;
  async function command(
    args: string[],
    cwd = root,
    childEnv: Record<string, string | undefined> = env,
  ) {
    const c = Bun.spawn(args, { cwd, env: childEnv, stdout: "pipe", stderr: "pipe" }),
      timer = setTimeout(() => c.kill(), 120000);
    try {
      const [o] = await Promise.all([new Response(c.stdout).text(), new Response(c.stderr).text()]);
      if (await c.exited) throw new Error("XCODE_REVERIFY_TOOL_FAILED");
      return o.trim();
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    if ((await command(["git", "rev-parse", "HEAD"])) !== tooling)
      throw new Error("XCODE_CONTROL_CHECKOUT_MISMATCH");
    await command(["git", "diff", "--quiet", "HEAD"]);
    phase = "pinned-compiler-input";
    const input = await verifyPinnedXcodeCompilerInput(
      root,
      resolve(root, ".wrangler/ios-xcode-input"),
    );
    phase = "native-input-parity";
    await assertIosNativeInputs(root, input.manifest.sourceSha, tooling);
    await command(["git", "worktree", "add", "--detach", work, input.manifest.sourceSha]);
    checkout = true;
    const products = resolve(
      work,
      ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator",
    );
    await mkdir(products, { recursive: true });
    await mkdir(resolve(work, ".wrangler/ios-xcode-control"), { recursive: true });
    phase = "extract-original-compiled-app";
    await command(["/usr/bin/unzip", "-q", input.zip, "-d", products]);
    phase = "host-signature-and-simulated-xml-der";
    const control = await attestXcodeSimulatorControl(work, input.manifest.sourceSha, tooling);
    if (
      control.infoPlistSha256 !== input.inspection.infoPlistSha256 ||
      control.executableSha256 !== input.inspection.executableSha256
    )
      throw new Error("XCODE_REVERIFY_COMPILED_BYTES_CHANGED");
    phase = "compiled-font";
    await verifyCompiledMobileFont("ios", work);
    phase = "package-original-source-checkout";
    // The packaging CLI enforces HEAD==binary source. Its owned checkout is exactly that source.
    await command(["bun", resolve(root, "scripts/mobile-preview-artifact.ts"), "ios"], work, {
      ...env,
      TARGET_SHA: input.manifest.sourceSha,
    });
    const handoff = resolve(work, ".wrangler/mobile-handoff"),
      raw = await readFile(resolve(handoff, "receipt-ios.json")),
      receipt = verifyPreviewArtifact(JSON.parse(raw.toString()), input.manifest.sourceSha, "ios"),
      zip = await readFile(resolve(handoff, receipt.artifact.name));
    if (
      receipt.artifact.bytes !== zip.length ||
      receipt.artifact.sha256 !== createHash("sha256").update(zip).digest("hex")
    )
      throw new Error("XCODE_REVERIFY_COMPILED_BYTES_CHANGED");
    await mkdir(resolve(root, ".wrangler/mobile-handoff"), { recursive: true });
    await mkdir(resolve(root, ".wrangler/mobile-build"), { recursive: true });
    await copyFile(
      resolve(handoff, "receipt-ios.json"),
      resolve(root, ".wrangler/mobile-handoff/receipt-ios.json"),
    );
    await copyFile(
      resolve(handoff, receipt.artifact.name),
      resolve(root, ".wrangler/mobile-handoff", receipt.artifact.name),
    );
    await copyFile(
      resolve(work, ".wrangler/mobile-build/xcode-control-ios.json"),
      resolve(root, ".wrangler/mobile-build/xcode-control-ios.json"),
    );
    await writeFile(
      resolve(base, "verification.json"),
      `${JSON.stringify(
        {
          version: 1,
          kind: "pinned-xcode-simulator-metadata-only",
          toolingSourceSha: tooling,
          binarySourceSha: input.manifest.sourceSha,
          input: input.manifest,
          observedAt: new Date().toISOString(),
          originalInspectionAccepted: false,
          nativeInputParityVerified: true,
          compiledAppBytesUnchanged: true,
          hostSignatureAndSimulatedSectionsVerified: true,
          recompiled: false,
          resigned: false,
          sdkReadinessVerified: false,
          physicalDeviceVerified: false,
          storeSigned: false,
          deployed: false,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    console.log("PINNED_XCODE_SIMULATOR_METADATA_VERIFIED_SDK_EXECUTION_PENDING");
  } catch (error) {
    const raw = error instanceof Error ? error.message : "",
      known = new Set([
        "XCODE_INPUT_IDENTITY_MISMATCH",
        "XCODE_INPUT_INSPECTION_CHANGED",
        "XCODE_INPUT_ARCHIVE_CHANGED",
        "XCODE_REVERIFY_TOOL_FAILED",
        "XCODE_REVERIFY_COMPILED_BYTES_CHANGED",
        "IOS_HOST_NATIVE_INPUTS_DIFFER",
      ]);
    await writeFile(
      resolve(base, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: tooling, phase, code: known.has(raw) ? raw : xcodeControlBuildFailure(error), sdkReadinessVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("XCODE_REVERIFY_FAILED");
  } finally {
    if (checkout) await command(["git", "worktree", "remove", "--force", work]).catch(() => {});
    await rm(owned, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("XCODE_REVERIFY_FAILED");
    process.exitCode = 1;
  });
