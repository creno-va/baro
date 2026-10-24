import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { internalIosEnvironment } from "./mobile-internal-ios-build";
import {
  assertIosBundledInputs,
  verifyIosColdLaunchReceipt,
  verifyIosLargeFontReceipt,
  verifyPinnedInternalIosInput,
} from "./mobile-internal-ios-input";
import {
  iosAuthCancelBaseSchema,
  type iosAuthCancelReceiptSchema,
  iosAuthenticationPrivacyBoundary,
  observeIosAuthCancelFailure,
  runIosAuthCancelUiTest,
  verifyIosAuthCancelReceipt,
} from "./mobile-ios-auth-cancel";
import {
  iosDirectoryBaseSchema,
  type iosDirectoryReceiptSchema,
  observeIosDirectoryFailure,
  observeIosKoreanDirectoryFailure,
  runIosDirectoryUiTest,
  verifyIosDirectoryReceipt,
} from "./mobile-ios-directory-ui";
import {
  observeHomeUiFailure,
  runIosHomeUiTest,
  verifyIosAccessibilityReceipt,
  verifyIosHomeUiReceipt,
} from "./mobile-ios-home-ui-test";
import {
  type iosInputReferenceReceiptSchema,
  observeIosInputReferenceFailure,
  runIosInputReference,
  verifyIosInputReferenceReceipt,
} from "./mobile-ios-input-reference";
import {
  iosInternalObservationOptions,
  iosLargestContentSize,
  readIosUiCapabilities,
  verifyIosContentSizeReadback,
} from "./mobile-ios-ui-capabilities";
import { attestXcodeSimulatorControl, xcodeControlBuildFailure } from "./mobile-ios-xcode-control";
import { verifyCompiledMobileFont } from "./mobile-native-assets";
import { observePreviewApi } from "./mobile-preview-artifact";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function main() {
  if (process.platform !== "darwin") throw new Error("INTERNAL_IOS_MAC_REQUIRED");
  const options = iosInternalObservationOptions(process.argv.slice(2)),
    { home, largeFont, uiTest, accessibilityAudit, authCancel, publicDirectory } = options,
    inputReference = "inputReference" in options && options.inputReference === true,
    koreanDirectory = "koreanDirectory" in options && options.koreanDirectory === true;
  const root = process.cwd(),
    env = internalIosEnvironment(process.env),
    tooling = env.TARGET_SHA as string,
    base = resolve(root, ".wrangler/mobile-internal-ios-reverify"),
    owned = resolve(base, `owned-${randomUUID()}`),
    work = resolve(owned, "checkout");
  for (const name of [
    "verification.json",
    "receipt-ios.json",
    "failure.json",
    "home.json",
    "home-ios.png",
    "large-font.json",
    "large-font-ios.png",
    "home-ui-test.json",
    "accessibility-audit.json",
    "auth-cancel-ui.json",
    "directory-ui.json",
    "input-reference.json",
  ])
    if (await Bun.file(resolve(base, name)).exists())
      throw new Error("INTERNAL_IOS_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  const privacy = iosAuthenticationPrivacyBoundary();
  let checkout = false,
    device = "",
    phase = "source",
    sequence = 0,
    guardRequests = 0,
    guard: ReturnType<typeof Bun.serve> | undefined,
    uiTestFailure: ReturnType<typeof observeHomeUiFailure> | null = null,
    authCancelFailure: ReturnType<typeof observeIosAuthCancelFailure> | null = null,
    directoryFailure: ReturnType<typeof observeIosDirectoryFailure> | null = null,
    koreanDirectoryFailure: ReturnType<typeof observeIosKoreanDirectoryFailure> | null = null,
    inputReferenceFailure: ReturnType<typeof observeIosInputReferenceFailure> | null = null,
    lastCommand: {
      exitCode: number;
      timedOut: boolean;
      category: string;
    } | null = null;
  async function command(args: string[], cwd = root, timeout = 120000) {
    lastCommand = null;
    privacy.assertCommandAllowed(args);
    const c = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      c.kill();
    }, timeout);
    try {
      const [out, err] = await Promise.all([
          new Response(c.stdout).text(),
          new Response(c.stderr).text(),
        ]),
        exit = await c.exited;
      if (privacy.persistCommandLogs)
        await writeFile(resolve(owned, `private-command-${sequence++}.log`), `${out}\n${err}`);
      if (exit !== 0 || expired) {
        if (phase === "large-font-home-guide-xcuitest" || phase === "native-auth-cancel-xcuitest")
          uiTestFailure = observeHomeUiFailure(`${out}\n${err}`);
        if (phase === "native-auth-cancel-xcuitest")
          authCancelFailure = observeIosAuthCancelFailure(`${out}\n${err}`);
        if (phase === "public-directory-xcuitest") {
          directoryFailure = observeIosDirectoryFailure(`${out}\n${err}`);
          if (koreanDirectory)
            koreanDirectoryFailure = observeIosKoreanDirectoryFailure(`${out}\n${err}`);
        }
        if (phase === "uikit-input-reference-xcuitest")
          inputReferenceFailure = observeIosInputReferenceFailure(`${out}\n${err}`);
        lastCommand = {
          exitCode: exit,
          timedOut: expired,
          category: expired
            ? "COMMAND_TIMEOUT"
            : /FBSOpenApplicationService|not allowed to launch/i.test(err)
              ? "APPLICATION_LAUNCH_DENIED"
              : "COMMAND_FAILED",
        };
        throw new Error("INTERNAL_IOS_VERIFICATION_COMMAND_FAILED");
      }
      return out.trim();
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    if ((await command(["git", "rev-parse", "HEAD"])) !== tooling)
      throw new Error("INTERNAL_IOS_CHECKOUT_MISMATCH");
    await command(["git", "diff", "--quiet", "HEAD"]);
    await command(["git", "merge-base", "--is-ancestor", tooling, "origin/main"]);
    phase = "pinned-input";
    const input = await verifyPinnedInternalIosInput(
      root,
      resolve(root, ".wrangler/mobile-internal-ios-input"),
    );
    if (await Bun.file(resolve(base, input.receipt.artifact.name)).exists())
      throw new Error("INTERNAL_IOS_FRESH_OUTPUT_REQUIRED");
    phase = "bundled-input-parity";
    await assertIosBundledInputs(root, input.pin.sourceSha, tooling);
    await command(["git", "worktree", "add", "--detach", work, tooling]);
    checkout = true;
    const products = resolve(
      work,
      ".wrangler/mobile-build/ios/Build/Products/Release-iphonesimulator",
    );
    await mkdir(products, { recursive: true });
    await mkdir(resolve(work, ".wrangler/ios-xcode-control"), { recursive: true });
    phase = "extract-original-archive";
    await command(["/usr/bin/ditto", "-x", "-k", input.zip, products]);
    phase = "actual-signature-and-sections";
    const control = await attestXcodeSimulatorControl(
      work,
      input.pin.sourceSha,
      tooling,
      "Release",
    );
    const sections = (v: typeof control) =>
      JSON.stringify(
        [...v.sectionHashes].sort((a, b) => a.architecture.localeCompare(b.architecture)),
      );
    if (
      control.infoPlistSha256 !== input.receipt.control.infoPlistSha256 ||
      control.executableSha256 !== input.receipt.control.executableSha256 ||
      sections(control) !== sections(input.receipt.control)
    )
      throw new Error("INTERNAL_IOS_COMPILED_METADATA_CHANGED");
    phase = "compiled-font";
    const font = await verifyCompiledMobileFont("ios", work, "Release");
    if (JSON.stringify(font) !== JSON.stringify(input.receipt.compiledFont))
      throw new Error("INTERNAL_IOS_COMPILED_FONT_CHANGED");
    const apps = (await readdir(products)).filter((p) => p.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw new Error("INTERNAL_IOS_COMPILED_APP_REQUIRED");
    const app = resolve(products, apps[0]),
      bundle = await readFile(resolve(app, "main.jsbundle")),
      paths = (await command(["unzip", "-Z1", input.zip])).split(/\r?\n/);
    phase = "pinned-compiled-bundle";
    if (
      bundle.length !== input.receipt.embeddedBundle.bytes ||
      hash(bundle) !== input.receipt.embeddedBundle.sha256 ||
      Buffer.from(bundle.subarray(0, 8)).toString("hex") !== "c61fbc03c103191f" ||
      paths.some((p) => /\.map$/i.test(p))
    )
      throw new Error("INTERNAL_IOS_BUNDLE_BYTES_CHANGED");
    // Keep the original compiler receipt byte-for-byte; its original health/time/source remain facts.
    await writeFile(resolve(base, "receipt-ios.json"), input.raw, { flag: "wx" });
    await copyFile(input.zip, resolve(base, input.receipt.artifact.name));
    if (
      hash(await readFile(resolve(base, input.receipt.artifact.name))) !==
      input.receipt.artifact.sha256
    )
      throw new Error("INTERNAL_IOS_ARCHIVE_CHANGED");
    await writeFile(
      resolve(base, "verification.json"),
      `${JSON.stringify({ version: 1, kind: "pinned-ios-bundled-metadata-only", binarySourceSha: input.pin.sourceSha, toolingSourceSha: tooling, input: input.pin, observedAt: new Date().toISOString(), bundledInputParityVerified: true, originalReceiptUnchanged: true, archiveSha256: input.receipt.artifact.sha256, compiledHbcBytesVerified: true, graphFromPinnedCompilerReceipt: true, sourceMapRebuilt: false, actualControl: control, compiledFont: font, apiObservation: await observePreviewApi(), recompiled: false, resigned: false, appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    if (!home) {
      console.log("PINNED_INTERNAL_IOS_METADATA_VERIFIED_RUNTIME_PENDING");
      return;
    }
    phase = "metro-guard";
    try {
      guard = Bun.serve({
        hostname: "127.0.0.1",
        port: 8081,
        fetch: () => {
          guardRequests++;
          return new Response(null, { status: 503 });
        },
      });
    } catch {
      throw new Error("INTERNAL_IOS_METRO_PORT_UNAVAILABLE");
    }
    phase = "owned-simulator";
    const runtimes = JSON.parse(await command(["xcrun", "simctl", "list", "runtimes", "--json"]))
        .runtimes as {
        identifier: string;
        version: string;
        isAvailable: boolean;
      }[],
      types = JSON.parse(await command(["xcrun", "simctl", "list", "devicetypes", "--json"]))
        .devicetypes as { identifier: string; name: string }[];
    const runtime = runtimes.filter((r) => r.isAvailable && r.identifier.includes(".iOS-")).at(-1),
      type = types.find((t) => t.name === "iPhone 16");
    if (!runtime || !type) throw new Error("INTERNAL_IOS_RUNTIME_REQUIRED");
    const name = `baro_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    device = await command([
      "xcrun",
      "simctl",
      "create",
      name,
      type.identifier,
      runtime.identifier,
    ]);
    if (!/^[a-f0-9-]{36}$/i.test(device)) throw new Error("INTERNAL_IOS_OWNED_DEVICE_REQUIRED");
    await command(["xcrun", "simctl", "boot", device]);
    await command(["xcrun", "simctl", "bootstatus", device, "-b"], root, 240000);
    const inventory = JSON.parse(await command(["xcrun", "simctl", "list", "devices", "--json"]))
      .devices as Record<string, { udid: string; name: string; state: string }[]>;
    if (
      !Object.values(inventory)
        .flat()
        .some((d) => d.udid === device && d.name === name && d.state === "Booted")
    )
      throw new Error("INTERNAL_IOS_OWNED_DEVICE_REQUIRED");
    phase = "install-original-app";
    await command(["xcrun", "simctl", "install", device, app]);
    const observations: {
        ordinal: number;
        elapsedSeconds: number;
        samePidReadbackSamples: number;
      }[] = [],
      pids: string[] = [];
    async function observeLaunch(ordinal: number) {
      await command(["xcrun", "simctl", "terminate", device, "site.baro.app.preview"]).catch(
        () => {},
      );
      const started = Date.now(),
        launched = await command(["xcrun", "simctl", "launch", device, "site.baro.app.preview"]),
        pid = launched.match(/^site\.baro\.app\.preview:\s*(\d+)\s*$/m)?.[1];
      if (!pid || pid === "0") throw new Error("INTERNAL_IOS_LAUNCH_PID_REQUIRED");
      pids.push(pid);
      for (let sample = 0; sample < 3; sample++) {
        await Bun.sleep(5000);
        const rows = (
            await command(["xcrun", "simctl", "spawn", device, "launchctl", "list"])
          ).split(/\r?\n/),
          row = rows.find((s) => s.includes("UIKitApplication:site.baro.app.preview["));
        if (row?.trim().split(/\s+/)[0] !== pid)
          throw new Error("INTERNAL_IOS_PROCESS_NOT_RUNNING");
        if (guardRequests) throw new Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
      }
      return {
        ordinal,
        elapsedSeconds: Math.floor((Date.now() - started) / 1000),
        samePidReadbackSamples: 3,
      };
    }
    for (const ordinal of [1, 2]) {
      phase = `cold-launch-${ordinal}`;
      observations.push(await observeLaunch(ordinal));
    }
    if (new Set(pids).size !== 2) throw new Error("INTERNAL_IOS_DISTINCT_COLD_STARTS_REQUIRED");
    phase = "anonymous-initial-screen";
    await command(["xcrun", "simctl", "io", device, "screenshot", resolve(base, "home-ios.png")]);
    const png = await readFile(resolve(base, "home-ios.png"));
    if (guardRequests) throw new Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
    const receipt = verifyIosColdLaunchReceipt(
      {
        version: 1,
        kind: "ios-bundled-cold-launch-observation",
        binarySourceSha: input.pin.sourceSha,
        toolingSourceSha: tooling,
        observedAt: new Date().toISOString(),
        applicationId: "site.baro.app.preview",
        nativeConfiguration: "Release",
        requiresMetro: false,
        archiveSha256: input.receipt.artifact.sha256,
        compilerReceiptSha256: input.pin.receiptSha256,
        device: { kind: "simulator", model: type.name, osVersion: runtime.version },
        coldLaunches: observations,
        nativeProcessLaunchVerified: true,
        distinctColdLaunchPids: true,
        wholeIntervalContinuityProven: false,
        metroStarted: false,
        metroGuardRequests: 0,
        anonymousFreshInstall: true,
        publicDataNavigation: false,
        screenshot: { name: "home-ios.png", bytes: png.length, sha256: hash(png) },
        homeContentVerified: false,
        visualReviewRequired: true,
        productJourneysVerified: false,
        accessibilityVerified: false,
        httpTransportSeparatelyObserved: false,
        remoteApiVerified: false,
        oauthVerified: false,
        physicalDeviceVerified: false,
        storeSigned: false,
        deployed: false,
      },
      input.pin.sourceSha,
      tooling,
      {
        archiveSha256: input.receipt.artifact.sha256,
        compilerReceiptSha256: input.pin.receiptSha256,
      },
    );
    await writeFile(resolve(base, "home.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    console.log("INTERNAL_IOS_COLD_LAUNCH_OBSERVED_VISUAL_REVIEW_REQUIRED");
    if (inputReference) {
      phase = "uikit-input-reference-xcuitest";
      privacy.enterPublicData();
      if (privacy.explicitScreenshotReadsAllowed || privacy.persistCommandLogs)
        throw Error("INTERNAL_IOS_REFERENCE_PRIVACY_BOUNDARY_REQUIRED");
      const observation = await runIosInputReference({
        root,
        owned,
        device,
        captureSuppressed: !privacy.explicitScreenshotReadsAllowed && !privacy.persistCommandLogs,
        command,
      });
      if (guardRequests) throw Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
      const proof = verifyIosInputReferenceReceipt(
        {
          ...iosAuthCancelBaseSchema.strip().parse(receipt),
          kind: "ios-bundled-home-with-separate-uikit-input-reference",
          observedAt: new Date().toISOString(),
          ...observation,
          referenceAppAndRunnerCompiled: true,
          productRecompiled: false,
          productResigned: false,
          productDirectoryNavigated: false,
          explicitScreenshotsSuppressedBeforeReference: true,
          hostRawCommandLogsPersistedAfterBoundary: false,
          rawXcresultExported: false,
          rawUiHierarchyExported: false,
        } satisfies z.input<typeof iosInputReferenceReceiptSchema>,
        receipt,
      );
      await writeFile(
        resolve(base, "input-reference.json"),
        `${JSON.stringify(proof, null, 2)}\n`,
        {
          flag: "wx",
        },
      );
      console.log("INTERNAL_IOS_UIKIT_REFERENCE_OBSERVED_PRODUCT_INPUT_UNVERIFIED");
    }
    if (authCancel) {
      phase = "native-auth-cancel-xcuitest";
      privacy.enterAuthentication();
      const explicitScreenshotsSuppressedBeforeNavigation = !privacy.explicitScreenshotReadsAllowed,
        hostRawCommandLogsPersistedAfterBoundary = privacy.persistCommandLogs;
      if (
        !explicitScreenshotsSuppressedBeforeNavigation ||
        hostRawCommandLogsPersistedAfterBoundary
      )
        throw Error("INTERNAL_IOS_AUTH_PRIVACY_BOUNDARY_REQUIRED");
      const observation = await runIosAuthCancelUiTest({ root, owned, device, command });
      if (guardRequests) throw Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
      const proof = verifyIosAuthCancelReceipt(
        {
          ...iosAuthCancelBaseSchema.strip().parse(receipt),
          kind: "ios-bundled-anonymous-auth-cancellation",
          observedAt: new Date().toISOString(),
          ...observation,
          explicitScreenshotsSuppressedBeforeNavigation,
          hostRawCommandLogsPersistedAfterBoundary,
          rawXcresultExported: false,
          rawUiHierarchyExported: false,
          uiTestRunnerCompiled: true,
          productRecompiled: false,
          productResigned: false,
        } satisfies z.input<typeof iosAuthCancelReceiptSchema>,
        receipt,
      );
      await writeFile(resolve(base, "auth-cancel-ui.json"), `${JSON.stringify(proof, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("INTERNAL_IOS_ANONYMOUS_AUTH_CANCELLATION_OBSERVED");
    }
    if (publicDirectory || koreanDirectory) {
      phase = "public-directory-xcuitest";
      privacy.enterPublicData();
      const explicitScreenshotsSuppressedBeforeNavigation = !privacy.explicitScreenshotReadsAllowed,
        hostRawCommandLogsPersistedAfterBoundary = privacy.persistCommandLogs;
      if (
        !explicitScreenshotsSuppressedBeforeNavigation ||
        hostRawCommandLogsPersistedAfterBoundary
      )
        throw Error("INTERNAL_IOS_DIRECTORY_PRIVACY_BOUNDARY_REQUIRED");
      const observation = await runIosDirectoryUiTest({
        root,
        owned,
        device,
        command,
        korean: koreanDirectory,
        captureSuppressed: !privacy.explicitScreenshotReadsAllowed && !privacy.persistCommandLogs,
      });
      if (guardRequests) throw Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
      const proof = verifyIosDirectoryReceipt(
        {
          ...iosDirectoryBaseSchema.strip().parse(receipt),
          kind: koreanDirectory
            ? "ios-bundled-public-directory-korean-composition-observation"
            : "ios-bundled-public-directory-software-search-observation",
          observedAt: new Date().toISOString(),
          ...observation,
          explicitScreenshotsSuppressedBeforeNavigation,
          hostRawCommandLogsPersistedAfterBoundary,
          rawXcresultExported: false,
          rawUiHierarchyExported: false,
          uiTestRunnerCompiled: true,
          productRecompiled: false,
          productResigned: false,
        } satisfies z.input<typeof iosDirectoryReceiptSchema>,
        receipt,
      );
      await writeFile(resolve(base, "directory-ui.json"), `${JSON.stringify(proof, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("INTERNAL_IOS_PUBLIC_DIRECTORY_INPUT_OBSERVED");
    }
    if (largeFont) {
      phase = "large-font-sdk-capabilities";
      const capabilities = await readIosUiCapabilities(tooling);
      if (
        !capabilities.contentSizeOperationAdvertised ||
        !capabilities.advertisedContentSizes.includes(iosLargestContentSize)
      )
        throw Error("INTERNAL_IOS_CONTENT_SIZE_UNSUPPORTED");
      phase = "large-font-set-readback";
      await command(["xcrun", "simctl", "ui", device, "content_size", iosLargestContentSize]);
      const before = verifyIosContentSizeReadback(
        await command(["xcrun", "simctl", "ui", device, "content_size"]),
      );
      phase = "large-font-restart";
      const observed = await observeLaunch(3);
      if (new Set(pids).size !== 3) throw Error("INTERNAL_IOS_DISTINCT_COLD_STARTS_REQUIRED");
      const after = verifyIosContentSizeReadback(
        await command(["xcrun", "simctl", "ui", device, "content_size"]),
      );
      phase = "large-font-anonymous-screen";
      await command([
        "xcrun",
        "simctl",
        "io",
        device,
        "screenshot",
        resolve(base, "large-font-ios.png"),
      ]);
      const image = await readFile(resolve(base, "large-font-ios.png"));
      if (guardRequests) throw Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
      const { coldLaunches: _launches, distinctColdLaunchPids: _distinct, ...common } = receipt;
      const large = verifyIosLargeFontReceipt(
        {
          ...common,
          kind: "ios-bundled-large-font-observation",
          observedAt: new Date().toISOString(),
          requestedContentSize: iosLargestContentSize,
          contentSizeBeforeRestart: before,
          contentSizeAfterRestart: after,
          sdkHelpSha256: capabilities.helpSha256,
          nativeContentSizeReadbackVerified: true,
          processRestarted: true,
          elapsedSeconds: observed.elapsedSeconds,
          samePidReadbackSamples: observed.samePidReadbackSamples,
          semanticTextScaleProven: false,
          screenshot: { name: "large-font-ios.png", bytes: image.length, sha256: hash(image) },
        },
        receipt,
      );
      await writeFile(resolve(base, "large-font.json"), `${JSON.stringify(large, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("INTERNAL_IOS_LARGE_FONT_READBACK_OBSERVED_VISUAL_REVIEW_REQUIRED");
      if (uiTest) {
        phase = "large-font-home-guide-xcuitest";
        const { accessibilityResult, ...observation } = await runIosHomeUiTest({
          root,
          owned,
          device,
          command,
          accessibilityAudit,
        });
        if (guardRequests) throw Error("INTERNAL_IOS_UNEXPECTED_METRO_REQUEST");
        const proof = verifyIosHomeUiReceipt(
          {
            version: 1,
            kind: "ios-bundled-large-font-home-guide-ui-observation",
            binarySourceSha: receipt.binarySourceSha,
            toolingSourceSha: tooling,
            observedAt: new Date().toISOString(),
            applicationId: receipt.applicationId,
            archiveSha256: receipt.archiveSha256,
            compilerReceiptSha256: receipt.compilerReceiptSha256,
            device: receipt.device,
            requiresMetro: false,
            metroStarted: false,
            metroGuardRequests: 0,
            anonymousFreshInstall: true,
            ...observation,
            productRecompiled: false,
            productResigned: false,
            uiTestRunnerCompiled: true,
            rawUiHierarchyExported: false,
            rawXcresultExported: false,
            accessibilityVerified: false,
            productJourneysVerified: false,
            remoteApiVerified: false,
            oauthVerified: false,
            physicalDeviceVerified: false,
            storeSigned: false,
            deployed: false,
          },
          receipt,
          large,
        );
        await writeFile(resolve(base, "home-ui-test.json"), `${JSON.stringify(proof, null, 2)}\n`, {
          flag: "wx",
        });
        console.log("INTERNAL_IOS_LARGE_FONT_HOME_GUIDE_UI_TEST_OBSERVED");
        if (accessibilityAudit) {
          phase = "large-font-home-guide-accessibility-audit";
          const auditProof = verifyIosAccessibilityReceipt(
            {
              ...proof,
              kind: "ios-bundled-large-font-home-guide-accessibility-audit",
              result: accessibilityResult,
            },
            proof,
          );
          await writeFile(
            resolve(base, "accessibility-audit.json"),
            `${JSON.stringify(auditProof, null, 2)}\n`,
            { flag: "wx" },
          );
          if (!auditProof.result.auditPassed)
            throw Error("INTERNAL_IOS_ACCESSIBILITY_ISSUES_FOUND");
          console.log("INTERNAL_IOS_SCOPED_ACCESSIBILITY_AUDIT_PASSED");
        }
      }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "",
      known = new Set([
        "INTERNAL_IOS_UI_TEST_OWNED_MAC_CI_REQUIRED",
        "INTERNAL_IOS_UI_TEST_GENERATOR_VERSION_REQUIRED",
        "INTERNAL_IOS_UI_TEST_SINGLE_RESULT_REQUIRED",
        "INTERNAL_IOS_UI_TEST_IDENTITY_MISMATCH",
        "INTERNAL_IOS_AUTH_SINGLE_RESULT_REQUIRED",
        "INTERNAL_IOS_AUTH_IDENTITY_MISMATCH",
        "INTERNAL_IOS_AUTH_OWNED_MAC_CI_REQUIRED",
        "INTERNAL_IOS_AUTH_SCREENSHOT_FORBIDDEN",
        "INTERNAL_IOS_AUTH_PRIVACY_BOUNDARY_REQUIRED",
        "INTERNAL_IOS_DIRECTORY_RESULT_REQUIRED",
        "INTERNAL_IOS_DIRECTORY_IDENTITY_MISMATCH",
        "INTERNAL_IOS_DIRECTORY_OWNED_MAC_CI_REQUIRED",
        "INTERNAL_IOS_DIRECTORY_PRIVACY_BOUNDARY_REQUIRED",
        "INTERNAL_IOS_REFERENCE_RESULT_REQUIRED",
        "INTERNAL_IOS_REFERENCE_IDENTITY_MISMATCH",
        "INTERNAL_IOS_REFERENCE_OWNED_MAC_CI_REQUIRED",
        "INTERNAL_IOS_REFERENCE_PRIVACY_BOUNDARY_REQUIRED",
        "INTERNAL_IOS_REFERENCE_SIGNATURE_SOURCE_REQUIRED",
        "INTERNAL_IOS_AUDIT_SINGLE_RESULT_REQUIRED",
        "INTERNAL_IOS_AUDIT_IDENTITY_MISMATCH",
        "INTERNAL_IOS_ACCESSIBILITY_ISSUES_FOUND",
        "INTERNAL_IOS_CONTENT_SIZE_UNSUPPORTED",
        "INTERNAL_IOS_CONTENT_SIZE_READBACK_MISMATCH",
        "INTERNAL_IOS_LARGE_FONT_IDENTITY_MISMATCH",
        "INTERNAL_IOS_CHECKOUT_MISMATCH",
        "INTERNAL_IOS_PIN_IDENTITY_MISMATCH",
        "INTERNAL_IOS_RECEIPT_CHANGED",
        "INTERNAL_IOS_ARCHIVE_CHANGED",
        "INTERNAL_IOS_BUNDLED_INPUTS_CHANGED",
        "INTERNAL_IOS_COMPILED_METADATA_CHANGED",
        "INTERNAL_IOS_COMPILED_FONT_CHANGED",
        "INTERNAL_IOS_COMPILED_APP_REQUIRED",
        "INTERNAL_IOS_BUNDLE_BYTES_CHANGED",
        "INTERNAL_IOS_METRO_PORT_UNAVAILABLE",
        "INTERNAL_IOS_RUNTIME_REQUIRED",
        "INTERNAL_IOS_OWNED_DEVICE_REQUIRED",
        "INTERNAL_IOS_LAUNCH_PID_REQUIRED",
        "INTERNAL_IOS_PROCESS_NOT_RUNNING",
        "INTERNAL_IOS_UNEXPECTED_METRO_REQUEST",
        "INTERNAL_IOS_DISTINCT_COLD_STARTS_REQUIRED",
        "INTERNAL_IOS_VERIFICATION_COMMAND_FAILED",
      ]);
    await writeFile(
      resolve(base, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: tooling, phase, code: known.has(code) ? code : xcodeControlBuildFailure(error), lastCommand, uiTestFailure, authCancelFailure, directoryFailure, koreanDirectoryFailure, inputReferenceFailure, nativeProcessLaunchVerified: false, homeContentVerified: false, remoteApiVerified: false, oauthVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("INTERNAL_IOS_REVERIFY_FAILED");
  } finally {
    if (guard) await guard.stop(true);
    if (device) {
      await command(["xcrun", "simctl", "shutdown", device]).catch(() => {});
      await command(["xcrun", "simctl", "delete", device]).catch(() => {});
    }
    if (checkout) await command(["git", "worktree", "remove", "--force", work]).catch(() => {});
    await rm(owned, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("INTERNAL_IOS_REVERIFY_FAILED");
    process.exitCode = 1;
  });
