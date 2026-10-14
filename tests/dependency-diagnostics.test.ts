import { expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import { safe } from "../src/server/db/v2-core";
import {
  dependencyCategory,
  dependencyStep,
  reportDependencyFailure,
  reportLegalRetrieval,
  reportProviderFailure,
  reportWorkspacePolicyFailure,
} from "../src/server/dependency-diagnostics";

test("D1 depth, compound-select and function limits have a distinct safe category", () => {
  for (const message of [
    "D1_ERROR: Expression tree is too large (maximum depth 100)",
    "D1_ERROR: too many terms in compound SELECT",
    "D1_ERROR: too many arguments on function json_object",
  ])
    expect(dependencyCategory(new Error(message))).toBe("database_limit");
});

test("legal and draft diagnostics expose enum outcomes without private source payloads", () => {
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    reportLegalRetrieval({
      kind: "statute",
      availability: "unavailable",
      reason: "configuration_missing",
      query: "private-case",
      url: "https://example.test/?OC=private-token",
      chunks: [{ source: { body: "private-body" } }],
    } as Parameters<typeof reportLegalRetrieval>[0]);
    reportLegalRetrieval({
      kind: "private-kind",
      availability: "private-state",
      reason: "private-reason",
    });
    reportWorkspacePolicyFailure("audit_rejected");
    reportWorkspacePolicyFailure(new Error("private-draft"));
    expect(output.mock.calls.map(([value]) => JSON.parse(String(value)))).toEqual([
      {
        event: "workspace_legal_retrieval",
        kind: "statute",
        availability: "unavailable",
        reason: "configuration_missing",
      },
      {
        event: "workspace_legal_retrieval",
        kind: "unknown",
        availability: "unknown",
        reason: "unknown",
      },
      { event: "workspace_policy_failure", reason: "audit_rejected" },
      { event: "workspace_policy_failure", reason: "unknown" },
    ]);
    expect(JSON.stringify(output.mock.calls)).not.toContain("private");
    expect(
      productBoundaryFindings(
        "src/server/dependency-diagnostics.ts",
        "console.error(JSON.stringify({event:'workspace_legal_retrieval',kind,availability,reason,body:source.body}))",
      ),
    ).toContain("unapproved_payload_log");
  } finally {
    output.mockRestore();
  }
});

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
