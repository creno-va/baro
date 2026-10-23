import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyInternalAndroidArtifact } from "./mobile-internal-android-artifact";
import { internalAndroidEnvironment } from "./mobile-internal-android-build";
import { androidReverificationSchema } from "./mobile-internal-android-reverify";
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
  const largeFont = process.argv[2] === "--large-font";
  if (process.argv.length !== (largeFont ? 3 : 2)) throw new Error("BUNDLED_HOME_MODE_REQUIRED");
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
  for (const name of ["receipt.json", "failure.json", "home.png"])
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
    lastHomeObservation: ReturnType<typeof bundledAndroidHomeObservation> | null = null;
  async function bytes(args: string[], input?: string) {
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
  const shell = (args: string[]) => text([adb, "-s", device, "shell", ...args]);
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
      verification = androidReverificationSchema.parse(JSON.parse(verificationBytes.toString()));
    if (
      verification.kind !== "reverified-preserved-android-binary" ||
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
        const png = await bytes([adb, "-s", device, "exec-out", "screencap", "-p"]);
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
      const png = await bytes([adb, "-s", device, "exec-out", "screencap", "-p"]);
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
  } catch (error) {
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
      ]),
      message = error instanceof Error ? error.message : "";
    if (bootCompleted && emulator?.exitCode === null) {
      const image = await bytes([adb, "-s", device, "exec-out", "screencap", "-p"]).catch(
        () => null,
      );
      if (
        image &&
        image.length >= 24 &&
        Buffer.from(image.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
      )
        await writeFile(resolve(out, "failure.png"), image, { flag: "wx" });
    }
    await writeFile(
      resolve(out, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: sourceSha, phase, code: known.has(message) ? message : "BUNDLED_HOME_FAILED", emulatorBootVerified: bootCompleted, lastHomeObservation, emulatorStartupIssues: emulatorStartupIssues(await readFile(log, "utf8").catch(() => "")), sdkHomeLaunchVerified: baseHomeVerified, largeFontVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
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
