import { expect, test } from "bun:test";
import {
  finiteWorkspaceOutput,
  inspectProductionWorkspace,
} from "../scripts/inspect-production-workspace";
import { createTestDatabase } from "./helpers/d1";

test("schema failure inspection projects existing timing and numeric usage without model calls", async () => {
  const db = await createTestDatabase();
  const time = new Date().toISOString();
  let calls = 0;
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls++;
    if (calls === 1)
      return Response.json({ release: "a".repeat(40), environment: "production", status: "ready" });
    if (calls === 2)
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: [
              {
                id: "synthetic-chat",
                runtime_instance_id: "synthetic-chat-1",
                kind: "chat_response",
                status: "failed",
                failure_code: "MODEL_SCHEMA_INVALID",
                attempts: 1,
                created_at: time,
                updated_at: time,
              },
            ],
          },
        ],
      });
    if (calls === 3)
      return Response.json({
        success: true,
        result: {
          output: {
            stageTimings: [
              { stage: "audit", outcome: "failed", durationMs: 2500, prompt: "private-output" },
            ],
          },
        },
      });
    if (calls === 4) {
      const query = JSON.parse(String(init?.body));
      expect(query.sql).toStartWith("SELECT ");
      expect(query.params).toEqual(["synthetic-chat"]);
      // Execute the real selector against all migrated tables, not SQL emulation.
      expect(db.sqlite.query(query.sql).all(...query.params)).toEqual([]);
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: [
              {
                attempt: 1,
                state: "final",
                transport: "response",
                maximum_output_tokens: 2400,
                output_tokens: 2400,
                providerRequestId: "private-id",
                output: "private-output",
              },
            ],
          },
        ],
      });
    }
    return Response.json({ success: true, result: {} });
  };
  try {
    const result = await inspectProductionWorkspace(
      {
        token: "private-token",
        sha: "a".repeat(40),
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      fetcher,
    );
    expect(calls).toBe(5);
    expect(result.jobs[0]?.diagnostic).toEqual({
      stageTimings: [{ stage: "audit", outcome: "failed", durationMs: 2500 }],
    });
    expect(result.jobs[0]?.schemaAttempts).toEqual([
      {
        attempt: 1,
        state: "final",
        transport: "response",
        maximum_output_tokens: 2400,
        output_tokens: 2400,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  } finally {
    db.close();
  }
});

test("preview inspection pins its own release, database and workflow without mutations", async () => {
  const calls: { url: string; body?: string }[] = [];
  const time = new Date().toISOString();
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (calls.length === 1)
      return Response.json({ release: "a".repeat(40), environment: "preview", status: "ready" });
    if (calls.length === 2)
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: [
              {
                id: "synthetic-chat",
                runtime_instance_id: "synthetic-chat-1",
                kind: "chat_response",
                status: "failed",
                failure_code: "POLICY_REJECTED",
                attempts: 1,
                created_at: time,
                updated_at: time,
              },
            ],
          },
        ],
      });
    return Response.json({
      success: true,
      result: calls.length === 3 ? { output: { policyReason: "audit_rejected" } } : {},
    });
  };
  const result = await inspectProductionWorkspace(
    {
      token: "private",
      sha: "a".repeat(40),
      workspaceId: "00000000-0000-4000-8000-000000000001",
      environment: "preview",
    },
    fetcher,
  );
  expect(calls[0]?.url).toBe("https://preview.baro.site/api/health/ready");
  expect(calls[1]?.url).toContain("d1/database/e8cdcf75-5bd8-469e-848e-f31816df4327/query");
  expect(calls[2]?.url).toContain("workflows/baro-workspace-preview/instances/synthetic-chat-1");
  expect(JSON.parse(calls[1]?.body ?? "").sql).toStartWith("SELECT ");
  expect(result.jobs[0]?.diagnostic).toEqual({ policyReason: "audit_rejected" });
  expect(result.environment).toBe("preview");
  expect(JSON.stringify(result)).not.toContain("private");
});

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
    native_transport: "response" as const,
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

test("nested telemetry messages expose only finite diagnostics and discard unrelated private fields", async () => {
  let calls = 0;
  const time = new Date().toISOString();
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls++;
    if (calls === 1)
      return Response.json({ release: "a".repeat(40), environment: "production", status: "ready" });
    if (calls === 2)
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: [
              {
                id: "native-v1-report-synthetic",
                runtime_instance_id: "native-v1-report-synthetic-1",
                kind: "report_build",
                status: "failed",
                failure_code: "STORAGE_UNAVAILABLE",
                attempts: 1,
                created_at: time,
                updated_at: time,
              },
            ],
          },
        ],
      });
    const query = JSON.parse(String(init?.body));
    expect(query.view).toBe("events");
    expect(query.limit).toBe(30);
    expect(query.parameters.view).toBeUndefined();
    return Response.json({
      success: true,
      result: {
        events: {
          events: [
            {
              source: {
                logs: [
                  {
                    message: [
                      JSON.stringify({
                        event: "file_processor_failure",
                        stage: "startup",
                        category: "port_not_ready",
                        durationMs: 500,
                        httpStatus: 503,
                        error: "private-stack",
                      }),
                    ],
                  },
                ],
              },
              $metadata: { message: "private-user-text" },
            },
          ],
        },
      },
    });
  };
  const result = await inspectProductionWorkspace(
    {
      token: "private-token",
      sha: "a".repeat(40),
      workspaceId: "00000000-0000-4000-8000-000000000001",
    },
    fetcher,
  );
  expect(result.telemetry).toMatchObject({
    status: "read",
    returnedEvents: 1,
    events: [
      {
        event: "file_processor_failure",
        stage: "startup",
        category: "port_not_ready",
        durationMs: 500,
        httpStatus: 503,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("private");
});
