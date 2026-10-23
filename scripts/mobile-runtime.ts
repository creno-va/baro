import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  probeResultSchema,
  RUNTIME_ORIGIN,
  type RuntimeConfig,
} from "../apps/mobile/runtime-probe/protocol";
import { createRuntimeFixture } from "./mobile-runtime-fixture";
import {
  androidRuntimeOptions,
  emulatorStartupIssues,
  metroNodeOptions,
} from "./mobile-runtime-host";
import { verifyRuntimeReceipt } from "./mobile-runtime-receipt";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export function productEntryOverlay() {
  return `import { useRef } from "react";
import { View } from "react-native";
import OriginalHome from "../runtime-probe/original-home";
export default function ObservedHome() {
  const sent = useRef(false);
  return <View style={{flex:1}} onLayout={({nativeEvent:{layout}}) => {
    if (sent.current) return;
    sent.current = true;
    void fetch("${RUNTIME_ORIGIN}/probe/mounted", {
      method:"POST", headers:{"content-type":"application/json", "x-baro-probe-run":process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE ?? ""},
      body:JSON.stringify({width:layout.width,height:layout.height})
    }).catch(() => {});
  }}><OriginalHome /></View>;
}
`;
}

/** Only a fresh, owned simulator/emulator and an immutable isolated checkout are mutated. */
async function main() {
  const platform = process.argv[2],
    sourceSha = process.env.TARGET_SHA;
  if ((platform !== "android" && platform !== "ios") || !/^[a-f0-9]{40}$/.test(sourceSha ?? ""))
    throw new Error("RUNTIME_PLATFORM_AND_IMMUTABLE_SHA_REQUIRED");
  const root = process.cwd(),
    out = resolve(root, ".wrangler/mobile-runtime"),
    nonce = randomUUID();
  const work = resolve(out, `checkout-${platform}`),
    mobile = resolve(work, "apps/mobile");
  const env = {
    ...process.env,
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_DEV_MENU: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
    EXPO_PUBLIC_APP_ENV: "local",
    EXPO_PUBLIC_API_URL: RUNTIME_ORIGIN,
    EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA: sourceSha,
    EXPO_PUBLIC_NATIVE_PROBE_NONCE: nonce,
  };
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  await mkdir(out, { recursive: true });
  let counter = 0;
  async function command(
    args: string[],
    options: { cwd?: string; input?: string; timeout?: number; compile?: boolean } = {},
  ) {
    const log = Bun.file(resolve(out, `private-command-${platform}-${++counter}.log`));
    const child = Bun.spawn(args, {
      cwd: options.cwd ?? work,
      env,
      stdout: options.compile ? "inherit" : "pipe",
      stderr: options.compile ? "inherit" : log,
      stdin: options.input === undefined ? "ignore" : new Blob([options.input]),
    });
    children.add(child);
    const timer = setTimeout(() => child.kill(), options.timeout ?? 120000);
    try {
      const output = options.compile ? "" : await new Response(child.stdout).text();
      if (await child.exited) throw new Error("RUNTIME_COMMAND_FAILED");
      return output.trim();
    } finally {
      clearTimeout(timer);
      children.delete(child);
    }
  }
  async function waitFor(check: () => Promise<boolean> | boolean, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((done) => setTimeout(done, 1000));
    }
    throw new Error("RUNTIME_WAIT_EXPIRED");
  }
  let metro: ReturnType<typeof Bun.spawn> | undefined;
  let phase = "prepare",
    metroLog = "";
  async function stopMetro() {
    if (metro) {
      metro.kill();
      await metro.exited;
      children.delete(metro);
      metro = undefined;
    }
  }
  async function startMetro() {
    metroLog = resolve(out, `private-metro-${platform}-${++counter}.log`);
    const log = Bun.file(metroLog);
    metro = Bun.spawn(
      [
        "node",
        resolve(root, "node_modules/expo/bin/cli"),
        "start",
        "--dev-client",
        "--localhost",
        "--port",
        "8081",
        "--no-dev",
        "--minify",
        "--clear",
      ],
      {
        cwd: mobile,
        env: { ...env, NODE_OPTIONS: metroNodeOptions(process.env.NODE_OPTIONS) },
        stdout: log,
        stderr: log,
      },
    );
    children.add(metro);
    await waitFor(async () => {
      if (metro?.exitCode !== null) throw new Error("RUNTIME_METRO_EXITED");
      try {
        return (await (await fetch("http://127.0.0.1:8081/status")).text()).includes(
          "packager-status:running",
        );
      } catch {
        return false;
      }
    }, 120000);
  }
  const config: RuntimeConfig = {
    version: 1,
    origin: RUNTIME_ORIGIN,
    sourceSha: sourceSha as string,
    nonce,
  };
  const fixture = createRuntimeFixture(config);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 8765,
    maxRequestBodySize: 100_000_001,
    idleTimeout: 255,
    async fetch(request) {
      try {
        return await fixture.fetch(request);
      } catch {
        return Response.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
      }
    },
    error() {
      return new Response("FIXTURE_FAILED", { status: 500 });
    },
  });
  let device = "",
    ownedCheckout = false,
    emulator: ReturnType<typeof Bun.spawn> | undefined;
  const avd = `baro_runtime_${nonce.replaceAll("-", "").slice(0, 12)}`;
  const android = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "";
  const adb = resolve(android, "platform-tools/adb");
  const sdk = resolve(android, "cmdline-tools/latest/bin/avdmanager");
  const emulatorLog = resolve(out, "private-emulator.log");
  let bootCompleted = false;
  let peakRssBytes = 0,
    memorySamples = 0;
  async function sampleMemory() {
    try {
      let kb = 0;
      if (platform === "android") {
        const mem = await command([
          adb,
          "-s",
          device,
          "shell",
          "dumpsys",
          "meminfo",
          "site.baro.app.dev",
        ]);
        kb = Number(mem.match(/TOTAL RSS:\s*(\d+)/)?.[1] ?? 0);
      } else {
        const rows = await command(["xcrun", "simctl", "spawn", device, "launchctl", "list"]);
        const row = rows
          .split("\n")
          .find((line) => line.includes("UIKitApplication:site.baro.app.dev["));
        const pid = row?.trim().split(/\s+/)[0];
        if (pid && /^\d+$/.test(pid)) kb = Number(await command(["ps", "-o", "rss=", "-p", pid]));
      }
      if (Number.isSafeInteger(kb) && kb > 0) {
        memorySamples++;
        peakRssBytes = Math.max(peakRssBytes, kb * 1024);
      }
    } catch {
      /* Missing samples are not represented as zero usage or fabricated peak. */
    }
  }
  async function openApp() {
    const url = `baro-dev://expo-development-client/?url=${encodeURIComponent("http://127.0.0.1:8081")}`;
    if (platform === "android") {
      await command([adb, "-s", device, "shell", "am", "force-stop", "site.baro.app.dev"]);
      await command([
        adb,
        "-s",
        device,
        "shell",
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        url,
        "site.baro.app.dev",
      ]);
    } else {
      await command(["xcrun", "simctl", "terminate", device, "site.baro.app.dev"]).catch(() => {});
      await command(["xcrun", "simctl", "openurl", device, url]);
    }
  }
  async function screenshot(name: string) {
    const path = resolve(out, `${name}-${platform}.png`);
    if (platform === "android") {
      await command([adb, "-s", device, "shell", "screencap", "-p", "/sdcard/baro-runtime.png"]);
      await command([adb, "-s", device, "pull", "/sdcard/baro-runtime.png", path]);
    } else await command(["xcrun", "simctl", "io", device, "screenshot", path]);
  }
  try {
    if ((await command(["git", "rev-parse", "HEAD"], { cwd: root })) !== sourceSha)
      throw new Error("RUNTIME_CHECKOUT_SHA_MISMATCH");
    await command(["git", "diff", "--exit-code", "HEAD"], { cwd: root });
    await command(["git", "merge-base", "--is-ancestor", sourceSha as string, "origin/main"], {
      cwd: root,
    });
    await command(["git", "worktree", "add", "--detach", work, sourceSha as string], { cwd: root });
    ownedCheckout = true;
    await symlink(resolve(root, "node_modules"), resolve(work, "node_modules"), "dir");
    // Resolve symlinked Bun workspace packages inside this exact isolated checkout.
    const metroSource = `const {getDefaultConfig}=require("expo/metro-config");
const config=getDefaultConfig(__dirname);
config.watchFolders=[${JSON.stringify(root)}];
config.resolver.extraNodeModules={${["contracts", "api-client", "client-core", "design-tokens"].map((name) => `${JSON.stringify(`@baro/${name}`)}:${JSON.stringify(resolve(work, name === "contracts" ? "src/contracts" : `packages/${name}`))}`).join(",")}};
module.exports=config;\n`;
    await writeFile(resolve(mobile, "metro.config.cjs"), metroSource);
    phase = "metro-preflight";
    console.log(`Runtime ${platform}: verify IPv4 Metro readiness before compile`);
    await startMetro();
    await stopMetro();
    console.log(`Runtime ${platform}: compile isolated local development app`);
    phase = "compile";
    await command(["bun", "scripts/mobile-native-build.ts", platform, "--runtime-local"], {
      timeout: 1800000,
      compile: true,
    });
    let osVersion = "",
      deviceModel = "";
    phase = "owned-device";
    if (platform === "android") {
      if (!android) throw new Error("RUNTIME_ANDROID_SDK_REQUIRED");
      const image = "system-images;android-35;google_apis;x86_64";
      await command([sdk, "create", "avd", "-n", avd, "-k", image, "--device", "pixel_6"], {
        input: "no\n",
      });
      const log = Bun.file(emulatorLog);
      emulator = Bun.spawn([resolve(android, "emulator/emulator"), ...androidRuntimeOptions(avd)], {
        env,
        stdout: log,
        stderr: log,
      });
      children.add(emulator);
      device = "emulator-5580";
      await waitFor(async () => {
        if (emulator?.exitCode !== null) throw new Error("RUNTIME_EMULATOR_EXITED");
        try {
          bootCompleted =
            (await command([adb, "-s", device, "shell", "getprop", "sys.boot_completed"], {
              timeout: 5000,
            })) === "1";
          return bootCompleted;
        } catch {
          return false;
        }
      }, 240000);
      await command([adb, "-s", device, "shell", "input", "keyevent", "82"]);
      await command([adb, "-s", device, "reverse", "tcp:8081", "tcp:8081"]);
      await command([adb, "-s", device, "reverse", "tcp:8765", "tcp:8765"]);
      await command([
        adb,
        "-s",
        device,
        "install",
        "-r",
        resolve(mobile, "android/app/build/outputs/apk/debug/app-debug.apk"),
      ]);
      osVersion = await command([
        adb,
        "-s",
        device,
        "shell",
        "getprop",
        "ro.build.version.release",
      ]);
      deviceModel = await command([adb, "-s", device, "shell", "getprop", "ro.product.model"]);
    } else {
      if (process.platform !== "darwin") throw new Error("RUNTIME_XCODE_REQUIRED");
      const runtimes = JSON.parse(
        await command(["xcrun", "simctl", "list", "runtimes", "--json"]),
      ) as { runtimes: { identifier: string; isAvailable: boolean; version: string }[] };
      const runtime = runtimes.runtimes
        .filter((r) => r.isAvailable && r.identifier.includes(".iOS-"))
        .at(-1);
      const types = JSON.parse(
        await command(["xcrun", "simctl", "list", "devicetypes", "--json"]),
      ) as { devicetypes: { identifier: string; name: string }[] };
      const type =
        types.devicetypes.find((t) => t.name === "iPhone 16") ??
        types.devicetypes.filter((t) => t.name.startsWith("iPhone")).at(-1);
      if (!runtime || !type) throw new Error("RUNTIME_IOS_DEVICE_REQUIRED");
      device = await command([
        "xcrun",
        "simctl",
        "create",
        avd,
        type.identifier,
        runtime.identifier,
      ]);
      await command(["xcrun", "simctl", "boot", device]);
      await command(["xcrun", "simctl", "bootstatus", device, "-b"], { timeout: 240000 });
      const products = resolve(
        work,
        ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator",
      );
      const apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
      if (apps.length !== 1 || !apps[0]) throw new Error("RUNTIME_IOS_APP_AMBIGUOUS");
      await command(["xcrun", "simctl", "install", device, resolve(products, apps[0])]);
      osVersion = runtime.version;
      deviceModel = type.name;
    }
    const home = await readFile(resolve(mobile, "src/app/index.tsx"), "utf8"),
      overlay = productEntryOverlay();
    await mkdir(resolve(mobile, "src/runtime-probe"));
    await writeFile(resolve(mobile, "src/runtime-probe/original-home.tsx"), home);
    await writeFile(resolve(mobile, "src/app/index.tsx"), overlay);
    console.log(`Runtime ${platform}: mount instrumented product home`);
    phase = "product-metro";
    await startMetro();
    phase = "product-home-layout";
    await openApp();
    await waitFor(async () => {
      await sampleMemory();
      return fixture.state.productMount !== null;
    }, 180000);
    await screenshot("product-home");
    await stopMetro();
    const manifestPath = resolve(mobile, "package.json"),
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.main !== "expo-router/entry") throw new Error("RUNTIME_PRODUCT_ENTRY_CHANGED");
    manifest.main = "./runtime-probe/entry.tsx";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Runtime ${platform}: execute real native module and SDK IO`);
    phase = "probe-metro";
    await startMetro();
    phase = "native-probe";
    await openApp();
    await waitFor(async () => {
      if (fixture.state.failure) throw new Error(fixture.state.failure.code);
      await sampleMemory();
      return fixture.state.result !== null;
    }, 600000);
    await screenshot("native-probe");
    const result = probeResultSchema.parse(fixture.state.result);
    if (result.platform !== platform || !memorySamples || fixture.state.rejectedHeaders)
      throw new Error("RUNTIME_EVIDENCE_INCOMPLETE");
    const assets = JSON.parse(
      await readFile(resolve(work, `.wrangler/mobile-build/assets-${platform}.json`), "utf8"),
    );
    const receipt = {
      version: 1,
      kind: "local-development-runtime",
      sourceSha,
      platform,
      environment: "local",
      apiOrigin: RUNTIME_ORIGIN,
      applicationId: "site.baro.app.dev",
      device: {
        kind: platform === "android" ? "emulator" : "simulator",
        model: deviceModel,
        osVersion,
      },
      productEntry: {
        kind: "instrumented-home-layout-only",
        originalSha256: sha256(home),
        overlaySha256: sha256(overlay),
        layout: fixture.state.productMount,
        screenshot: `product-home-${platform}.png`,
      },
      probeEntry: {
        kind: "alternate-entry-real-native-sdk",
        path: "apps/mobile/runtime-probe/entry.tsx",
        sha256: sha256(await readFile(resolve(mobile, "runtime-probe/entry.tsx"), "utf8")),
      },
      metroOverlaySha256: sha256(metroSource),
      assets,
      result,
      transport: {
        requestCount: fixture.state.requestCount,
        rejectedHeaders: fixture.state.rejectedHeaders,
        upload: fixture.state.upload,
        downloadedBytes: fixture.state.downloadedBytes,
        delayedStarted: fixture.state.delayedStarted,
        cancelUploadStarted: fixture.state.cancelUploadStarted,
        cancelUploadBytes: fixture.state.cancelUploadBytes,
      },
      memory: {
        metric: "sampled-process-rss",
        peakObservedBytes: peakRssBytes,
        samples: memorySamples,
        wholeRunPeakProven: false,
        jsHeapLimitProven: false,
      },
      productJourneysVerified: false,
      accessibilityVerified: false,
      storeSigned: false,
      deployed: false,
    };
    await writeFile(
      resolve(out, `receipt-${platform}.json`),
      `${JSON.stringify(verifyRuntimeReceipt(receipt, config.sourceSha, platform), null, 2)}\n`,
    );
    console.log(
      `Runtime ${platform}: validated native IO receipt; remote API/OAuth/physical device/store acceptance remain open`,
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "RUNTIME_VERIFICATION_FAILED";
    const log = metroLog ? await readFile(metroLog, "utf8").catch(() => "") : "";
    const unresolvedModule =
      log.match(/Unable to resolve module\s+([A-Za-z0-9_@/.-]{1,180})\s+from/)?.[1] ?? null;
    const host =
      platform === "android"
        ? {
            emulatorExitCode: emulator?.exitCode ?? null,
            bootCompleted,
            emulatorStartupIssues: emulatorStartupIssues(
              await readFile(emulatorLog, "utf8").catch(() => ""),
            ),
          }
        : null;
    await writeFile(
      resolve(out, `failure-${platform}.json`),
      `${JSON.stringify({ sourceSha, platform, phase, code, unresolvedModule, host, productLayoutObserved: !!fixture.state.productMount, nativeResultObserved: !!fixture.state.result, remoteApiVerified: false, oauthVerified: false }, null, 2)}\n`,
    );
    throw error;
  } finally {
    fixture.release();
    server.stop(true);
    await stopMetro();
    if (device && platform === "ios") {
      await command(["xcrun", "simctl", "shutdown", device]).catch(() => {});
      await command(["xcrun", "simctl", "delete", device]).catch(() => {});
    }
    if (emulator) {
      if (emulator.exitCode === null) emulator.kill();
      await emulator.exited;
      children.delete(emulator);
    }
    if (platform === "android" && android)
      await command([sdk, "delete", "avd", "-n", avd]).catch(() => {});
    for (const child of children) child.kill();
    if (ownedCheckout)
      await command(["git", "worktree", "remove", "--force", work], { cwd: root }).catch(() => {});
  }
}
if (import.meta.main)
  await main().catch((error: unknown) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "RUNTIME_VERIFICATION_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
