import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  type AndroidAuthDiagnostic,
  type androidAuthCancelReceiptSchema,
  androidAuthenticationPrivacyBoundary,
  androidAuthFailureCode,
  observeAndroidAuthCancellation,
  verifyAndroidAuthCancelReceipt,
} from "./mobile-android-auth-cancel";
import {
  type AndroidChromeFixture,
  prepareOwnedChromeFixture,
} from "./mobile-android-chrome-fixture";
import {
  type AndroidDirectoryDiagnostic,
  androidDirectoryFailureCode,
  type androidDirectoryReceiptSchema,
  observeAndroidDirectoryInput,
  verifyAndroidDirectoryReceipt,
} from "./mobile-android-directory-input";
import {
  type androidGuideUiReceiptSchema,
  androidGuideUiValidationFields,
  androidHomeObservationOptions,
  verifyAndroidGuideUiReceipt,
} from "./mobile-android-guide-ui";
import { verifyInternalAndroidArtifact } from "./mobile-internal-android-artifact";
import { internalAndroidEnvironment } from "./mobile-internal-android-build";
import { androidCompiledReverificationSchema } from "./mobile-internal-android-compiled-reverify";
import { androidReverificationSchema } from "./mobile-internal-android-reverify";
import {
  anonymousGuideControl,
  anonymousGuideUiObservation,
  anonymousScreenshotGuard,
  publicDirectoryButton,
  publicDirectoryUiObservation,
} from "./mobile-public-directory-observation";
import {
  androidRuntimeOptions,
  createOwnedAndroidAvd,
  emulatorStartupIssues,
  ownedAndroidPaths,
} from "./mobile-runtime-host";

const appId = "site.baro.app.preview";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function bundledAndroidHomeObservation(xml: string) {
  if (xml.length > 1_000_000 || !xml.startsWith("<?xml"))
    throw new Error("BUNDLED_HOME_HIERARCHY_REQUIRED");
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map((m) =>
    Object.fromEntries([...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
  const own = nodes.filter(
    (n) => n.package === appId && n.enabled === "true" && n["visible-to-user"] !== "false",
  );
  function visible(label: string) {
    return own.some((node) => {
      const bounds = node.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
      return (
        bounds &&
        Number(bounds[3]) > Number(bounds[1]) &&
        Number(bounds[4]) > Number(bounds[2]) &&
        [node.text, node["content-desc"]].some((s) => s?.includes(label))
      );
    });
  }
  return {
    titleVisible: visible("내 상황을 차근차근 정리해요."),
    firstCardVisible: visible("기억나는 내용부터"),
    foundationErrorVisible: visible("앱을 열 수 없어요"),
  };
}
async function main() {
  const { largeFont, publicDirectory, guideUi, authCancel, directoryInput } =
    androidHomeObservationOptions(process.argv.slice(2));
  const root = process.cwd(),
    sourceSha = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(process.env.TARGET_SHA),
    input = resolve(root, ".wrangler/mobile-internal-android-reverified"),
    out = resolve(root, ".wrangler/mobile-internal-android-runtime"),
    env = internalAndroidEnvironment(process.env),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk || process.env.GITHUB_ACTIONS !== "true")
    throw new Error("BUNDLED_HOME_FRESH_CI_SDK_REQUIRED");
  for (const name of [
    "receipt.json",
    "failure.json",
    "home.png",
    "guide-ui.json",
    "auth-cancel-ui.json",
    "directory-input.json",
  ])
    if (await Bun.file(resolve(out, name)).exists())
      throw new Error("BUNDLED_HOME_FRESH_OUTPUT_REQUIRED");
  await mkdir(out, { recursive: true });
  const avd = `baro_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    paths = ownedAndroidPaths(out),
    childEnv = { ...env, ...paths.environment },
    adb = resolve(sdk, "platform-tools/adb"),
    device = "emulator-5580",
    log = resolve(out, "private-emulator.log");
  let phase = "accepted-input",
    emulator: ReturnType<typeof Bun.spawn> | undefined,
    guard: ReturnType<typeof Bun.serve> | undefined,
    metroRequests = 0,
    bootCompleted = false,
    baseHomeVerified = false,
    receiptValidationFields: string[] = [],
    lastGuideObservation: ReturnType<typeof anonymousGuideUiObservation> | null = null,
    lastAuthObservation: AndroidAuthDiagnostic | null = null,
    lastChromeFixture: AndroidChromeFixture | null = null,
    lastDirectoryInputObservation: AndroidDirectoryDiagnostic | null = null,
    lastPublicObservation: ReturnType<typeof publicDirectoryUiObservation> | null = null,
    lastHomeObservation: ReturnType<typeof bundledAndroidHomeObservation> | null = null;
  const authPrivacy = androidAuthenticationPrivacyBoundary();
  async function bytes(args: string[], input?: string) {
    authPrivacy.assertCommandAllowed(args);
    const child = Bun.spawn(args, {
        cwd: root,
        env: childEnv,
        stdin: input === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }),
      timer = setTimeout(() => child.kill(), 120000);
    if (input !== undefined) {
      child.stdin?.write(input);
      child.stdin?.end();
    }
    try {
      const [body] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
      ]);
      if (await child.exited) throw new Error("BUNDLED_HOME_COMMAND_FAILED");
      return new Uint8Array(body);
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[], input?: string) =>
    new TextDecoder().decode(await bytes(args, input));
  const shell = (args: string[], input?: string) =>
    text([adb, "-s", device, "shell", ...args], input);
  const capture = anonymousScreenshotGuard(() =>
    bytes([adb, "-s", device, "exec-out", "screencap", "-p"]),
  );
  async function wait(check: () => Promise<boolean>, timeout: number) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("BUNDLED_HOME_WAIT_EXPIRED");
  }
  try {
    const verificationBytes = await readFile(resolve(input, "verification.json")),
      verification = z
        .union([androidReverificationSchema, androidCompiledReverificationSchema])
        .parse(JSON.parse(verificationBytes.toString()));
    if (
      verification.toolingSourceSha !== sourceSha ||
      !verification.bundledInputParityVerified ||
      !verification.sdkBinaryMetadataVerified
    )
      throw new Error("BUNDLED_HOME_VERIFIED_SOURCE_REQUIRED");
    const receipt = verifyInternalAndroidArtifact(
        JSON.parse(await readFile(resolve(input, "receipt-android.json"), "utf8")),
        verification.binarySourceSha,
      ),
      apk = resolve(input, receipt.artifact.name),
      body = await readFile(apk);
    if (body.length !== receipt.artifact.bytes || hash(body) !== receipt.artifact.sha256)
      throw new Error("BUNDLED_HOME_APK_BYTES_CHANGED");
    if ((await text(["git", "rev-parse", "HEAD"])).trim() !== sourceSha)
      throw new Error("BUNDLED_HOME_CHECKOUT_MISMATCH");
    await text(["git", "diff", "--quiet", "HEAD"]);
    phase = "metro-denied";
    guard = Bun.serve({
      hostname: "127.0.0.1",
      port: 8081,
      fetch() {
        metroRequests++;
        return new Response("METRO_UNAVAILABLE", { status: 503 });
      },
    });
    phase = "owned-avd";
    if ((await text([adb, "devices"])).split(/\r?\n/).some((l) => l.startsWith(`${device}\t`)))
      throw new Error("BUNDLED_HOME_EXISTING_DEVICE_REFUSED");
    await createOwnedAndroidAvd(sdk, out, avd, text);
    emulator = Bun.spawn([resolve(sdk, "emulator/emulator"), ...androidRuntimeOptions(avd)], {
      env: childEnv,
      stdout: Bun.file(log),
      stderr: Bun.file(log),
    });
    phase = "boot";
    await wait(async () => {
      if (emulator?.exitCode !== null) throw new Error("BUNDLED_HOME_EMULATOR_EXITED");
      try {
        bootCompleted = (await shell(["getprop", "sys.boot_completed"])).trim() === "1";
        return bootCompleted;
      } catch {
        return false;
      }
    }, 240000);
    await shell(["input", "keyevent", "82"]);
    if ((await text([adb, "-s", device, "reverse", "--list"])).trim())
      throw new Error("BUNDLED_HOME_ADB_REVERSE_REFUSED");
    phase = "install";
    await text([adb, "-s", device, "install", apk]);
    const observations = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      phase = `cold-launch-${attempt}`;
      await shell(["am", "force-stop", appId]);
      const launched = await shell(["am", "start", "-W", "-n", `${appId}/${appId}.MainActivity`]);
      if (!/^Status:\s*ok\r?$/m.test(launched))
        throw new Error("BUNDLED_HOME_ACTIVITY_LAUNCH_FAILED");
      let observed: ReturnType<typeof bundledAndroidHomeObservation> | undefined;
      await wait(async () => {
        try {
          await shell(["rm", "-f", "/sdcard/baro-internal-home.xml"]);
          await shell(["uiautomator", "dump", "--compressed", "/sdcard/baro-internal-home.xml"]);
          observed = bundledAndroidHomeObservation(
            await shell(["cat", "/sdcard/baro-internal-home.xml"]),
          );
          lastHomeObservation = observed;
          return (
            observed.titleVisible && observed.firstCardVisible && !observed.foundationErrorVisible
          );
        } catch {
          return false;
        }
      }, 120000);
      if (!/^\d+(?:\s+\d+)*$/.test((await shell(["pidof", appId])).trim()))
        throw new Error("BUNDLED_HOME_PROCESS_REQUIRED");
      observations.push({ coldLaunch: attempt, ...observed });
      if (attempt === 1) {
        const png = await capture.read();
        if (
          png.length < 24 ||
          Buffer.from(png.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
        )
          throw new Error("BUNDLED_HOME_SCREENSHOT_REQUIRED");
        await writeFile(resolve(out, "home.png"), png, { flag: "wx" });
      }
    }
    if (metroRequests !== 0) throw new Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
    const screenshot = await readFile(resolve(out, "home.png"));
    await writeFile(
      resolve(out, "receipt.json"),
      `${JSON.stringify(
        {
          version: 1,
          kind: "bundled-android-home-only",
          toolingSourceSha: sourceSha,
          binarySourceSha: receipt.sourceSha,
          observedAt: new Date().toISOString(),
          applicationId: appId,
          binary: receipt.artifact,
          verificationSha256: hash(verificationBytes),
          device: {
            kind: "owned-emulator",
            model: (await shell(["getprop", "ro.product.model"])).trim(),
            osVersion: (await shell(["getprop", "ro.build.version.release"])).trim(),
          },
          emulatorBootVerified: true,
          sdkHomeLaunchVerified: true,
          homeObservations: observations,
          metroServerStarted: false,
          metroRequests,
          adbReverseConfigured: false,
          screenshot: { name: "home.png", bytes: screenshot.length, sha256: hash(screenshot) },
          fullNativeIoVerified: false,
          productJourneysVerified: false,
          remoteApiVerified: false,
          oauthVerified: false,
          physicalDeviceVerified: false,
          storeSigned: false,
          deployed: false,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    console.log("ACTUAL_BUNDLED_ANDROID_HOME_OBSERVED_WITHOUT_METRO");
    baseHomeVerified = true;
    if (largeFont) {
      phase = "large-font-setting";
      await shell(["settings", "put", "system", "font_scale", "2.0"]);
      const fontScale = Number((await shell(["settings", "get", "system", "font_scale"])).trim());
      if (fontScale !== 2) throw new Error("BUNDLED_HOME_FONT_SCALE_MISMATCH");
      await shell(["am", "force-stop", appId]);
      const launch = await shell(["am", "start", "-W", "-n", `${appId}/${appId}.MainActivity`]);
      if (!/^Status:\s*ok\r?$/m.test(launch))
        throw new Error("BUNDLED_HOME_ACTIVITY_LAUNCH_FAILED");
      phase = "large-font-home";
      await wait(async () => {
        try {
          await shell(["rm", "-f", "/sdcard/baro-internal-home.xml"]);
          await shell(["uiautomator", "dump", "--compressed", "/sdcard/baro-internal-home.xml"]);
          lastHomeObservation = bundledAndroidHomeObservation(
            await shell(["cat", "/sdcard/baro-internal-home.xml"]),
          );
          return lastHomeObservation.titleVisible && !lastHomeObservation.foundationErrorVisible;
        } catch {
          return false;
        }
      }, 120000);
      const png = await capture.read();
      if (png.length < 24 || Buffer.from(png.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a")
        throw new Error("BUNDLED_HOME_SCREENSHOT_REQUIRED");
      if (metroRequests !== 0) throw new Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
      await writeFile(resolve(out, "large-font.png"), png, { flag: "wx" });
      await writeFile(
        resolve(out, "large-font.json"),
        `${JSON.stringify(
          {
            version: 1,
            kind: "bundled-android-large-font-home-only",
            toolingSourceSha: sourceSha,
            binarySourceSha: receipt.sourceSha,
            observedAt: new Date().toISOString(),
            applicationId: appId,
            binary: receipt.artifact,
            androidFontScaleSettingReadback: fontScale,
            homeObservation: lastHomeObservation,
            metroServerStarted: false,
            metroRequests,
            screenshot: { name: "large-font.png", bytes: png.length, sha256: hash(png) },
            allScreensVerified: false,
            keyboardVerified: false,
            rotationVerified: false,
            talkBackVerified: false,
            voiceOverVerified: false,
            remoteApiVerified: false,
            physicalDeviceVerified: false,
            storeSigned: false,
            deployed: false,
          },
          null,
          2,
        )}\n`,
        { flag: "wx" },
      );
      console.log("ACTUAL_ANDROID_LARGE_FONT_HOME_OBSERVED_OTHER_ACCESSIBILITY_UNVERIFIED");
    }
    if (guideUi) {
      capture.disable();
      const screenshotsSuppressedBeforeNavigation = !capture.allowed;
      if (!screenshotsSuppressedBeforeNavigation)
        throw Error("BUNDLED_GUIDE_SCREENSHOT_GUARD_REQUIRED");
      phase = "guide-ui-font-readback";
      const fontScaleBefore = Number(
        (await shell(["settings", "get", "system", "font_scale"])).trim(),
      );
      if (fontScaleBefore !== 2) throw Error("BUNDLED_HOME_FONT_SCALE_MISMATCH");
      const width = screenshot.readUInt32BE(16),
        height = screenshot.readUInt32BE(20);
      async function hierarchy() {
        await shell(["rm", "-f", "/sdcard/baro-internal-home.xml"]);
        await shell(["uiautomator", "dump", "--compressed", "/sdcard/baro-internal-home.xml"]);
        const value = await shell(["cat", "/sdcard/baro-internal-home.xml"]);
        lastGuideObservation = anonymousGuideUiObservation(value);
        return value;
      }
      async function reach(action: "open-guide" | "return-home") {
        for (let swipes = 0; swipes <= 24; swipes++) {
          const target = anonymousGuideControl(await hierarchy(), width, height, action);
          if (target) return { target, swipes };
          if (swipes < 24)
            await shell([
              "input",
              "swipe",
              String(Math.floor(width / 2)),
              String(Math.floor(height * 0.8)),
              String(Math.floor(width / 2)),
              String(Math.floor(height * 0.25)),
              "500",
            ]);
        }
        throw Error("BUNDLED_GUIDE_CONTROL_NOT_FOUND");
      }
      phase = "guide-ui-open";
      const guide = await reach("open-guide");
      if (!guide.swipes) throw Error("BUNDLED_GUIDE_SCROLL_NOT_OBSERVED");
      await shell(["input", "tap", String(guide.target.x), String(guide.target.y)]);
      await wait(
        async () => anonymousGuideUiObservation(await hierarchy()).guideTitleVisible,
        120000,
      );
      phase = "guide-ui-return";
      const home = await reach("return-home");
      if (!anonymousGuideUiObservation(await hierarchy()).currentFeatureDescriptionVisible)
        throw Error("BUNDLED_GUIDE_FEATURE_COPY_NOT_OBSERVED");
      await shell(["input", "tap", String(home.target.x), String(home.target.y)]);
      await wait(async () => {
        const observed = anonymousGuideUiObservation(await hierarchy());
        return (
          observed.homeTitleVisible &&
          !observed.guideTitleVisible &&
          !observed.configurationErrorVisible
        );
      }, 120000);
      const fontScaleAfter = Number(
        (await shell(["settings", "get", "system", "font_scale"])).trim(),
      );
      if (fontScaleAfter !== 2) throw Error("BUNDLED_HOME_FONT_SCALE_MISMATCH");
      if (metroRequests) throw Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
      if (!/^\d+(?:\s+\d+)*$/.test((await shell(["pidof", appId])).trim()))
        throw Error("BUNDLED_HOME_PROCESS_REQUIRED");
      phase = "guide-ui-proof";
      const baselineBytes = await readFile(resolve(out, "receipt.json")),
        baseline = JSON.parse(baselineBytes.toString()),
        identity = {
          toolingSourceSha: sourceSha,
          binarySourceSha: receipt.sourceSha,
          binary: receipt.artifact,
          verificationSha256: hash(verificationBytes),
          baselineReceiptSha256: hash(baselineBytes),
          device: baseline.device,
        };
      const proof = verifyAndroidGuideUiReceipt(
        {
          version: 1,
          kind: "bundled-android-large-font-home-guide-ui-only",
          ...identity,
          observedAt: new Date().toISOString(),
          applicationId: appId,
          fontScaleBefore,
          fontScaleAfter,
          homeSwipes: guide.swipes,
          guideSwipes: home.swipes,
          guideButtonTapVerified: true,
          guideTitleObserved: true,
          currentFeatureDescriptionObserved: true,
          returnButtonTapVerified: true,
          homeReturnObserved: true,
          guideDismissedObserved: true,
          controlBoundsWithinScreen: true,
          rawHierarchyExported: false,
          screenshotsSuppressedBeforeNavigation,
          publicDataNavigation: false,
          authenticationNavigation: false,
          metroServerStarted: false,
          metroRequests: 0,
          allScreensVerified: false,
          keyboardVerified: false,
          rotationVerified: false,
          talkBackVerified: false,
          voiceOverVerified: false,
          remoteApiVerified: false,
          oauthVerified: false,
          physicalDeviceVerified: false,
          storeSigned: false,
          deployed: false,
        } satisfies z.input<typeof androidGuideUiReceiptSchema>,
        identity,
      );
      await writeFile(resolve(out, "guide-ui.json"), `${JSON.stringify(proof, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("ACTUAL_ANDROID_LARGE_FONT_HOME_GUIDE_UI_OBSERVED");
    }
    if (authCancel) {
      // Irreversible before any session/auth UI, including every failure path.
      capture.disable();
      authPrivacy.enterAuthentication();
      phase = "auth-cancel-boundary";
      const screenshotsSuppressedBeforeNavigation = !capture.allowed;
      if (!screenshotsSuppressedBeforeNavigation || !authPrivacy.entered)
        throw Error("ANDROID_AUTH_BOUNDARY_REQUIRED");
      phase = "auth-cancel-chrome-fixture";
      const chrome = await prepareOwnedChromeFixture({
        shell,
        deviceSerial: device,
        avdName: avd,
        freshOwnedEmulator: bootCompleted && baseHomeVerified && emulator?.exitCode === null,
      });
      let results: Awaited<ReturnType<typeof observeAndroidAuthCancellation>>;
      try {
        results = await observeAndroidAuthCancellation({
          shell,
          width: screenshot.readUInt32BE(16),
          height: screenshot.readUInt32BE(20),
          boundaryEntered: authPrivacy.entered,
          screenshotsSuppressed: screenshotsSuppressedBeforeNavigation,
          diagnostic(value) {
            lastAuthObservation = value;
            phase = `auth-cancel-${value.stage}`;
          },
        });
      } finally {
        const observationPhase = phase;
        phase = "auth-cancel-chrome-fixture-cleanup";
        lastChromeFixture = await chrome.finish();
        phase = observationPhase;
      }
      if (!lastChromeFixture) throw Error("ANDROID_CHROME_FLAG_CLEANUP_FAILED");
      if (metroRequests) throw Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
      phase = "auth-cancel-proof";
      const baselineBytes = await readFile(resolve(out, "receipt.json")),
        baseline = JSON.parse(baselineBytes.toString()),
        identity = {
          toolingSourceSha: sourceSha,
          binarySourceSha: receipt.sourceSha,
          binary: receipt.artifact,
          verificationSha256: hash(verificationBytes),
          baselineReceiptSha256: hash(baselineBytes),
          device: baseline.device,
        };
      const proof = verifyAndroidAuthCancelReceipt(
        {
          ...identity,
          version: 1,
          kind: "android-anonymous-custom-tab-cancellation",
          observedAt: new Date().toISOString(),
          applicationId: appId,
          browserPackage: "com.android.chrome",
          browserFixture: lastChromeFixture,
          providers: results,
          coldAnonymousReturnObserved: true,
          explicitScreenshotsSuppressedBeforeNavigation: screenshotsSuppressedBeforeNavigation,
          adbCommandOutputPersisted: false,
          rawHierarchyExported: false,
          rawLogcatRead: false,
          accountLoginPerformed: false,
          credentialsEntered: false,
          callbackExchangeVerified: false,
          providerAcceptanceVerified: false,
          privateDataAccess: false,
          publicDataNavigation: false,
          authenticationNavigation: true,
          metroRequests: 0,
          physicalDeviceVerified: false,
          remoteApiVerified: false,
          oauthVerified: false,
          storeSigned: false,
          deployed: false,
        } satisfies z.input<typeof androidAuthCancelReceiptSchema>,
        identity,
      );
      await writeFile(resolve(out, "auth-cancel-ui.json"), `${JSON.stringify(proof, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("ACTUAL_ANDROID_ANONYMOUS_CUSTOM_TAB_CANCELLATION_OBSERVED");
    }
    if (directoryInput) {
      capture.disable();
      authPrivacy.enterPublicData();
      phase = "directory-input-boundary";
      const screenshotsSuppressedBeforeNavigation = !capture.allowed;
      if (!screenshotsSuppressedBeforeNavigation || !authPrivacy.entered)
        throw Error("ANDROID_DIRECTORY_BOUNDARY_REQUIRED");
      const result = await observeAndroidDirectoryInput({
        shell,
        deviceSerial: device,
        avdName: avd,
        freshOwnedEmulator: bootCompleted && baseHomeVerified && emulator?.exitCode === null,
        screenshotsSuppressed: screenshotsSuppressedBeforeNavigation,
        captureBoundaryEntered: authPrivacy.entered,
        diagnostic(value) {
          lastDirectoryInputObservation = value;
          phase = `directory-input-${value.stage}`;
        },
      });
      if (metroRequests) throw Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
      phase = "directory-input-proof";
      const baselineBytes = await readFile(resolve(out, "receipt.json")),
        baseline = JSON.parse(baselineBytes.toString()),
        identity = {
          toolingSourceSha: sourceSha,
          binarySourceSha: receipt.sourceSha,
          binary: receipt.artifact,
          verificationSha256: hash(verificationBytes),
          baselineReceiptSha256: hash(baselineBytes),
          device: baseline.device,
        };
      const proof = verifyAndroidDirectoryReceipt(
        {
          version: 1,
          kind: "bundled-android-public-directory-software-search-ui-only",
          ...identity,
          observedAt: new Date().toISOString(),
          applicationId: appId,
          result,
          rawHierarchyExported: false,
          screenshotsSuppressedBeforeNavigation,
          adbCommandOutputPersisted: false,
          rawDumpsysExported: false,
          publicDataNavigation: true,
          profileOpened: false,
          contactOpened: false,
          remoteMutationPerformed: false,
          authenticationNavigation: false,
          privateDataAccess: false,
          httpTransportSeparatelyObserved: false,
          koreanKeyboardVerified: false,
          metroServerStarted: false,
          metroRequests: 0,
          allScreensVerified: false,
          talkBackVerified: false,
          voiceOverVerified: false,
          remoteApiVerified: false,
          oauthVerified: false,
          physicalDeviceVerified: false,
          storeSigned: false,
          deployed: false,
        } satisfies z.input<typeof androidDirectoryReceiptSchema>,
        identity,
      );
      await writeFile(resolve(out, "directory-input.json"), `${JSON.stringify(proof, null, 2)}\n`, {
        flag: "wx",
      });
      console.log("ACTUAL_ANDROID_PUBLIC_DIRECTORY_INPUT_OBSERVED");
    }
    if (publicDirectory) {
      // No screenshots may be taken after this point, including every failure path.
      capture.disable();
      phase = "public-directory-prepare";
      await shell(["settings", "put", "system", "font_scale", "1.0"]);
      await shell(["am", "force-stop", appId]);
      const launch = await shell(["am", "start", "-W", "-n", `${appId}/${appId}.MainActivity`]);
      if (!/^Status:\s*ok\r?$/m.test(launch))
        throw new Error("BUNDLED_HOME_ACTIVITY_LAUNCH_FAILED");
      const width = screenshot.readUInt32BE(16),
        height = screenshot.readUInt32BE(20);
      async function hierarchy() {
        await shell(["rm", "-f", "/sdcard/baro-internal-home.xml"]);
        await shell(["uiautomator", "dump", "--compressed", "/sdcard/baro-internal-home.xml"]);
        return shell(["cat", "/sdcard/baro-internal-home.xml"]);
      }
      await wait(async () => {
        try {
          const observed = bundledAndroidHomeObservation(await hierarchy());
          return observed.titleVisible && !observed.foundationErrorVisible;
        } catch {
          return false;
        }
      }, 120000);
      let target: ReturnType<typeof publicDirectoryButton> = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        target = publicDirectoryButton(await hierarchy(), width, height);
        if (target) break;
        await shell([
          "input",
          "swipe",
          String(Math.floor(width / 2)),
          String(Math.floor(height * 0.8)),
          String(Math.floor(width / 2)),
          String(Math.floor(height * 0.25)),
          "500",
        ]);
      }
      if (!target) throw new Error("BUNDLED_PUBLIC_BUTTON_NOT_FOUND");
      phase = "public-directory-navigation";
      await shell(["input", "tap", String(target.x), String(target.y)]);
      let headingObserved = false,
        scrolls = 0;
      await wait(async () => {
        let current: ReturnType<typeof publicDirectoryUiObservation>;
        try {
          current = publicDirectoryUiObservation(await hierarchy());
        } catch {
          return false;
        }
        lastPublicObservation = current;
        headingObserved ||= current.headingVisible;
        if (current.errorVisible) throw new Error("BUNDLED_PUBLIC_API_UI_ERROR");
        if (current.readyEmpty && current.readyProfileCard)
          throw new Error("BUNDLED_PUBLIC_STATE_AMBIGUOUS");
        if (headingObserved && (current.readyEmpty || current.readyProfileCard)) return true;
        if (!current.loadingVisible && scrolls++ < 4)
          await shell([
            "input",
            "swipe",
            String(Math.floor(width / 2)),
            String(Math.floor(height * 0.8)),
            String(Math.floor(width / 2)),
            String(Math.floor(height * 0.25)),
            "500",
          ]);
        return false;
      }, 120000);
      if (metroRequests !== 0) throw new Error("BUNDLED_HOME_UNEXPECTED_METRO_REQUEST");
      await writeFile(
        resolve(out, "public-directory.json"),
        `${JSON.stringify(
          {
            version: 1,
            kind: "bundled-android-public-directory-ui-only",
            toolingSourceSha: sourceSha,
            binarySourceSha: receipt.sourceSha,
            observedAt: new Date().toISOString(),
            applicationId: appId,
            binary: receipt.artifact,
            apiOrigin: receipt.apiOrigin,
            apiHealthObservation: receipt.apiObservation,
            publicDirectoryUiObserved: true,
            headingObserved,
            state: lastPublicObservation,
            readOnly: true,
            searchSubmitted: false,
            retryInvoked: false,
            profileDetailOpened: false,
            screenshotsSuppressedBeforeNavigation: true,
            profileValuesRecorded: false,
            httpTransportSeparatelyObserved: false,
            metroServerStarted: false,
            metroRequests,
            authenticatedJourneysVerified: false,
            oauthVerified: false,
            physicalDeviceVerified: false,
            storeSigned: false,
            deployed: false,
          },
          null,
          2,
        )}\n`,
        { flag: "wx" },
      );
      console.log("ACTUAL_PUBLIC_DIRECTORY_UI_OBSERVED_NO_PROFILE_VALUES_RECORDED");
    }
  } catch (error) {
    if (phase === "guide-ui-proof") receiptValidationFields = androidGuideUiValidationFields(error);
    const known = new Set([
        "BUNDLED_HOME_HIERARCHY_REQUIRED",
        "BUNDLED_HOME_VERIFIED_SOURCE_REQUIRED",
        "BUNDLED_HOME_APK_BYTES_CHANGED",
        "BUNDLED_HOME_CHECKOUT_MISMATCH",
        "BUNDLED_HOME_EXISTING_DEVICE_REFUSED",
        "BUNDLED_HOME_ADB_REVERSE_REFUSED",
        "BUNDLED_HOME_EMULATOR_EXITED",
        "BUNDLED_HOME_WAIT_EXPIRED",
        "BUNDLED_HOME_ACTIVITY_LAUNCH_FAILED",
        "BUNDLED_HOME_PROCESS_REQUIRED",
        "BUNDLED_HOME_SCREENSHOT_REQUIRED",
        "BUNDLED_HOME_UNEXPECTED_METRO_REQUEST",
        "BUNDLED_HOME_COMMAND_FAILED",
        "BUNDLED_HOME_FONT_SCALE_MISMATCH",
        "BUNDLED_GUIDE_FEATURE_COPY_NOT_OBSERVED",
        "BUNDLED_GUIDE_SCREENSHOT_GUARD_REQUIRED",
        "BUNDLED_GUIDE_CONTROL_REQUIRED",
        "BUNDLED_GUIDE_CONTROL_NOT_FOUND",
        "BUNDLED_GUIDE_SCROLL_NOT_OBSERVED",
        "BUNDLED_GUIDE_IDENTITY_MISMATCH",
        "BUNDLED_PUBLIC_HIERARCHY_REQUIRED",
        "BUNDLED_PUBLIC_VIEWPORT_REQUIRED",
        "BUNDLED_PUBLIC_BUTTON_NOT_FOUND",
        "BUNDLED_PUBLIC_API_UI_ERROR",
        "BUNDLED_PUBLIC_STATE_AMBIGUOUS",
        "BUNDLED_PUBLIC_SCREENSHOT_FORBIDDEN",
      ]),
      message = error instanceof Error ? error.message : "";
    if (capture.allowed && bootCompleted && emulator?.exitCode === null) {
      const image = await capture.read().catch(() => null);
      if (
        image &&
        image.length >= 24 &&
        Buffer.from(image.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
      )
        await writeFile(resolve(out, "failure.png"), image, { flag: "wx" });
    }
    await writeFile(
      resolve(out, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: sourceSha, phase, code: phase.startsWith("directory-input") ? androidDirectoryFailureCode(error) : phase.startsWith("auth-cancel") ? androidAuthFailureCode(error) : known.has(message) ? message : "BUNDLED_HOME_FAILED", emulatorBootVerified: bootCompleted, lastHomeObservation, lastPublicObservation, lastDirectoryInputObservation, lastGuideObservation, lastAuthObservation, lastChromeFixture, receiptValidationFields, publicScreenshotsSuppressed: !capture.allowed, emulatorStartupIssues: emulatorStartupIssues(await readFile(log, "utf8").catch(() => "")), sdkHomeLaunchVerified: baseHomeVerified, largeFontVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("BUNDLED_HOME_FAILED");
  } finally {
    if (emulator) {
      if (emulator.exitCode === null) {
        await text([adb, "-s", device, "emu", "kill"]).catch(() => {});
        if (emulator.exitCode === null) emulator.kill();
      }
      await emulator.exited;
    }
    guard?.stop(true);
    await rm(resolve(out, "android"), { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("BUNDLED_HOME_FAILED");
    process.exitCode = 1;
  });
