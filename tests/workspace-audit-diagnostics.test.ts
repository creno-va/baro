import { expect, test } from "bun:test";
import { prepareGatewayWireInput } from "../src/server/modules/llm-gateway/service";
import { workspaceAuditOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";
import { safeWorkspaceAuditFailure } from "../src/server/modules/workspace/audit-diagnostics";

const finding = { severity: "critical", code: "contradiction" } as const;
const audit = {
  pass: false,
  findings: [finding],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};

test("legacy audit fixtures become explicitly unknown without changing their verdict", () => {
  expect(workspaceAuditOutputSchema.parse(audit)).toEqual({
    ...audit,
    findings: [{ ...finding, target: "unknown", basis: "unknown" }],
  });
  const receipt = {
    pass: false,
    findings: [finding],
    unsupportedFactCount: 0,
    legalClaimsSupported: true,
    strategyDetected: false,
  };
  expect(safeWorkspaceAuditFailure(receipt)).toEqual(receipt);
});

test.each([
  ["response_text", "current_fact"],
  ["action", "assistant_history"],
  ["timeline", "server_calendar"],
  ["unknown", "unknown"],
] as const)(
  "fixed finding target %s and basis %s survive only as enum metadata",
  (target, basis) => {
    const parsed = workspaceAuditOutputSchema.parse({
      ...audit,
      findings: [{ ...finding, target, basis }],
    });
    const { unsupportedFactIds: _ids, ...rest } = parsed;
    const receipt = { ...rest, unsupportedFactCount: 0 };
    expect(safeWorkspaceAuditFailure(receipt)).toEqual(receipt);
    expect(parsed.pass).toBe(false);
    expect(parsed.findings[0]?.severity).toBe("critical");
  },
);

test("audit diagnostics reject arbitrary text, identifiers, offsets and reasons", () => {
  for (const extra of [
    { target: "private draft text", basis: "unknown" },
    { target: "response_text", basis: "private source text" },
    { target: null, basis: "unknown" },
    { target: "response_text", basis: "unknown", text: "private draft text" },
    { target: "response_text", basis: "unknown", id: "private-entity-id" },
    { target: "response_text", basis: "unknown", offset: 42 },
    { target: "response_text", basis: "unknown", reason: "private explanation" },
  ]) {
    const findings = [{ ...finding, ...extra }];
    expect(workspaceAuditOutputSchema.safeParse({ ...audit, findings }).success).toBe(false);
    expect(
      safeWorkspaceAuditFailure({
        pass: false,
        findings,
        unsupportedFactCount: 0,
        legalClaimsSupported: true,
        strategyDetected: false,
      }),
    ).toBeUndefined();
  }
  expect(
    workspaceAuditOutputSchema.safeParse({ ...audit, findings: Array(31).fill(finding) }).success,
  ).toBe(false);
});

test("provider output requires both bounded enums but permits unknown without inventing evidence", () => {
  const wire = prepareGatewayWireInput("workspace_audit", { phase: "workspace_chat" });
  const schema = wire.response_format.json_schema.schema as {
    properties: {
      output: {
        properties: {
          findings: {
            maxItems: number;
            items: { required: string[]; additionalProperties: boolean };
          };
        };
      };
    };
  };
  expect(schema.properties.output.properties.findings.maxItems).toBe(30);
  expect(schema.properties.output.properties.findings.items.required).toEqual([
    "severity",
    "code",
    "target",
    "basis",
  ]);
  expect(schema.properties.output.properties.findings.items.additionalProperties).toBe(false);
  expect(wire.messages[0]?.content).toContain(
    "Use unknown when the target or basis cannot be identified.",
  );
  expect(wire.messages[0]?.content).toContain("Never invent evidence to fill a diagnostic field.");
  expect(wire.max_completion_tokens).toBe(2400);
  expect(wire.store).toBe(false);
});
