import { z } from "zod";
import { internalAndroidArtifactSchema } from "./mobile-internal-android-artifact";

export function androidHomeObservationOptions(options: string[]) {
  const largeFont = options.includes("--large-font"),
    publicDirectory = options.includes("--public-directory"),
    guideUi = options.includes("--guide-ui"),
    authCancel = options.includes("--auth-cancel");
  if (
    new Set(options).size !== options.length ||
    options.some(
      (o) => !["--large-font", "--public-directory", "--guide-ui", "--auth-cancel"].includes(o),
    ) ||
    (guideUi && (!largeFont || publicDirectory)) ||
    (authCancel && (largeFont || publicDirectory || guideUi))
  )
    throw Error("BUNDLED_HOME_MODE_REQUIRED");
  return { largeFont, publicDirectory, guideUi, authCancel };
}
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  source = z.string().regex(/^[a-f0-9]{40}$/);
export const androidGuideUiReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("bundled-android-large-font-home-guide-ui-only"),
  toolingSourceSha: source,
  binarySourceSha: source,
  observedAt: z.iso.datetime(),
  applicationId: z.literal("site.baro.app.preview"),
  binary: internalAndroidArtifactSchema.shape.artifact,
  verificationSha256: digest,
  baselineReceiptSha256: digest,
  device: z.strictObject({
    kind: z.literal("owned-emulator"),
    model: z.string().min(1).max(160),
    osVersion: z.string().min(1).max(80),
  }),
  fontScaleBefore: z.literal(2),
  fontScaleAfter: z.literal(2),
  homeSwipes: z.number().int().min(1).max(24),
  guideSwipes: z.number().int().min(0).max(24),
  guideButtonTapVerified: z.literal(true),
  guideTitleObserved: z.literal(true),
  currentFeatureDescriptionObserved: z.literal(true),
  returnButtonTapVerified: z.literal(true),
  homeReturnObserved: z.literal(true),
  guideDismissedObserved: z.literal(true),
  controlBoundsWithinScreen: z.literal(true),
  rawHierarchyExported: z.literal(false),
  screenshotsSuppressedBeforeNavigation: z.literal(true),
  publicDataNavigation: z.literal(false),
  authenticationNavigation: z.literal(false),
  metroServerStarted: z.literal(false),
  metroRequests: z.literal(0),
  allScreensVerified: z.literal(false),
  keyboardVerified: z.literal(false),
  rotationVerified: z.literal(false),
  talkBackVerified: z.literal(false),
  voiceOverVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  oauthVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export function verifyAndroidGuideUiReceipt(
  value: unknown,
  expected: Pick<
    z.infer<typeof androidGuideUiReceiptSchema>,
    | "toolingSourceSha"
    | "binarySourceSha"
    | "binary"
    | "verificationSha256"
    | "baselineReceiptSha256"
    | "device"
  >,
) {
  const result = androidGuideUiReceiptSchema.parse(value);
  if (
    result.toolingSourceSha !== expected.toolingSourceSha ||
    result.binarySourceSha !== expected.binarySourceSha ||
    result.verificationSha256 !== expected.verificationSha256 ||
    result.baselineReceiptSha256 !== expected.baselineReceiptSha256 ||
    result.binary.name !== expected.binary.name ||
    result.binary.bytes !== expected.binary.bytes ||
    result.binary.sha256 !== expected.binary.sha256 ||
    result.device.kind !== expected.device.kind ||
    result.device.model !== expected.device.model ||
    result.device.osVersion !== expected.device.osVersion
  )
    throw Error("BUNDLED_GUIDE_IDENTITY_MISMATCH");
  return result;
}

export function androidGuideUiValidationFields(error: unknown) {
  if (!(error instanceof z.ZodError)) return [];
  return [
    ...new Set(
      error.issues
        .map((issue) => issue.path[0])
        .filter(
          (field): field is string =>
            typeof field === "string" && Object.hasOwn(androidGuideUiReceiptSchema.shape, field),
        ),
    ),
  ].slice(0, 8);
}
