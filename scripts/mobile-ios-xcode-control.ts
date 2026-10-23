import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { simulatorIdentity } from "./mobile-ios-simulator-signing";
import { simulatorSignature, verifyPreviewArtifact } from "./mobile-preview-artifact";

export function xcodeControlBuildFailure(error: unknown, detail = "") {
  const message = error instanceof Error ? error.message : "";
  const known = new Set([
    "XCODE_CONTROL_GENERATED_CAPABILITIES_CHANGED",
    "XCODE_CONTROL_REGULAR_GENERATED_FILE_REQUIRED",
    "XCODE_CONTROL_ENTITLEMENTS_MISMATCH",
    "XCODE_CONTROL_METADATA_TOOL_FAILED",
    "XCODE_CONTROL_APP_AMBIGUOUS",
    "XCODE_CONTROL_ADHOC_REQUIRED",
    "XCODE_CONTROL_SIMULATOR_ARCH_REQUIRED",
    "XCODE_CONTROL_ARCH_ENTITLEMENTS_DIFFER",
    "XCODE_CONTROL_CHECKOUT_MISMATCH",
    "XCODE_CONTROL_FRESH_OUTPUT_REQUIRED",
    "COMPILED_FONT_BYTES_OR_LICENSE_CHANGED",
    "COMPILED_FONT_READ_FAILED",
    "IOS_FONT_DECLARATION_MISSING",
    "IOS_COMPILED_APP_MISSING",
    "XCODE_CONTROL_TEAM_REQUIRED",
    "XCODE_CONTROL_PROFILE_REQUIRED",
    "XCODE_CONTROL_IDENTITY_REQUIRED",
    "XCODE_CONTROL_LINK_FAILED",
    "XCODE_CONTROL_SCRIPT_FAILED",
    "XCODE_CONTROL_COMPILE_FAILED",
    "XCODE_CONTROL_SIGN_FAILED",
    "IOS_SIMULATOR_IDENTITY_REQUIRED",
    "PREVIEW_SIMULATOR_DISTRIBUTION_IDENTITY_UNEXPECTED",
    "XCODE_CONTROL_HOST_ENTITLEMENTS_MISMATCH",
    "XCODE_CONTROL_MACHO_SIMULATOR_REQUIRED",
    "XCODE_CONTROL_SIMULATOR_SECTIONS_REQUIRED",
    "XCODE_CONTROL_XML_DER_DIFFER",
  ]);
  if (known.has(message)) return message;
  for (const [code, pattern] of [
    ["XCODE_CONTROL_TEAM_REQUIRED", /requires a development team/i],
    ["XCODE_CONTROL_PROFILE_REQUIRED", /error:.*provisioning profile/i],
    ["XCODE_CONTROL_IDENTITY_REQUIRED", /error:.*signing certificate|No signing certificate/i],
    [
      "XCODE_CONTROL_LINK_FAILED",
      /Undefined symbols for architecture|ld:.*(?:error|not found)|linker command failed/i,
    ],
    [
      "XCODE_CONTROL_SCRIPT_FAILED",
      /PhaseScriptExecution .* failed|Command PhaseScriptExecution failed/i,
    ],
    [
      "XCODE_CONTROL_COMPILE_FAILED",
      /error:.*(?:file not found|could not build module|cannot find|no such module)/i,
    ],
    ["XCODE_CONTROL_SIGN_FAILED", /Command CodeSign failed|code object is not signed at all/i],
  ] as const)
    if (pattern.test(detail)) return code;
  return "XCODE_CONTROL_BUILD_FAILED";
}
/** Only public metadata shape is retained; unknown keys and all entitlement values stay private. */
export function xcodeEntitlementShape(value: unknown) {
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const names = [
    "keychain-access-groups",
    "application-identifier",
    "com.apple.application-identifier",
    "get-task-allow",
    "com.apple.security.get-task-allow",
    "com.apple.developer.team-identifier",
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.debugger",
  ];
  const keys = Object.keys(object),
    groups = object["keychain-access-groups"];
  return {
    knownKeys: keys.filter((k) => names.includes(k)).sort(),
    unknownKeyCount: keys.filter((k) => !names.includes(k)).length,
    ownKeychainGroupOnly:
      Array.isArray(groups) &&
      groups.length === 1 &&
      groups[0] === observedSimulatorApplicationIdentifier,
    keychainGroupCount: Array.isArray(groups) ? groups.length : null,
    ownApplicationIdentifier:
      object["application-identifier"] === observedSimulatorApplicationIdentifier,
    ownAppleApplicationIdentifier:
      object["com.apple.application-identifier"] === observedSimulatorApplicationIdentifier,
    strictAccepted: xcodeControlEntitlementsSchema.safeParse(value).success,
  };
}

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
    TARGET_SHA: input.TARGET_SHA as string,
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_DOTENV: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
  };
}
// Observed in both XML/DER sections of compiler source7294145. This is not a real Apple Team.
export const observedSimulatorApplicationIdentifier = "FAKETEAMID.site.baro.app.preview";
export const xcodeControlEntitlementsSchema = z.strictObject({
  "keychain-access-groups": z.tuple([z.literal(observedSimulatorApplicationIdentifier)]),
  "application-identifier": z.literal(observedSimulatorApplicationIdentifier),
});
export const xcodeHostSignatureEntitlementsSchema = z.strictObject({});
export function verifySimulatorBuildPlatform(output: string) {
  const platforms = [...output.matchAll(/^\s*platform\s+(\w+)\s*$/gm)];
  if (platforms.length !== 1 || platforms[0]?.[1] !== "IOSSIMULATOR")
    throw new Error("XCODE_CONTROL_MACHO_SIMULATOR_REQUIRED");
}
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
export async function preserveCompiledXcodeControl(root: string, sourceSha: string) {
  z.string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(sourceSha);
  const products = resolve(root, ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator"),
    apps = (await readdir(products)).filter((p) => p.endsWith(".app"));
  if (apps.length !== 1 || !apps[0]) throw new Error("XCODE_CONTROL_APP_AMBIGUOUS");
  const app = resolve(products, apps[0]),
    info = simulatorIdentity(
      JSON.parse(
        (
          await command([
            "/usr/bin/plutil",
            "-convert",
            "json",
            "-o",
            "-",
            resolve(app, "Info.plist"),
          ])
        ).stdout,
      ),
      "site.baro.app.preview",
    ),
    base = resolve(root, ".wrangler/ios-xcode-control"),
    name = `unaccepted-simulator-${sourceSha}.zip`,
    zip = resolve(base, name);
  if (await Bun.file(zip).exists()) throw new Error("XCODE_CONTROL_FRESH_OUTPUT_REQUIRED");
  await command(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const body = await readFile(zip);
  await writeFile(
    resolve(base, "inspection.json"),
    `${JSON.stringify(
      {
        version: 1,
        kind: "unaccepted-xcode-simulator-output",
        sourceSha,
        observedAt: new Date().toISOString(),
        applicationId: info.CFBundleIdentifier,
        nativeCompileSucceeded: true,
        archive: { name, bytes: body.length, sha256: sha256(body) },
        infoPlistSha256: sha256(await readFile(resolve(app, "Info.plist"))),
        executableSha256: sha256(await readFile(resolve(app, info.CFBundleExecutable))),
        accepted: false,
        signatureAccepted: false,
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
}
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
export const xcodeControlReceiptSchema = z
  .strictObject({
    version: z.literal(2),
    kind: z.literal("xcode-simulator-signing-control"),
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    toolingSourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    observedAt: z.iso.datetime(),
    applicationId: z.literal("site.baro.app.preview"),
    signature: z.literal("ad-hoc"),
    teamIdentifier: z.literal("not set"),
    architectures: z
      .array(z.enum(["arm64", "x86_64"]))
      .min(1)
      .max(2),
    entitlements: xcodeControlEntitlementsSchema,
    entitlementsSource: z.literal("simulator-macho-xml-and-der"),
    signatureEntitlements: xcodeHostSignatureEntitlementsSchema,
    sectionHashes: z
      .array(
        z.strictObject({
          architecture: z.enum(["arm64", "x86_64"]),
          xmlSha256: z.string().regex(/^[a-f0-9]{64}$/),
          derSha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(2),
    executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
    infoPlistSha256: z.string().regex(/^[a-f0-9]{64}$/),
    appRuntimeVerified: z.literal(false),
    physicalDeviceVerified: z.literal(false),
    storeSigned: z.literal(false),
    deployed: z.literal(false),
  })
  .refine(
    (v) =>
      new Set(v.architectures).size === v.architectures.length &&
      new Set(v.sectionHashes.map((s) => s.architecture)).size === v.architectures.length &&
      v.sectionHashes.length === v.architectures.length &&
      v.sectionHashes.every((s) => v.architectures.includes(s.architecture)),
  );
export async function attestXcodeSimulatorControl(
  root: string,
  sourceSha: string,
  toolingSourceSha = sourceSha,
  configuration: "Debug" | "Release" = "Debug",
) {
  if (configuration !== "Debug" && configuration !== "Release")
    throw new Error("XCODE_CONTROL_CONFIGURATION_REQUIRED");
  const products = resolve(
      root,
      `.wrangler/mobile-build/ios/Build/Products/${configuration}-iphonesimulator`,
    ),
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
  let entitlements: unknown, signatureEntitlements: unknown;
  const sectionHashes = [];
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
    const signed = JSON.parse(
      (await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", file])).stdout,
    );
    const signatureParsed = xcodeHostSignatureEntitlementsSchema.safeParse(signed);
    if (!signatureParsed.success) throw new Error("XCODE_CONTROL_HOST_ENTITLEMENTS_MISMATCH");
    if (
      signatureEntitlements &&
      JSON.stringify(signatureEntitlements) !== JSON.stringify(signatureParsed.data)
    )
      throw new Error("XCODE_CONTROL_ARCH_ENTITLEMENTS_DIFFER");
    signatureEntitlements = signatureParsed.data;
    verifySimulatorBuildPlatform(
      (await command(["/usr/bin/xcrun", "vtool", "-arch", arch, "-show-build", executable])).stdout,
    );
    const thin = resolve(root, `.wrangler/mobile-build/private-thin-${arch}`),
      xml = resolve(root, `.wrangler/mobile-build/private-sim-${arch}.xml`),
      der = resolve(root, `.wrangler/mobile-build/private-sim-${arch}.der`),
      decodedDer = resolve(root, `.wrangler/mobile-build/private-sim-der-${arch}.xml`);
    for (const path of [thin, xml, der, decodedDer])
      if (await Bun.file(path).exists()) throw new Error("XCODE_CONTROL_FRESH_OUTPUT_REQUIRED");
    await command(["/usr/bin/lipo", executable, "-thin", arch, "-output", thin]);
    await command(["/usr/bin/xcrun", "segedit", thin, "-extract", "__TEXT", "__entitlements", xml]);
    await command(["/usr/bin/xcrun", "segedit", thin, "-extract", "__TEXT", "__ents_der", der]);
    const xmlBytes = await readFile(xml),
      derBytes = await readFile(der);
    if (!xmlBytes.length || !derBytes.length || xmlBytes.length > 65536 || derBytes.length > 65536)
      throw new Error("XCODE_CONTROL_SIMULATOR_SECTIONS_REQUIRED");
    await writeFile(
      decodedDer,
      (await command(["/usr/bin/derq", "query", "-i", der, "-x"])).stdout,
      { flag: "wx" },
    );
    const decoded = JSON.parse(
        (await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", xml])).stdout,
      ),
      fromDer = xcodeControlEntitlements(
        JSON.parse(
          (await command(["/usr/bin/plutil", "-convert", "json", "-o", "-", decodedDer])).stdout,
        ),
      );
    await writeFile(
      resolve(root, `.wrangler/ios-xcode-control/entitlement-shape-${arch}.json`),
      `${JSON.stringify({ sourceSha, architecture: arch, observedAt: new Date().toISOString(), ...xcodeEntitlementShape(decoded) }, null, 2)}\n`,
      { flag: "wx" },
    );
    const parsed = xcodeControlEntitlements(decoded);
    if (JSON.stringify(parsed) !== JSON.stringify(fromDer))
      throw new Error("XCODE_CONTROL_XML_DER_DIFFER");
    if (entitlements && JSON.stringify(entitlements) !== JSON.stringify(parsed))
      throw new Error("XCODE_CONTROL_ARCH_ENTITLEMENTS_DIFFER");
    entitlements = parsed;
    sectionHashes.push({
      architecture: arch,
      xmlSha256: sha256(xmlBytes),
      derSha256: sha256(derBytes),
    });
  }
  const receipt = xcodeControlReceiptSchema.parse({
    version: 2,
    kind: "xcode-simulator-signing-control",
    sourceSha,
    toolingSourceSha,
    observedAt: new Date().toISOString(),
    applicationId: info.CFBundleIdentifier,
    signature: "ad-hoc",
    teamIdentifier: "not set",
    architectures,
    entitlements,
    entitlementsSource: "simulator-macho-xml-and-der",
    signatureEntitlements,
    sectionHashes,
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
export async function verifyXcodeControlBinary(root: string, sourceSha: string) {
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
      kind: "verified-xcode-control-preview",
      sourceSha,
      toolingSourceSha: control.toolingSourceSha,
      zipName: receipt.artifact.name,
      zipBytes: bytes.byteLength,
      zipSha256: receipt.artifact.sha256,
      receiptSha256: sha256(receiptBytes),
      control,
    },
  };
}
