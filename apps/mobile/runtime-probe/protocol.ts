import { z } from "zod";
import { probeFailureCategorySchema } from "./failures";

export const RUNTIME_ORIGIN = "http://127.0.0.1:8765";
export const UPLOAD_BYTES = 100_000_000;
export const DOWNLOAD_BYTES = 1_000_000_000;
export const PROBE_OWNER = "probe_owner";
export const OWNER_COOKIE = "better-auth.session_token=fixture-native-owner";
export const PEER_COOKIE = "better-auth.session_token=fixture-native-peer";
export const runtimeConfigSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  nonce: z.uuid(),
  origin: z.literal(RUNTIME_ORIGIN),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export const productMountSchema = z.strictObject({
  width: z.number().min(240).max(5000),
  height: z.number().min(240).max(5000),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const probeResultSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(["android", "ios"]),
  upload: z.strictObject({ bytes: z.literal(UPLOAD_BYTES), sha256: digest }),
  download: z.strictObject({ bytes: z.literal(DOWNLOAD_BYTES), sha256: digest }),
  nativeMaxCopyBytes: z.number().int().min(1).max(65536),
  nativeCalls: z.number().int().min(4).max(20),
  sdkSourceReadback: z.literal(true),
  sdkDownloadReadback: z.literal(true),
  secureStoreReadback: z.literal(true),
  unresolvedKeyPreserved: z.literal(true),
  cancelUploadBytesReceived: z.number().int().positive().lt(UPLOAD_BYTES),
  unauthorizedRejected: z.literal(true),
  crossOriginRejected: z.literal(true),
  ownerChangeRejected: z.literal(true),
  peerCookiePreserved: z.literal(true),
  sourceClearRejectedActiveUpload: z.literal(true),
  sourceFilesRemaining: z.literal(0),
  downloadFilesRemaining: z.literal(0),
  nativeFilesRemaining: z.literal(0),
  documentPickerVerified: z.literal(false),
  oauthVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;
export const probeFailureSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  category: probeFailureCategorySchema.optional(),
});
