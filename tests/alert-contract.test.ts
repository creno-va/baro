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
