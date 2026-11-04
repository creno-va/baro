import { expect, test } from "bun:test";
import {
  finiteWorkspaceOutput,
  inspectProductionWorkspace,
} from "../scripts/inspect-production-workspace";
import { createTestDatabase } from "./helpers/d1";
import { reportFixture } from "./helpers/report-fixture";

test("report revision diagnostics prove the real publication chain without exposing private fields", async () => {
  const f = await reportFixture();
  try {
    const report = await f.reports.generate(
      f.actor.ownerId,
      f.workspaceId,
      crypto.randomUUID(),
      {},
    );
    const inspect = () =>
      inspectProductionWorkspace(
        {
          token: "private-token",
          sha: "a".repeat(40),
          environment: "preview",
          workspaceId: f.workspaceId,
        },
        async (url, init) => {
          if (url.endsWith("/api/health/ready"))
            return Response.json({
              release: "a".repeat(40),
              environment: "preview",
              status: "ready",
            });
          const query = JSON.parse(String(init?.body));
          if (!query.sql) return Response.json({ success: true, result: {} });
          expect(query.sql).toStartWith("SELECT ");
          expect(query.sql).not.toMatch(/encrypted_payload|lease_token|UPDATE|INSERT|DELETE/);
          const rows = f.db.sqlite.query(query.sql).all(...query.params);
          return Response.json({
            success: true,
            result: [
              {
                success: true,
                results: rows.map((row) => ({
                  ...(row as object),
                  prompt: "private-prompt",
                  stack: "private-stack",
                })),
              },
            ],
          });
        },
        undefined,
        { revisionBoundary: true },
      );
    const before = await inspect();
    expect(before.revisionBoundary?.find((row) => row.kind === "workspace")).toMatchObject({
      revision: f.rev(),
      proof: 1,
    });
    expect(before.revisionBoundary?.find((row) => row.kind === "report")).toMatchObject({
      revision: report.revision,
      proof: 1,
    });
    expect(JSON.stringify(before)).not.toContain("private");
    f.db.sqlite
      .query("UPDATE v2_jobs SET target_revision=target_revision+1 WHERE target_id=?")
      .run(report.id);
    const after = await inspect();
    expect(after.revisionBoundary?.find((row) => row.kind === "report")?.proof).toBe(0);
  } finally {
    f.db.close();
  }
});

test.each(["intake_questions", "intake_summary", "chat_response", "file_processing"])(
  "completed %s receipts and all-history finite totals remain read-only and preserve ambiguity",
  async (kind) => {
    const db = await createTestDatabase();
    const time = new Date().toISOString();
    const queries: string[] = [];
    const receipts = [
      {
        attempt: 1,
        state: "final",
        transport: "response",
        maximum_output_tokens: 2400,
        output_tokens: 90,
      },
      {
        attempt: 1,
        state: "final",
        transport: "response",
        maximum_output_tokens: 8000,
        output_tokens: null,
      },
    ];
    const totals: NonNullable<
      Awaited<ReturnType<typeof inspectProductionWorkspace>>["modelReceipts"]
    >["byStateAndTransport"] = [
      { state: "final", transport: "response", receipts: 2 },
      { state: "prepared", transport: "not_sent", receipts: 1 },
      { state: "unknown", transport: "unknown", receipts: 1 },
      { state: "dispatched", transport: null, receipts: 1 },
    ];
    try {
      const result = await inspectProductionWorkspace(
        {
          token: "private-token",
          sha: "a".repeat(40),
          environment: "preview",
          workspaceId: "00000000-0000-4000-8000-000000000001",
        },
        async (url, init) => {
          if (url === "https://preview.baro.site/api/health/ready")
            return Response.json({
              release: "a".repeat(40),
              environment: "preview",
              status: "ready",
            });
          expect(url).toStartWith("https://api.cloudflare.com/client/v4/accounts/");
          const query = init?.body ? JSON.parse(String(init.body)) : null;
          if (!query?.sql) return Response.json({ success: true, result: {} });
          queries.push(query.sql);
          expect(query.sql).toStartWith("SELECT ");
          expect(query.sql).not.toMatch(/encrypted|owner_id|lease_token|UPDATE|INSERT|DELETE/);
          expect(query.params).toEqual([
            query.sql.startsWith("SELECT a.attempt,")
              ? "synthetic-completed"
              : "00000000-0000-4000-8000-000000000001",
          ]);
          // Every selector executes against the real migrated schema. The API
          // envelopes below independently test finite projection, not real IO.
          expect(db.sqlite.query(query.sql).all(...query.params)).toEqual([]);
          const rows = query.sql.includes("COUNT(*)")
            ? totals.map((r) => ({ ...r, token: "private-token", prompt: "private-prompt" }))
            : query.sql.startsWith("SELECT a.attempt,")
              ? receipts.map((r) => ({
                  ...r,
                  output: "private-output",
                  providerRequestId: "private-id",
                }))
              : [
                  {
                    id: "synthetic-completed",
                    runtime_instance_id: "synthetic-completed-1",
                    kind,
                    status: "completed",
                    failure_code: null,
                    attempts: 1,
                    created_at: time,
                    updated_at: time,
                  },
                ];
          return Response.json({ success: true, result: [{ success: true, results: rows }] });
        },
        undefined,
        { completedModelReceipts: true },
      );
      expect(result.jobs[0]?.modelAttempts).toEqual(receipts);
      expect(result.jobs[0]?.policyAttempts).toBeUndefined();
      expect(result.jobs[0]?.schemaAttempts).toBeUndefined();
      expect(result.modelReceipts).toEqual({
        scope: "all_workspace_model_admissions",
        receiptCount: 5,
        byStateAndTransport: totals,
        recentJobWindow: 12,
        attemptsPerJobWindow: 12,
      });
      expect(queries).toHaveLength(3);
      const aggregate = queries.find((sql) => sql.includes("COUNT(*)")) ?? "";
      expect(aggregate).toContain("j.workspace_id=? AND a.service='model'");
      expect(aggregate).toContain("GROUP BY a.state,a.transport LIMIT 20");
      expect(JSON.stringify(result)).not.toContain("private");
    } finally {
      db.close();
    }
  },
);

test("analysis inspection keeps only stage/reason and finite audit evidence", () => {
  const result = finiteWorkspaceOutput({
    analysisFailure: {
      stage: "audit",
      reason: "audit_rejected",
      draft: "private-draft",
      token: "secret",
      auditFailure: {
        pass: false,
        legalClaimsSupported: false,
        strategyDetected: false,
        unsupportedFactCount: 1,
        unsupportedFactIds: ["private-id"],
        findings: [
          {
            severity: "critical",
            code: "unsupported_legal_claim",
            target: "source_claim",
            basis: "verified_source",
            sourceClaimReason: "quotation_text_or_span_mismatch",
            text: "private-text",
          },
        ],
      },
    },
  });
  expect(result?.analysisFailure).toMatchObject({ stage: "audit", reason: "audit_rejected" });
  expect(
    finiteWorkspaceOutput({
      analysisFailure: {
        stage: "audit",
        reason: "audit_rejected",
        auditFailure: {
          pass: false,
          legalClaimsSupported: false,
          strategyDetected: false,
          unsupportedFactCount: 0,
          findings: [
            {
              severity: "critical",
              code: "unsupported_legal_claim",
              target: "source_claim",
              basis: "verified_source",
              sourceClaimReason: "source_semantics_mismatch",
            },
          ],
        },
      },
    })?.analysisFailure?.auditFailure?.findings,
  ).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/private|secret|token|draft|unsupportedFactIds/);
  expect(
    finiteWorkspaceOutput({
      analysisFailure: { stage: "private-stage", reason: "audit_rejected" },
    }),
  ).toEqual({});
});

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
    if (calls.length === 4)
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
                output_tokens: 1200,
                providerRequestId: "private-id",
                output: "private-output",
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
  expect(calls[1]?.url).toContain("d1/database/c1612b14-6ab1-4d2e-82dc-33e596b31337/query");
  expect(calls[2]?.url).toContain("workflows/baro-workspace-preview/instances/synthetic-chat-1");
  expect(JSON.parse(calls[1]?.body ?? "").sql).toStartWith("SELECT ");
  expect(result.jobs[0]?.diagnostic).toEqual({ policyReason: "audit_rejected" });
  expect(result.jobs[0]?.policyAttempts).toEqual([
    {
      attempt: 1,
      state: "final",
      transport: "response",
      maximum_output_tokens: 2400,
      output_tokens: 1200,
    },
  ]);
  expect(result.jobs[0]?.schemaAttempts).toBeUndefined();
  expect(result.environment).toBe("preview");
  expect(JSON.stringify(result)).not.toContain("private");
});

test("policy receipts preserve absent, not-sent and unknown observations without inferring refusal", async () => {
  const time = new Date().toISOString();
  for (const receipts of [
    [],
    [{ attempt: 1, state: "prepared", transport: "not_sent" }],
    [{ attempt: 1, state: "unknown", transport: "unknown" }],
  ]) {
    const rows = receipts.map((row) => ({
      ...row,
      maximum_output_tokens: null,
      output_tokens: null,
    }));
    const queries: string[] = [];
    const result = await inspectProductionWorkspace(
      {
        token: "private",
        sha: "a".repeat(40),
        workspaceId: "00000000-0000-4000-8000-000000000001",
        environment: "preview",
      },
      async (url, init) => {
        if (url === "https://preview.baro.site/api/health/ready")
          return Response.json({
            release: "a".repeat(40),
            environment: "preview",
            status: "ready",
          });
        expect(url).toStartWith("https://api.cloudflare.com/client/v4/");
        const query = init?.body ? JSON.parse(String(init.body)) : null;
        if (query?.sql) {
          queries.push(query.sql);
          return Response.json({
            success: true,
            result: [
              {
                success: true,
                results: query.sql.startsWith("SELECT a.attempt,")
                  ? rows
                  : [
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
        }
        return Response.json({ success: true, result: {} });
      },
    );
    expect(result.jobs[0]?.policyAttempts).toEqual(rows);
    expect(result.jobs[0]?.failure_code).toBe("POLICY_REJECTED");
    expect(queries).toHaveLength(2);
    expect(queries.every((sql) => sql.startsWith("SELECT "))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
  }
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
