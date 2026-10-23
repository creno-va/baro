import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const sizes = [
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "extra-extra-large",
  "extra-extra-extra-large",
  "accessibility-medium",
  "accessibility-large",
  "accessibility-extra-large",
  "accessibility-extra-extra-large",
  "accessibility-extra-extra-extra-large",
] as const;
export const iosUiCapabilitiesSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("ios-simulator-ui-sdk-documentation"),
  toolingSourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  observedAt: z.iso.datetime(),
  helpSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentSizeOperationAdvertised: z.boolean(),
  advertisedContentSizes: z.array(z.enum(sizes)),
  sdkDocumentationOnly: z.literal(true),
  nativeDeviceStateRead: z.literal(false),
  nativeDeviceStateChanged: z.literal(false),
  appRuntimeVerified: z.literal(false),
  accessibilityVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
});
export function inspectIosUiHelp(help: string, toolingSourceSha: string, observedAt: string) {
  return iosUiCapabilitiesSchema.parse({
    version: 1,
    kind: "ios-simulator-ui-sdk-documentation",
    toolingSourceSha,
    observedAt,
    helpSha256: createHash("sha256").update(help).digest("hex"),
    contentSizeOperationAdvertised: /(?:^|\s)content_size(?:\s|$)/m.test(help),
    advertisedContentSizes: sizes.filter((s) =>
      new RegExp(`(?:^|[^A-Za-z0-9_-])${s}(?=$|[^A-Za-z0-9_-])`).test(help),
    ),
    sdkDocumentationOnly: true,
    nativeDeviceStateRead: false,
    nativeDeviceStateChanged: false,
    appRuntimeVerified: false,
    accessibilityVerified: false,
    physicalDeviceVerified: false,
  });
}
async function main() {
  const source = process.env.TARGET_SHA;
  if (
    process.platform !== "darwin" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    !/^[a-f0-9]{40}$/.test(source ?? "")
  )
    throw Error("IOS_UI_SDK_FRESH_MAC_CI_REQUIRED");
  const git = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" }),
    head = (await new Response(git.stdout).text()).trim();
  if ((await git.exited) || head !== source) throw Error("IOS_UI_SDK_SOURCE_MISMATCH");
  const path = resolve(".wrangler/mobile-internal-ios-reverify/ui-capabilities.json");
  if (await Bun.file(path).exists()) throw Error("IOS_UI_SDK_FRESH_OUTPUT_REQUIRED");
  const child = Bun.spawn(["/usr/bin/xcrun", "simctl", "help", "ui"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    timer = setTimeout(() => child.kill(), 30000);
  try {
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (await child.exited) throw Error("IOS_UI_SDK_HELP_UNAVAILABLE");
    const help = `${out}\n${err}`;
    if (!help.trim()) throw Error("IOS_UI_SDK_HELP_EMPTY");
    const result = inspectIosUiHelp(help, source as string, new Date().toISOString());
    await mkdir(resolve(".wrangler/mobile-internal-ios-reverify"), { recursive: true });
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log("IOS_SIMULATOR_UI_SDK_DOCUMENTATION_OBSERVED_NO_DEVICE_STATE_CHANGED");
  } finally {
    clearTimeout(timer);
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("IOS_UI_SDK_DOCUMENTATION_FAILED");
    process.exitCode = 1;
  });
