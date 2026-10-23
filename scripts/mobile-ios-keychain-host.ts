import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  type IosReadinessReport,
  iosHostPhaseSchema,
  iosReadinessReportSchema,
} from "../apps/mobile/runtime-probe/ios-keychain-protocol";
import { RUNTIME_ORIGIN } from "../apps/mobile/runtime-probe/protocol";
import { signSimulatorApp, simulatorIdentity } from "./mobile-ios-simulator-signing";
import { verifyPreviewArtifact } from "./mobile-preview-artifact";
import { metroNodeOptions, runtimeDevelopmentUrl } from "./mobile-runtime-host";

export const iosHostBinarySchema = z.strictObject({
  version: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  workflowRunId: z.string().regex(/^\d+$/),
  artifactName: z.string().regex(/^mobile-preview-development-ios-[a-f0-9]{40}$/),
  artifactUrl: z.url(),
  zipName: z.string().regex(/^baro-preview-ios-simulator-[a-f0-9]{40}\.zip$/),
  zipBytes: z.number().int().positive(),
  zipSha256: z.string().regex(/^[a-f0-9]{64}$/),
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const iosNativeInputPaths = [
  "apps/mobile/package.json",
  "apps/mobile/app.config.ts",
  "apps/mobile/config",
  "apps/mobile/assets",
  "apps/mobile/modules",
  "package.json",
  "bun.lock",
  "patches",
];
export async function assertIosNativeInputs(root: string, binarySha: string, targetSha: string) {
  if (![binarySha, targetSha].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
    throw new Error("IOS_HOST_NATIVE_INPUT_REFERENCE_REQUIRED");
  const child = Bun.spawn(
    ["git", "diff", "--exit-code", binarySha, targetSha, "--", ...iosNativeInputPaths],
    { cwd: root, stdout: "ignore", stderr: "ignore" },
  );
  if (await child.exited) throw new Error("IOS_HOST_NATIVE_INPUTS_DIFFER");
}
export async function verifyIosHostBinary(root: string, input: string) {
  const manifest = iosHostBinarySchema.parse(
    JSON.parse(await readFile(resolve(root, "tests/fixtures/ios-host-binary.json"), "utf8")),
  );
  if (
    manifest.artifactUrl.indexOf(
      `https://github.com/creno-va/baro/actions/runs/${manifest.workflowRunId}/artifacts/`,
    ) !== 0 ||
    manifest.artifactName !== `mobile-preview-development-ios-${manifest.sourceSha}` ||
    manifest.zipName !== `baro-preview-ios-simulator-${manifest.sourceSha}.zip`
  )
    throw new Error("IOS_HOST_BINARY_IDENTITY_MISMATCH");
  const receiptBytes = await readFile(resolve(input, "receipt-ios.json"));
  if (createHash("sha256").update(receiptBytes).digest("hex") !== manifest.receiptSha256)
    throw new Error("IOS_HOST_RECEIPT_BYTES_CHANGED");
  const receipt = verifyPreviewArtifact(
    JSON.parse(receiptBytes.toString()),
    manifest.sourceSha,
    "ios",
  );
  if (
    receipt.signing.kind !== "simulator-only" ||
    receipt.signing.codeSignature !== "ad-hoc" ||
    receipt.artifact.bytes !== manifest.zipBytes ||
    receipt.artifact.sha256 !== manifest.zipSha256
  )
    throw new Error("IOS_HOST_BINARY_IDENTITY_MISMATCH");
  const zip = resolve(input, manifest.zipName),
    body = await Bun.file(zip).arrayBuffer();
  if (
    body.byteLength !== manifest.zipBytes ||
    createHash("sha256").update(new Uint8Array(body)).digest("hex") !== manifest.zipSha256
  )
    throw new Error("IOS_HOST_BINARY_BYTES_CHANGED");
  return { manifest, receipt, zip };
}
export function iosHostCommandFailure(stderr: string, timedOut: boolean) {
  if (timedOut) return "COMMAND_TIMEOUT" as const;
  if (
    /ApplicationVerificationFailed|Failed to verify code signature|0xe80080|valid provisioning profile|SIGNATURE_REJECTED/i.test(
      stderr,
    )
  )
    return "SIGNATURE_REJECTED" as const;
  if (/FBSOpenApplicationService|RBSRequestError|not allowed to launch|LAUNCH_DENIED/i.test(stderr))
    return "LAUNCH_DENIED" as const;
  if (/RUNTIME_IOS_SCHEME_APPROVAL_NOT_CONFIRMED/.test(stderr))
    return "SCHEME_APPROVAL_FAILED" as const;
  if (/RUNTIME_IOS_LAUNCH_FAILED/.test(stderr)) return "LAUNCH_FAILED" as const;
  return "UNKNOWN" as const;
}
export async function preserveIosReadiness(
  directory: string,
  value: unknown,
  sourceSha: string,
  phase: "baseline" | "signed",
) {
  const report = iosReadinessReportSchema.parse(value);
  if (report.sourceSha !== sourceSha || report.phase !== phase)
    throw new Error("IOS_HOST_REPORT_IDENTITY_MISMATCH");
  await writeFile(resolve(directory, `${phase}.json`), `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  return report;
}
async function main() {
  if (process.platform !== "darwin") throw new Error("IOS_HOST_MAC_REQUIRED");
  const sourceSha = process.env.TARGET_SHA;
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) throw new Error("IOS_HOST_IMMUTABLE_SHA_REQUIRED");
  const root = process.cwd(),
    base = resolve(root, ".wrangler/ios-keychain-host"),
    nonce = randomUUID(),
    out = resolve(base, nonce),
    work = resolve(out, "checkout"),
    mobile = resolve(work, "apps/mobile"),
    name = `baro_runtime_${nonce.replaceAll("-", "").slice(0, 12)}`;
  for (const file of ["baseline", "signed", "signing", "receipt", "failure"]) {
    if (await Bun.file(resolve(base, `${file}.json`)).exists())
      throw new Error("IOS_HOST_FRESH_OUTPUT_REQUIRED");
  }
  await mkdir(out, { recursive: true });
  const env = {
    ...process.env,
    CI: "1",
    EXPO_OFFLINE: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA: sourceSha,
    EXPO_PUBLIC_NATIVE_PROBE_NONCE: nonce,
    NODE_OPTIONS: metroNodeOptions(process.env.NODE_OPTIONS),
  };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY)/i.test(key))
      delete (env as Record<string, string | undefined>)[key];
  }
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  let failedCommand: {
    stage: string;
    exitCode: number;
    category: ReturnType<typeof iosHostCommandFailure>;
  } | null = null;
  async function command(
    args: string[],
    options: { cwd?: string; timeout?: number; stage?: string } = {},
  ) {
    const stage = options.stage ?? "HOST_COMMAND";
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(stage)) throw new Error("IOS_HOST_COMMAND_STAGE_REQUIRED");
    failedCommand = null;
    const child = Bun.spawn(args, {
      cwd: options.cwd ?? root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    children.add(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeout ?? 120000);
    try {
      const [result, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const exitCode = await child.exited;
      if (timedOut || exitCode !== 0) {
        failedCommand = { stage, exitCode, category: iosHostCommandFailure(stderr, timedOut) };
        throw new Error(`IOS_HOST_${stage}_FAILED`);
      }
      return result.trim();
    } finally {
      clearTimeout(timer);
      children.delete(child);
    }
  }
  let phase = "input",
    device = "",
    ownedCheckout = false,
    metro: ReturnType<typeof Bun.spawn> | undefined,
    activePhase: "baseline" | "signed" = "baseline";
  const reports: Partial<Record<"baseline" | "signed", IosReadinessReport>> = {};
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 8765,
    maxRequestBodySize: 8192,
    fetch: async (request) => {
      if (
        new URL(request.url).origin !== RUNTIME_ORIGIN ||
        new URL(request.url).pathname !== "/ios-host" ||
        request.headers.get("x-baro-probe-run") !== nonce
      )
        return new Response(null, { status: 403 });
      if (request.method === "GET") return Response.json(activePhase);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      try {
        const report = iosReadinessReportSchema.parse(await request.json());
        if (report.sourceSha !== sourceSha || report.phase !== activePhase)
          return new Response(null, { status: 400 });
        reports[activePhase] = await preserveIosReadiness(
          base,
          report,
          sourceSha as string,
          activePhase,
        );
        return Response.json({ ok: true });
      } catch {
        return new Response(null, { status: 400 });
      }
    },
  });
  async function wait(check: () => Promise<boolean>, milliseconds: number) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      if (await check()) return;
      await Bun.sleep(500);
    }
    throw new Error("IOS_HOST_WAIT_EXPIRED");
  }
  try {
    if ((await command(["git", "rev-parse", "HEAD"])) !== sourceSha)
      throw new Error("IOS_HOST_CHECKOUT_MISMATCH");
    await command(["git", "diff", "--exit-code", "HEAD"]);
    const binary = await verifyIosHostBinary(root, resolve(root, ".wrangler/ios-keychain-input"));
    await assertIosNativeInputs(root, binary.manifest.sourceSha, sourceSha as string);
    await command(["git", "worktree", "add", "--detach", work, sourceSha as string]);
    ownedCheckout = true;
    await symlink(resolve(root, "node_modules"), resolve(work, "node_modules"), "dir");
    const aliases = Object.fromEntries(
      ["contracts", "api-client", "client-core", "design-tokens"].map((part) => [
        `@baro/${part}`,
        resolve(work, part === "contracts" ? "src/contracts" : `packages/${part}`),
      ]),
    );
    await writeFile(
      resolve(mobile, "metro.config.cjs"),
      `const {getDefaultConfig}=require('expo/metro-config');const config=getDefaultConfig(__dirname);config.watchFolders=[${JSON.stringify(root)}];config.resolver.extraNodeModules=${JSON.stringify(aliases)};module.exports=config;\n`,
    );
    const mobilePackage = JSON.parse(await readFile(resolve(mobile, "package.json"), "utf8"));
    mobilePackage.main = "./runtime-probe/ios-keychain-entry.tsx";
    await writeFile(resolve(mobile, "package.json"), JSON.stringify(mobilePackage));
    const appDirectory = resolve(out, "app");
    await mkdir(appDirectory);
    await command(["ditto", "-x", "-k", binary.zip, appDirectory]);
    const apps = (await readdir(appDirectory)).filter((file) => file.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw new Error("IOS_HOST_APP_AMBIGUOUS");
    const app = resolve(appDirectory, apps[0]);
    simulatorIdentity(
      JSON.parse(
        await command(["plutil", "-convert", "json", "-o", "-", resolve(app, "Info.plist")]),
      ),
      "site.baro.app.preview",
    );
    phase = "metro";
    const reservation = Bun.serve({
      hostname: "127.0.0.1",
      port: 8081,
      fetch: () => new Response(null),
    });
    reservation.stop(true);
    const log = Bun.file(resolve(out, "private-metro.log"));
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
      { cwd: mobile, env, stdout: log, stderr: log },
    );
    children.add(metro);
    await wait(async () => {
      if (metro?.exitCode !== null) throw new Error("IOS_HOST_METRO_EXITED");
      try {
        return (await (await fetch("http://127.0.0.1:8081/status")).text()).includes(
          "packager-status:running",
        );
      } catch {
        return false;
      }
    }, 120000);
    phase = "owned-device";
    const runtimes = JSON.parse(await command(["xcrun", "simctl", "list", "runtimes", "--json"]))
      .runtimes as { identifier: string; version: string; isAvailable: boolean }[];
    const runtime = runtimes.filter((r) => r.isAvailable && r.identifier.includes(".iOS-")).at(-1);
    const types = JSON.parse(await command(["xcrun", "simctl", "list", "devicetypes", "--json"]))
      .devicetypes as { identifier: string; name: string }[];
    const type =
      types.find((t) => t.name === "iPhone 16") ??
      types.filter((t) => t.name.startsWith("iPhone")).at(-1);
    if (!runtime || !type) throw new Error("IOS_HOST_RUNTIME_REQUIRED");
    device = await command([
      "xcrun",
      "simctl",
      "create",
      name,
      type.identifier,
      runtime.identifier,
    ]);
    await command(["xcrun", "simctl", "boot", device]);
    await command(["xcrun", "simctl", "bootstatus", device, "-b"], { timeout: 240000 });
    async function launch() {
      phase = `${activePhase}-stop`;
      console.log("IOS_HOST_STAGE", phase);
      await command(["xcrun", "simctl", "terminate", device, "site.baro.app.preview"], {
        stage: "APP_STOP",
        timeout: 15000,
      }).catch(() => {
        failedCommand = null;
      });
      phase = `${activePhase}-install`;
      console.log("IOS_HOST_STAGE", phase);
      await command(["xcrun", "simctl", "install", device, app], { stage: "APP_INSTALL" });
      const url = runtimeDevelopmentUrl().replace("baro-dev:", "baro-preview:");
      phase = `${activePhase}-launch`;
      console.log("IOS_HOST_STAGE", phase);
      await command(
        [
          "node",
          resolve(root, "scripts/mobile-runtime-ios-launch.cjs"),
          "--open",
          device,
          name,
          url,
        ],
        { stage: "APP_LAUNCH" },
      );
      phase = `${activePhase}-sdk-result`;
      console.log("IOS_HOST_STAGE", phase);
      await wait(async () => !!reports[activePhase], 180000);
    }
    phase = "baseline";
    await launch();
    phase = "signing";
    console.log("IOS_HOST_STAGE", phase);
    await command(["xcrun", "simctl", "terminate", device, "site.baro.app.preview"], {
      stage: "APP_STOP",
      timeout: 15000,
    }).catch(() => {
      failedCommand = null;
    });
    const signing = await signSimulatorApp(app, "site.baro.app.preview");
    await writeFile(resolve(base, "signing.json"), `${JSON.stringify(signing, null, 2)}\n`);
    activePhase = iosHostPhaseSchema.parse("signed");
    phase = "signed";
    await launch();
    const baseline = iosReadinessReportSchema.parse(reports.baseline),
      signed = iosReadinessReportSchema.parse(reports.signed);
    const improvedStages = signed.operations
      .filter((op, index) => op.ok && !baseline.operations[index]?.ok)
      .map((op) => op.stage);
    await writeFile(
      resolve(base, "receipt.json"),
      `${JSON.stringify({ version: 1, kind: "simulator-sdk-readiness-before-after", toolingSourceSha: sourceSha, binarySourceSha: binary.manifest.sourceSha, binaryArtifact: binary.manifest, appId: "site.baro.app.preview", nativeInputsMatch: true, originalZipPreserved: true, device: { model: type.name, osVersion: runtime.version }, baseline, signed, signing, improvedStages, entitlementRootCauseProven: false, fullNativeIoVerified: false, productJourneysVerified: false, remoteApiVerified: false, oauthVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
    );
    if (!signed.allSucceeded) throw new Error("IOS_HOST_SIGNED_READINESS_FAILED");
    console.log(
      "Owned Simulator SDK readiness observed before/after local ad-hoc keychain entitlements; full IO/OAuth/physical/store acceptance remains separate",
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "IOS_HOST_CHECK_FAILED";
    await writeFile(
      resolve(base, "failure.json"),
      `${JSON.stringify({ sourceSha, phase, code, failedCommand, baselineObserved: !!reports.baseline, signedObserved: !!reports.signed, remoteApiVerified: false, oauthVerified: false, physicalDeviceVerified: false, storeSigned: false }, null, 2)}\n`,
    );
    throw new Error(code);
  } finally {
    server.stop(true);
    if (metro) {
      metro.kill();
      await metro.exited;
      children.delete(metro);
    }
    if (device) {
      await command(["xcrun", "simctl", "shutdown", device]).catch(() => {});
      await command(["xcrun", "simctl", "delete", device]).catch(() => {});
    }
    for (const child of children) child.kill();
    if (ownedCheckout)
      await command(["git", "worktree", "remove", "--force", work]).catch(() => {});
  }
}
if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "IOS_HOST_CHECK_FAILED",
    );
    process.exitCode = 1;
  });
