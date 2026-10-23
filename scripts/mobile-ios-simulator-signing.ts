import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";
import { simulatorSignature } from "./mobile-preview-artifact";

export const simulatorAppIdSchema = z.enum(["site.baro.app.dev", "site.baro.app.preview"]);
export const simulatorSigningProfileSchema = z.enum(["app-and-group", "group-only"]);
type SimulatorSigningProfile = z.infer<typeof simulatorSigningProfileSchema>;
export function simulatorIdentity(value: unknown, expected: string) {
  const info = z
    .object({
      CFBundleIdentifier: simulatorAppIdSchema,
      CFBundleSupportedPlatforms: z.tuple([z.literal("iPhoneSimulator")]),
      DTPlatformName: z.literal("iphonesimulator"),
      CFBundleExecutable: z.string().min(1),
    })
    .parse(value);
  if (
    info.CFBundleIdentifier !== expected ||
    basename(info.CFBundleExecutable) !== info.CFBundleExecutable ||
    [".", ".."].includes(info.CFBundleExecutable)
  )
    throw new Error("IOS_SIMULATOR_IDENTITY_REQUIRED");
  return info;
}
export function simulatorEntitlements(
  appId: string,
  profile: SimulatorSigningProfile = "app-and-group",
) {
  const identifier = simulatorAppIdSchema.parse(appId);
  if (simulatorSigningProfileSchema.parse(profile) === "group-only")
    return { "keychain-access-groups": [identifier] as [typeof identifier] };
  return {
    "application-identifier": identifier,
    "keychain-access-groups": [identifier] as [typeof identifier],
  };
}
export function verifySimulatorEntitlements(
  value: unknown,
  appId: string,
  profile: SimulatorSigningProfile = "app-and-group",
) {
  const identifier = simulatorAppIdSchema.parse(appId);
  if (simulatorSigningProfileSchema.parse(profile) === "group-only")
    return z
      .strictObject({ "keychain-access-groups": z.tuple([z.literal(identifier)]) })
      .parse(value);
  const result = z
    .strictObject({
      "application-identifier": z.literal(identifier),
      "keychain-access-groups": z.tuple([z.literal(identifier)]),
    })
    .parse(value);
  return result;
}
export function simulatorEntitlementPlist(
  appId: string,
  profile: SimulatorSigningProfile = "app-and-group",
) {
  const identifier = simulatorAppIdSchema.parse(appId);
  const application =
    simulatorSigningProfileSchema.parse(profile) === "app-and-group"
      ? `<key>application-identifier</key><string>${identifier}</string>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${application}<key>keychain-access-groups</key><array><string>${identifier}</string></array></dict></plist>\n`;
}
async function command(args: string[], input?: string, stage = "COMMAND") {
  const child = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new Blob([input]),
  });
  const timer = setTimeout(() => child.kill(), 120000);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (await child.exited) throw new Error(`IOS_SIMULATOR_${stage}_FAILED`);
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Only an owned copy of a compiled iPhoneSimulator app; no Apple identity/private key is used. */
export async function signSimulatorApp(
  app: string,
  expectedId: string,
  profile: SimulatorSigningProfile = "app-and-group",
) {
  simulatorSigningProfileSchema.parse(profile);
  if (process.platform !== "darwin") throw new Error("IOS_SIMULATOR_MAC_REQUIRED");
  const metadata = await lstat(app);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !app.endsWith(".app"))
    throw new Error("IOS_SIMULATOR_OWNED_APP_REQUIRED");
  const plistPath = resolve(app, "Info.plist");
  const plistMetadata = await lstat(plistPath);
  if (!plistMetadata.isFile() || plistMetadata.isSymbolicLink())
    throw new Error("IOS_SIMULATOR_REGULAR_FILE_REQUIRED");
  const beforeInfo = await readFile(plistPath);
  const info = simulatorIdentity(
    JSON.parse(
      (
        await command(
          ["/usr/bin/plutil", "-convert", "json", "-o", "-", plistPath],
          undefined,
          "INFO_READ",
        )
      ).stdout,
    ),
    expectedId,
  );
  const executable = resolve(app, info.CFBundleExecutable),
    executableMetadata = await lstat(executable);
  if (!executableMetadata.isFile() || executableMetadata.isSymbolicLink())
    throw new Error("IOS_SIMULATOR_REGULAR_FILE_REQUIRED");
  const before = hash(await readFile(executable));
  const architectures = (
    await command(["/usr/bin/lipo", "-archs", executable], undefined, "ARCH_READ")
  ).stdout
    .trim()
    .split(/\s+/);
  if (!architectures.length || architectures.some((arch) => !["arm64", "x86_64"].includes(arch)))
    throw new Error("IOS_SIMULATOR_ARCHITECTURE_REQUIRED");
  const entitlementPath = resolve(
    dirname(app),
    `baro-simulator-${info.CFBundleIdentifier}-${profile}.plist`,
  );
  await writeFile(entitlementPath, simulatorEntitlementPlist(info.CFBundleIdentifier, profile), {
    flag: "wx",
  });
  await command([
    "/usr/bin/codesign",
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    "--entitlements",
    entitlementPath,
    "--generate-entitlement-der",
    app,
  ]);
  await command(
    ["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", app],
    undefined,
    "VERIFY",
  );
  const signature = await command(
    ["/usr/bin/codesign", "-d", "--verbose=2", app],
    undefined,
    "SIGNATURE_READ",
  );
  if (simulatorSignature(0, signature.stderr) !== "ad-hoc")
    throw new Error("IOS_SIMULATOR_ADHOC_REQUIRED");
  for (const architecture of architectures) {
    const encoded = (
      await command(
        ["/usr/bin/codesign", "-d", "--arch", architecture, "--entitlements", "-", "--xml", app],
        undefined,
        "ENTITLEMENTS_READ",
      )
    ).stdout;
    const decoded = JSON.parse(
      (
        await command(
          ["/usr/bin/plutil", "-convert", "json", "-o", "-", "-"],
          encoded,
          "ENTITLEMENTS_DECODE",
        )
      ).stdout,
    );
    verifySimulatorEntitlements(decoded, info.CFBundleIdentifier, profile);
  }
  if (!beforeInfo.equals(await readFile(plistPath))) throw new Error("IOS_SIMULATOR_INFO_CHANGED");
  return {
    kind: "local-simulator-ad-hoc-keychain" as const,
    profile,
    applicationId: info.CFBundleIdentifier,
    architectures,
    entitlements: simulatorEntitlements(info.CFBundleIdentifier, profile),
    executableBeforeSha256: before,
    executableAfterSha256: hash(await readFile(executable)),
    infoPlistSha256: hash(beforeInfo),
    everyArchitectureVerified: true as const,
    storeSigned: false as const,
    physicalDeviceVerified: false as const,
  };
}
