import { z } from "zod";
import {
  DOWNLOAD_BYTES,
  probeResultSchema,
  productMountSchema,
  RUNTIME_ORIGIN,
  UPLOAD_BYTES,
} from "../apps/mobile/runtime-probe/protocol";
import { repeatedDigest } from "./mobile-runtime-fixture";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const runtimeReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("local-development-runtime"),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(["android", "ios"]),
  environment: z.literal("local"),
  apiOrigin: z.literal(RUNTIME_ORIGIN),
  applicationId: z.literal("site.baro.app.dev"),
  device: z.strictObject({
    kind: z.enum(["emulator", "simulator"]),
    model: z.string().min(1).max(160),
    osVersion: z.string().min(1).max(80),
  }),
  productEntry: z.strictObject({
    kind: z.literal("instrumented-home-layout-only"),
    originalSha256: hash,
    overlaySha256: hash,
    layout: productMountSchema,
    screenshot: z.enum(["product-home-android.png", "product-home-ios.png"]),
  }),
  probeEntry: z.strictObject({
    kind: z.literal("alternate-entry-real-native-sdk"),
    path: z.literal("apps/mobile/runtime-probe/entry.tsx"),
    sha256: hash,
  }),
  metroOverlaySha256: hash,
  assets: z.strictObject({
    kind: z.literal("compiled-resource-only"),
    family: z.literal("BaroMobile"),
    sha256: hash,
    weights: z.tuple([z.literal(400), z.literal(600), z.literal(700)]),
    glyphs: z.number().int().positive(),
    codepoints: z.number().int().positive(),
    hangul: z.literal(11172),
    licenseEmbedded: z.literal(true),
    compiledBytesMatch: z.literal(true),
    appRuntimeVerified: z.literal(false),
  }),
  result: probeResultSchema,
  transport: z.strictObject({
    requestCount: z.number().int().min(5).max(20),
    rejectedHeaders: z.literal(0),
    upload: z.strictObject({ bytes: z.literal(UPLOAD_BYTES), sha256: hash }),
    downloadedBytes: z.literal(DOWNLOAD_BYTES),
    delayedStarted: z.literal(true),
    cancelUploadStarted: z.literal(true),
    cancelUploadBytes: z.number().int().positive().lt(UPLOAD_BYTES),
  }),
  memory: z.strictObject({
    metric: z.literal("sampled-process-rss"),
    peakObservedBytes: z.number().int().positive(),
    samples: z.number().int().positive(),
    wholeRunPeakProven: z.literal(false),
    jsHeapLimitProven: z.literal(false),
  }),
  productJourneysVerified: z.literal(false),
  accessibilityVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export function verifyRuntimeReceipt(
  value: unknown,
  sourceSha: string,
  platform: "android" | "ios",
) {
  const receipt = runtimeReceiptSchema.parse(value);
  if (
    receipt.sourceSha !== sourceSha ||
    receipt.result.sourceSha !== sourceSha ||
    receipt.platform !== platform ||
    receipt.result.platform !== platform ||
    receipt.device.kind !== (platform === "android" ? "emulator" : "simulator") ||
    receipt.productEntry.screenshot !== `product-home-${platform}.png` ||
    receipt.transport.upload.sha256 !== receipt.result.upload.sha256 ||
    receipt.transport.cancelUploadBytes !== receipt.result.cancelUploadBytesReceived ||
    receipt.transport.requestCount !== receipt.result.nativeCalls ||
    receipt.result.upload.sha256 !== repeatedDigest(UPLOAD_BYTES) ||
    receipt.result.download.sha256 !== repeatedDigest(DOWNLOAD_BYTES)
  )
    throw new Error("RUNTIME_RECEIPT_IDENTITY_OR_TRANSPORT_MISMATCH");
  return receipt;
}

export const runtimeHomeReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("instrumented-home-only"),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(["android", "ios"]),
  applicationId: z.literal("site.baro.app.dev"),
  device: runtimeReceiptSchema.shape.device,
  productEntry: runtimeReceiptSchema.shape.productEntry,
  assets: runtimeReceiptSchema.shape.assets,
  nativeIoVerified: z.literal(false),
  productJourneysVerified: z.literal(false),
  accessibilityVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  oauthVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export function verifyRuntimeHomeReceipt(
  value: unknown,
  sourceSha: string,
  platform: "android" | "ios",
) {
  const result = runtimeHomeReceiptSchema.parse(value);
  if (
    result.sourceSha !== sourceSha ||
    result.platform !== platform ||
    result.device.kind !== (platform === "android" ? "emulator" : "simulator") ||
    result.productEntry.screenshot !== `product-home-${platform}.png`
  )
    throw new Error("RUNTIME_HOME_RECEIPT_IDENTITY_MISMATCH");
  return result;
}
