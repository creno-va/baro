import { expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import { safe } from "../src/server/db/v2-core";
import {
  dependencyStep,
  reportDependencyFailure,
  reportProviderFailure,
} from "../src/server/dependency-diagnostics";

test("repository replacement preserves a static failure category and retry stage without private error data", async () => {
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    try {
      await dependencyStep("retry_commit", () =>
        safe(async () => {
          throw new Error(
            "D1_ERROR: UNIQUE constraint failed: private-sql private-owner private-token",
          );
        }),
      );
    } catch (error) {
      reportDependencyFailure(error);
      expect(String(error)).toBe("V2RepositoryError: DB_OPERATION_FAILED");
    }
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        event: "workspace_dependency_failure",
        stage: "retry_commit",
        category: "database_constraint",
      }),
    );
    expect(JSON.stringify(output.mock.calls)).not.toContain("private");
  } finally {
    output.mockRestore();
  }
});
test("provider diagnostics select and clamp fields and logging exceptions cannot admit raw payloads", () => {
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    reportProviderFailure({
      phase: "private-case",
      category: "unknown",
      httpStatus: 401,
      secret: "private-token",
    } as Parameters<typeof reportProviderFailure>[0]);
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({
        event: "workspace_provider_failure",
        phase: "unclassified",
        category: "unknown",
        httpStatus: 401,
      }),
    );
    expect(JSON.stringify(output.mock.calls)).not.toContain("private");
    for (const source of [
      "console.error(error)",
      "console.error(JSON.stringify({event:'workspace_provider_failure',message:error.message}))",
    ]) {
      expect(productBoundaryFindings("src/server/dependency-diagnostics.ts", source)).toContain(
        "unapproved_payload_log",
      );
    }
  } finally {
    output.mockRestore();
  }
});
