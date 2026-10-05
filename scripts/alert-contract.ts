import { z } from "zod";
// Independent #19 test alert contract; no transport, receiver or production alert is enabled.
export const testAlertSchema = z.strictObject({
  test: z.literal(true),
  environment: z.literal("isolated-test"),
  release: z.string().regex(/^[a-f0-9]{40}$/),
  timestamp: z.iso.datetime(),
  event: z.enum([
    "deletion_cleanup_failed",
    "crypto_failure",
    "citation_rejected",
    "workflow_timeout",
  ]),
  errorCode: z.enum([
    "WORKFLOW_CLEANUP_FAILED",
    "CRYPTO_DECRYPT_FAILED",
    "POLICY_REJECTED",
    "LEGAL_SOURCE_UNAVAILABLE",
    "ANALYSIS_TIMEOUT",
  ]),
  requestId: z.string().regex(/^[a-f0-9-]{36}$/),
  runbookUrl: z.literal(
    "https://github.com/creno-va/baro/blob/main/docs/operations/BETA-DRILLS.md",
  ),
});
