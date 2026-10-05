import { z } from "zod";

// Independent #19 test alert contract; no transport, receiver or production alert is enabled.
const metadata = {
  test: z.literal(true),
  environment: z.literal("isolated-test"),
  release: z.string().regex(/^[a-f0-9]{40}$/),
  timestamp: z.iso.datetime(),
  requestId: z.uuidv4(),
  runbookUrl: z.literal(
    "https://github.com/creno-va/baro/blob/main/docs/operations/BETA-DRILLS.md",
  ),
};
export const testAlertSchema = z.discriminatedUnion("event", [
  z.strictObject({
    ...metadata,
    event: z.literal("deletion_cleanup_failed"),
    errorCode: z.literal("WORKFLOW_CLEANUP_FAILED"),
  }),
  z.strictObject({
    ...metadata,
    event: z.literal("crypto_failure"),
    errorCode: z.literal("CRYPTO_DECRYPT_FAILED"),
  }),
  z.strictObject({
    ...metadata,
    event: z.literal("citation_rejected"),
    errorCode: z.enum(["POLICY_REJECTED", "LEGAL_SOURCE_UNAVAILABLE"]),
  }),
  z.strictObject({
    ...metadata,
    event: z.literal("workflow_timeout"),
    errorCode: z.literal("ANALYSIS_TIMEOUT"),
  }),
]);
