import { expect, test } from "bun:test";
import { testAlertSchema } from "../scripts/alert-contract";

test("isolated test alert admits only fixed metadata and rejects payload/credentials/stack/raw URL or production", () => {
  const sample = {
    test: true,
    environment: "isolated-test",
    release: "a".repeat(40),
    timestamp: "2026-10-05T12:00:00.000Z",
    event: "deletion_cleanup_failed",
    errorCode: "WORKFLOW_CLEANUP_FAILED",
    requestId: "11111111-1111-4111-8111-111111111111",
    runbookUrl: "https://github.com/creno-va/baro/blob/main/docs/operations/BETA-DRILLS.md",
  };
  expect(testAlertSchema.safeParse(sample).success).toBe(true);
  for (const field of [
    "body",
    "narrative",
    "result",
    "prompt",
    "token",
    "cookie",
    "sql",
    "stack",
    "email",
    "ip",
    "authUrl",
  ])
    expect(
      testAlertSchema.safeParse({ ...sample, [field]: "synthetic forbidden value" }).success,
    ).toBe(false);
  expect(testAlertSchema.safeParse({ ...sample, environment: "production" }).success).toBe(false);
});

test("alert event and error code must describe the same failure and request ID must be UUIDv4", () => {
  const metadata = {
    test: true,
    environment: "isolated-test",
    release: "a".repeat(40),
    timestamp: "2026-10-05T12:00:00.000Z",
    requestId: "11111111-1111-4111-8111-111111111111",
    runbookUrl: "https://github.com/creno-va/baro/blob/main/docs/operations/BETA-DRILLS.md",
  };
  const pairs = [
    ["deletion_cleanup_failed", "WORKFLOW_CLEANUP_FAILED"],
    ["crypto_failure", "CRYPTO_DECRYPT_FAILED"],
    ["citation_rejected", "POLICY_REJECTED"],
    ["citation_rejected", "LEGAL_SOURCE_UNAVAILABLE"],
    ["workflow_timeout", "ANALYSIS_TIMEOUT"],
  ] as const;
  for (const [event, errorCode] of pairs) {
    expect(testAlertSchema.safeParse({ ...metadata, event, errorCode }).success).toBe(true);
    for (const [otherEvent, otherCode] of pairs)
      if (event !== otherEvent)
        expect(
          testAlertSchema.safeParse({ ...metadata, event, errorCode: otherCode }).success,
        ).toBe(false);
  }
  for (const requestId of [
    "-".repeat(36),
    "a".repeat(36),
    "11111111-1111-1111-8111-111111111111",
    "11111111-1111-4111-1111-111111111111",
  ])
    expect(
      testAlertSchema.safeParse({
        ...metadata,
        event: pairs[0][0],
        errorCode: pairs[0][1],
        requestId,
      }).success,
    ).toBe(false);
});
