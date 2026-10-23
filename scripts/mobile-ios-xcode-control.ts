import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { simulatorIdentity } from "./mobile-ios-simulator-signing";
import { simulatorSignature, verifyPreviewArtifact } from "./mobile-preview-artifact";

export const xcodeSimulatorControlArguments = [
  "CODE_SIGNING_ALLOWED=YES",
  "CODE_SIGN_IDENTITY=-",
  "AD_HOC_CODE_SIGNING_ALLOWED=YES",
  "CODE_SIGN_INJECT_BASE_ENTITLEMENTS=YES",
  "CODE_SIGN_STYLE=Manual",
  "DEVELOPMENT_TEAM=",
  "PROVISIONING_PROFILE_SPECIFIER=",
];
export function xcodeControlEnvironment(input: Record<string, string | undefined>) {
  if (input.GITHUB_ACTIONS !== "true") throw new Error("XCODE_CONTROL_FRESH_CI_CHECKOUT_REQUIRED");
  if (
    input.EXPO_PUBLIC_APP_ENV !== "preview" ||
    input.EXPO_PUBLIC_API_URL !== "https://preview.baro.site" ||
    !/^[a-f0-9]{40}$/.test(input.TARGET_SHA ?? "")
  )
    throw new Error("XCODE_CONTROL_EXPLICIT_PREVIEW_SHA_REQUIRED");
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "SHELL",
    "GEM_HOME",
    "GEM_PATH",
    "RBENV_ROOT",
    "DEVELOPER_DIR",
  ];
  return {
    ...Object.fromEntries(names.filter((k) => input[k] !== undefined).map((k) => [k, input[k]])),
    TARGET_SHA: input.TARGET_SHA,
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_DOTENV: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
  };
}
export const xcodeControlEntitlementsSchema = z.strictObject({
  "keychain-access-groups": z.tuple([z.literal("site.baro.app.preview")]),
  "application-identifier": z.literal("site.baro.app.preview").optional(),
  "com.apple.application-identifier": z.literal("site.baro.app.preview").optional(),
  "get-task-allow": z.boolean().optional(),
  "com.apple.security.get-task-allow": z.boolean().optional(),
});
export function xcodeControlEntitlements(value: unknown) {
  const result = xcodeControlEntitlementsSchema.safeParse(value);
  if (!result.success) throw new Error("XCODE_CONTROL_ENTITLEMENTS_MISMATCH");
  return result.data;
}
async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 120000);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (await child.exited) throw new Error("XCODE_CONTROL_METADATA_TOOL_FAILED");
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}
const sha256 = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
export async function configureGeneratedXcodeControl(ios: string, projectName: string) {
  if (process.platform !== "darwin" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(projectName))
    throw new Error("XCODE_CONTROL_OWNED_SIMULATOR_PROJECT_REQUIRED");
  const path = resolve(ios, projectName, `${projectName}.entitlements`),
    metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("XCODE_CONTROL_REGULAR_GENERATED_FILE_REQUIRED");
  if (
    !z
      .strictObject({})
      .safeParse(
        JSON.parse(
          (await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", path])).stdout,
        ),
      ).success
  )
    throw new Error("XCODE_CONTROL_GENERATED_CAPABILITIES_CHANGED");
  await writeFile(
    path,
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)</string></array></dict></plist>\n',
  );
}
export const xcodeControlReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("xcode-simulator-signing-control"),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  observedAt: z.iso.datetime(),
  applicationId: z.literal("site.baro.app.preview"),
  signature: z.literal("ad-hoc"),
  teamIdentifier: z.literal("not set"),
  architectures: z.array(z.enum(["arm64", "x86_64"])).min(1),
  entitlements: xcodeControlEntitlementsSchema,
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
  infoPlistSha256: z.string().regex(/^[a-f0-9]{64}$/),
  appRuntimeVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export async function attestXcodeSimulatorControl(root: string, sourceSha: string) {
  const products = resolve(root, ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator"),
    apps = (await readdir(products)).filter((p) => p.endsWith(".app"));
  if (apps.length !== 1 || !apps[0]) throw new Error("XCODE_CONTROL_APP_AMBIGUOUS");
  const app = resolve(products, apps[0]),
    infoPath = resolve(app, "Info.plist"),
    info = simulatorIdentity(
      JSON.parse(
        (await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", infoPath])).stdout,
      ),
      "site.baro.app.preview",
    );
  await command(["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", app]);
  const signature = await command(["/usr/bin/codesign", "-d", "--verbose=2", app]);
  if (simulatorSignature(0, signature.stderr) !== "ad-hoc")
    throw new Error("XCODE_CONTROL_ADHOC_REQUIRED");
  const executable = resolve(app, info.CFBundleExecutable),
    architectures = (await command(["/usr/bin/lipo", "-archs", executable])).stdout
      .trim()
      .split(/\s+/);
  let entitlements: unknown;
  for (const arch of architectures) {
    if (!["arm64", "x86_64"].includes(arch))
      throw new Error("XCODE_CONTROL_SIMULATOR_ARCH_REQUIRED");
    const file = resolve(root, `.wrangler/mobile-build/xcode-entitlements-${arch}.xml`);
    const output = await command([
      "/usr/bin/codesign",
      "-d",
      "--arch",
      arch,
      "--entitlements",
      "-",
      "--xml",
      app,
    ]);
    await writeFile(file, output.stdout, { flag: "wx" });
    const parsed = xcodeControlEntitlements(
      JSON.parse((await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", file])).stdout),
    );
    if (entitlements && JSON.stringify(entitlements) !== JSON.stringify(parsed))
      throw new Error("XCODE_CONTROL_ARCH_ENTITLEMENTS_DIFFER");
    entitlements = parsed;
  }
  const receipt = xcodeControlReceiptSchema.parse({
    version: 1,
    kind: "xcode-simulator-signing-control",
    sourceSha,
    observedAt: new Date().toISOString(),
    applicationId: info.CFBundleIdentifier,
    signature: "ad-hoc",
    teamIdentifier: "not set",
    architectures,
    entitlements,
    executableSha256: sha256(await readFile(executable)),
    infoPlistSha256: sha256(await readFile(infoPath)),
    appRuntimeVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  });
  await writeFile(
    resolve(root, ".wrangler/mobile-build/xcode-control-ios.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  return receipt;
}
export async function verifyFreshXcodeControlBinary(root: string, sourceSha: string) {
  const input = resolve(root, ".wrangler/mobile-handoff"),
    receiptBytes = await readFile(resolve(input, "receipt-ios.json")),
    receipt = verifyPreviewArtifact(JSON.parse(receiptBytes.toString()), sourceSha, "ios");
  const control = xcodeControlReceiptSchema.parse(
    JSON.parse(
      await readFile(resolve(root, ".wrangler/mobile-build/xcode-control-ios.json"), "utf8"),
    ),
  );
  xcodeControlEntitlements(control.entitlements);
  if (
    control.sourceSha !== sourceSha ||
    receipt.signing.kind !== "simulator-only" ||
    receipt.signing.codeSignature !== "ad-hoc"
  )
    throw new Error("XCODE_CONTROL_SOURCE_OR_SIGNATURE_MISMATCH");
  const zip = resolve(input, receipt.artifact.name),
    bytes = new Uint8Array(await Bun.file(zip).arrayBuffer());
  if (bytes.byteLength !== receipt.artifact.bytes || sha256(bytes) !== receipt.artifact.sha256)
    throw new Error("XCODE_CONTROL_ARCHIVE_BYTES_MISMATCH");
  return {
    receipt,
    zip,
    manifest: {
      kind: "fresh-current-source-xcode-control",
      sourceSha,
      zipName: receipt.artifact.name,
      zipBytes: bytes.byteLength,
      zipSha256: receipt.artifact.sha256,
      receiptSha256: sha256(receiptBytes),
      control,
    },
  };
}
