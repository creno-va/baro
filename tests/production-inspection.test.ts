import { expect, test } from "bun:test";
import {
  finiteWorkspaceOutput,
  inspectProductionWorkspace,
} from "../scripts/inspect-production-workspace";

test("invalid target and changed serving release stop before authenticated reads", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ release: "b".repeat(40), environment: "production", status: "ready" });
  };
  await expect(
    inspectProductionWorkspace(
      { token: "private", sha: "a".repeat(40), workspaceId: "invalid" },
      fetcher,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(
    inspectProductionWorkspace(
      {
        token: "private",
        sha: "a".repeat(40),
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      fetcher,
    ),
  ).rejects.toThrow("INSPECTION_RELEASE_MISMATCH");
  expect(calls).toBe(1);
});
test("inspection exports only finite diagnostics and never arbitrary output or errors", () => {
  const result = finiteWorkspaceOutput({
    policyReason: "unsupported_fact",
    text: "private-case",
    error: "private-stack",
    auditFailure: { pass: true, text: "private-audit" },
    contentFailure: { text: "private-content" },
  });
  expect(result).toEqual({ policyReason: "unsupported_fact" });
  expect(JSON.stringify(result)).not.toContain("private");
});
test("empty workspace inspection makes only a release read and parameterized metadata SELECT", async () => {
  const calls: { url: string; method?: string; body?: string }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      ...(init?.method ? { method: init.method } : {}),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    return calls.length === 1
      ? Response.json({ release: "a".repeat(40), environment: "production", status: "ready" })
      : Response.json({ success: true, result: [{ success: true, results: [] }] });
  };
  const result = await inspectProductionWorkspace(
    { token: "private", sha: "a".repeat(40), workspaceId: "00000000-0000-4000-8000-000000000001" },
    fetcher,
  );
  expect(calls).toHaveLength(2);
  const query = JSON.parse(calls[1]?.body ?? "");
  expect(query.sql).toStartWith("SELECT ");
  expect(query.sql).not.toMatch(/encrypted|owner_id|lease_token|UPDATE|INSERT|DELETE/);
  expect(query.params).toEqual(["00000000-0000-4000-8000-000000000001"]);
  expect(JSON.stringify(result)).not.toContain("private");
});

test("prefixed report jobs retain the same bounded metadata contract as UUID workspace jobs", async () => {
  let calls = 0;
  const job = {
    id: "native-v1-report-00000000-0000-4000-8000-000000000002",
    runtime_instance_id: "native-v1-report-00000000-0000-4000-8000-000000000002-1",
    kind: "report_build" as const,
    status: "failed" as const,
    failure_code: "STORAGE_UNAVAILABLE",
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const fetcher = async () => {
    calls++;
    if (calls === 1)
      return Response.json({ release: "a".repeat(40), environment: "production", status: "ready" });
    return Response.json({
      success: true,
      result: calls === 2 ? [{ success: true, results: [job] }] : {},
    });
  };
  const result = await inspectProductionWorkspace(
    { token: "private", sha: "a".repeat(40), workspaceId: "00000000-0000-4000-8000-000000000001" },
    fetcher,
  );
  expect(result.jobs).toEqual([{ ...job, diagnostic: null }]);
  expect(calls).toBe(3);
});
