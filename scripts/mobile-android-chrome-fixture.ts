import { createHash } from "node:crypto";
import { z } from "zod";

const flagPath = "/data/local/tmp/chrome-command-line";
const flagContents = "_ --disable-fre\n";
export const chromeTestCommandLineSha256 = createHash("sha256").update(flagContents).digest("hex");
export const androidChromeFixtureSchema = z.strictObject({
  kind: z.literal("owned-emulator-preinstalled-chrome-test-fixture"),
  buildType: z.enum(["userdebug", "eng"]),
  chromeVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+\.\d+$/)
    .max(64),
  switches: z.tuple([z.literal("--disable-fre")]),
  commandLineSha256: z.literal(chromeTestCommandLineSha256),
  commandLineReadbackVerified: z.literal(true),
  commandLineRemovedVerified: z.literal(true),
  consumerFirstRunVerified: z.literal(false),
  consentUiUsed: z.literal(false),
  accountsConfigured: z.literal(false),
  rootAdbUsed: z.literal(false),
  debugAppSettingsChanged: z.literal(false),
  tlsChecksChanged: z.literal(false),
  webSecurityChanged: z.literal(false),
});
export type AndroidChromeFixture = z.infer<typeof androidChromeFixtureSchema>;
const knownFailures = new Set([
  "ANDROID_CHROME_OWNED_EMULATOR_REQUIRED",
  "ANDROID_CHROME_DEBUG_BUILD_REQUIRED",
  "ANDROID_CHROME_EXISTING_FLAGS_REFUSED",
  "ANDROID_CHROME_VERSION_REQUIRED",
  "ANDROID_CHROME_FLAG_READBACK_FAILED",
  "ANDROID_CHROME_FLAG_CLEANUP_FAILED",
]);
export function knownAndroidChromeFixtureFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return knownFailures.has(code) ? code : null;
}
export function inspectChromeVersion(dump: string) {
  if (dump.length > 2_000_000) throw Error("ANDROID_CHROME_VERSION_REQUIRED");
  const versions = [
    ...new Set(
      [...dump.matchAll(/^\s*versionName=(\d+\.\d+\.\d+\.\d+)\s*$/gm)].map((match) => match[1]),
    ),
  ];
  if (versions.length !== 1 || !versions[0] || versions[0].length > 64)
    throw Error("ANDROID_CHROME_VERSION_REQUIRED");
  return versions[0];
}
/** Only a fresh, owned CI userdebug/eng AVD. No user/device profile or global debug setting is changed. */
export async function prepareOwnedChromeFixture(context: {
  shell: (args: string[], input?: string) => Promise<string>;
  freshOwnedEmulator: boolean;
  deviceSerial: string;
  avdName: string;
}) {
  if (
    !context.freshOwnedEmulator ||
    !/^emulator-\d{4,5}$/.test(context.deviceSerial) ||
    !/^baro_runtime_[a-f0-9]{12}$/.test(context.avdName)
  )
    throw Error("ANDROID_CHROME_OWNED_EMULATOR_REQUIRED");
  const { shell } = context;
  const buildType = (await shell(["getprop", "ro.build.type"])).trim();
  if (buildType !== "userdebug" && buildType !== "eng")
    throw Error("ANDROID_CHROME_DEBUG_BUILD_REQUIRED");
  const hasFlags = async () =>
    (await shell(["ls", "-1", "/data/local/tmp"])).split(/\r?\n/).includes("chrome-command-line");
  if (await hasFlags()) throw Error("ANDROID_CHROME_EXISTING_FLAGS_REFUSED");
  const chromeVersion = inspectChromeVersion(
    await shell(["dumpsys", "package", "com.android.chrome"]),
  );
  await shell(["am", "force-stop", "com.android.chrome"]);
  let created = false,
    finished: AndroidChromeFixture | undefined;
  async function removeOwnedFlags() {
    if (!created) return;
    try {
      await shell(["rm", "-f", flagPath]);
      if (await hasFlags()) throw Error("ANDROID_CHROME_FLAG_CLEANUP_FAILED");
      created = false;
    } catch {
      throw Error("ANDROID_CHROME_FLAG_CLEANUP_FAILED");
    }
  }
  try {
    created = true;
    // Literal stdin, not a shell expression; no arbitrary flags or URI/account input.
    await shell(["tee", flagPath], flagContents);
    if ((await shell(["cat", flagPath])) !== flagContents)
      throw Error("ANDROID_CHROME_FLAG_READBACK_FAILED");
    return {
      async finish(): Promise<AndroidChromeFixture> {
        if (finished) return finished;
        await removeOwnedFlags();
        finished = androidChromeFixtureSchema.parse({
          kind: "owned-emulator-preinstalled-chrome-test-fixture",
          buildType,
          chromeVersion,
          switches: ["--disable-fre"],
          commandLineSha256: chromeTestCommandLineSha256,
          commandLineReadbackVerified: true,
          commandLineRemovedVerified: true,
          consumerFirstRunVerified: false,
          consentUiUsed: false,
          accountsConfigured: false,
          rootAdbUsed: false,
          debugAppSettingsChanged: false,
          tlsChecksChanged: false,
          webSecurityChanged: false,
        });
        return finished;
      },
    };
  } catch (error) {
    await removeOwnedFlags();
    throw error;
  }
}
