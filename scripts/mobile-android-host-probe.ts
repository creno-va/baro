import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  androidBuildTools,
  runAndroidSignatureFixtureProbe,
  runAndroidSignatureProbe,
} from "./mobile-android-signature";
import { createOwnedAndroidAvd, ownedAndroidPaths } from "./mobile-runtime-host";

async function main() {
  const root = process.cwd(),
    sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOST_SDK_REQUIRED");
  const temporary = await mkdtemp(resolve(tmpdir(), "baro-android-host-"));
  const paths = ownedAndroidPaths(temporary),
    avd = `baro_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const env = { ...process.env, ...paths.environment };
  async function command(args: string[], input?: string) {
    const child = Bun.spawn(args, {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "ignore",
      stdin: input === undefined ? "ignore" : new Blob([input]),
    });
    const timer = setTimeout(() => child.kill(), 120000);
    try {
      const output = await new Response(child.stdout).text();
      if (await child.exited) throw new Error("ANDROID_HOST_COMMAND_FAILED");
      return output.trim();
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const sourceSha = await command(["git", "rev-parse", "HEAD"]);
    const tools = await androidBuildTools(sdk);
    await runAndroidSignatureProbe(root, tools.path, (args) => command(args));
    const fixtureRoot = resolve(root, "tests/fixtures/android-signature");
    const fixture = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
      certificateSha256: string;
      files: { name: string; bytes: number; sha256: string; valid: boolean }[];
    };
    let validVerified = false,
      invalidRejected = false;
    for (const file of fixture.files) {
      const path = resolve(fixtureRoot, file.name),
        body = await Bun.file(path).arrayBuffer();
      if (
        body.byteLength !== file.bytes ||
        new Bun.CryptoHasher("sha256").update(body).digest("hex") !== file.sha256
      )
        throw new Error("ANDROID_HOST_FIXTURE_CHANGED");
      if (file.valid) {
        const digest = await runAndroidSignatureFixtureProbe(
          root,
          tools.path,
          (args) => command(args),
          path,
        );
        if (digest !== fixture.certificateSha256)
          throw new Error("ANDROID_HOST_CERTIFICATE_MISMATCH");
        validVerified = true;
      } else {
        try {
          await runAndroidSignatureFixtureProbe(root, tools.path, (args) => command(args), path);
        } catch {
          invalidRejected = true;
        }
      }
    }
    if (!validVerified || !invalidRejected) throw new Error("ANDROID_HOST_FIXTURE_INCOMPLETE");
    await createOwnedAndroidAvd(sdk, temporary, avd, command);
    const out = resolve(root, ".wrangler/android-host");
    await mkdir(out, { recursive: true });
    await writeFile(
      resolve(out, "receipt.json"),
      `${JSON.stringify({ version: 1, kind: "host-preflight-only", sourceSha, buildTools: tools.version, sdkSignatureApiReady: true, syntheticValidApkVerified: true, syntheticInvalidApkRejected: true, ownedAvdDiscovered: true, emulatorBootVerified: false, appRuntimeVerified: false, remoteApiVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
    );
    console.log(
      "Android SDK signature fixtures and owned AVD discovery verified; no emulator boot or BARO runtime acceptance claimed",
    );
  } finally {
    await command([
      resolve(sdk, "cmdline-tools/latest/bin/avdmanager"),
      "delete",
      "avd",
      "-n",
      avd,
    ]).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "ANDROID_HOST_PREFLIGHT_FAILED",
    );
    process.exitCode = 1;
  });
