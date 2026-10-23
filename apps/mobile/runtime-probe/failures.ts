import { z } from "zod";

export const probeFailureCategorySchema = z.enum([
  "KEYCHAIN_ENTITLEMENT_MISSING",
  "KEYCHAIN_FAILURE",
  "INVALID_STORAGE_KEY",
  "PRIVATE_TRANSFER_FAILURE",
  "CHECK_FAILED",
  "UNKNOWN",
]);
export function probeFailureCategory(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : "";
  if (
    /required entitlement|neither application-identifier nor keychain-access-groups/i.test(message)
  )
    return "KEYCHAIN_ENTITLEMENT_MISSING" as const;
  if (code === "ERR_KEY_CHAIN") return "KEYCHAIN_FAILURE" as const;
  if (code === "ERR_INVALID_KEY") return "INVALID_STORAGE_KEY" as const;
  if (code === "PRIVATE_DOWNLOAD_FAILED") return "PRIVATE_TRANSFER_FAILURE" as const;
  if (message === "IOS_HOST_CHECK_FAILED") return "CHECK_FAILED" as const;
  return "UNKNOWN" as const;
}
