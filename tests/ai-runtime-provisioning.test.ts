import { expect, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { remoteBudgetD1 } from "../scripts/remote-budget-d1";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies } from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

test("a fresh customer can admit their first text-only AI job without a prior file upload", async () => {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  try {
    const now = new Date().toISOString();
    const o = observationSchema.parse({
      ...observation,
      checkedAt: now,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    });
    const result = await provisionAiRuntime(
      { preview: preview.binding, production: production.binding },
      o,
    );
    const owner = await seedTestSession(preview, { consent: true });
    const core = createV2Core(
      preview.binding,
      await createCaseDataCipher({
        CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
      }),
      { monthlyBudgetCapEnabled: false },
    );
    const env = {
      APP_ENV: "preview",
      DB: preview.binding,
      AI: {},
      WORKSPACE_PROCESSING: {},
      AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(o, result.evidenceHash)),
    } as unknown as Env;
    const dependencies = createWorkspaceDependencies(core, env);
    const service = createWorkspaceService(core, {
      ...dependencies,
      dispatch: async () => undefined,
    });
    const workspace = await service.create(owner.userId, crypto.randomUUID(), {
      narrative: "합성 계약 자료의 거래 날짜를 확인하고 상담을 준비하려고 합니다.",
      jurisdiction: "KR",
      subjectContext: "individual",
      turnstileToken: "synthetic",
    });
    expect(preview.sqlite.query("SELECT count(*) AS n FROM v2_billing_principals").get()).toEqual({
      n: 0,
    });
    const unconfigured = createWorkspaceService(core, {
      ...createWorkspaceDependencies(core, { ...env, AI_MODEL_TOKEN_BOUNDS_JSON: "" }),
      dispatch: async () => undefined,
    });
    await expect(
      unconfigured.advance(owner.userId, workspace.id, crypto.randomUUID(), {
        expectedRevision: workspace.workspaceRevision,
      }),
    ).rejects.toThrow("BUDGET_UNAVAILABLE");
    expect(preview.sqlite.query("SELECT count(*) AS n FROM v2_billing_principals").get()).toEqual({
      n: 0,
    });
    const admitted = await service.advance(owner.userId, workspace.id, crypto.randomUUID(), {
      expectedRevision: workspace.workspaceRevision,
    });
    expect(admitted.status).toBe("queued");
    expect(preview.sqlite.query("SELECT count(*) AS n FROM v2_billing_principals").get()).toEqual({
      n: 1,
    });
    expect(
      preview.sqlite
        .query("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='reserved'")
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    preview.close();
    production.close();
  }
});

test("two real migrated databases activate from authenticated zero observations and exchange actual drains", async () => {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  try {
    const now = new Date().toISOString();
    const o = {
      ...observation,
      checkedAt: now,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    };
    const result = await provisionAiRuntime(
      { preview: preview.binding, production: production.binding },
      o,
    );
    expect(result.bootstrap).toBe(true);
    for (const db of [preview, production]) {
      expect(db.sqlite.query("SELECT phase FROM v2_runtime_controls").get()).toEqual({
        phase: "active",
      });
      expect(db.sqlite.query("SELECT count(*) AS n FROM v2_runtime_drains").get()).toEqual({
        n: 1,
      });
      expect(
        db.sqlite.query("SELECT count(*) AS n FROM v2_runtime_proofs WHERE kind='drain'").get(),
      ).toEqual({ n: 2 });
      expect(
        db.sqlite
          .query(
            "SELECT json_extract(payload_json,'$.autoRecharge') AS enabled FROM v2_runtime_proofs WHERE kind='funding'",
          )
          .get(),
      ).toEqual({ enabled: 1 });
      expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    }
    // Legacy allocation metadata must not become a cap again during refresh.
    preview.sqlite.exec("UPDATE v2_monthly_budget SET settled_krw=2000000");
    production.sqlite.exec("UPDATE v2_monthly_budget SET settled_krw=3000000");
    const refreshed = await provisionAiRuntime(
      { preview: preview.binding, production: production.binding },
      o,
    );
    expect(refreshed.bootstrap).toBe(false);
    expect(refreshed.version).toBe(2);
    preview.sqlite.exec("UPDATE v2_monthly_budget SET ambiguous_krw=1");
    await expect(
      provisionAiRuntime({ preview: preview.binding, production: production.binding }, o),
    ).rejects.toThrow("AI_RUNTIME_DRAIN_REQUIRED");
  } finally {
    preview.close();
    production.close();
  }
});

test("stale or unapproved funding cannot initialize either database", async () => {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  try {
    await expect(
      provisionAiRuntime(
        { preview: preview.binding, production: production.binding },
        { ...observation, checkedAt: "2026-01-01T00:00:00Z" },
      ),
    ).rejects.toThrow("AI_RUNTIME_OBSERVATION_STALE");
    await expect(
      provisionAiRuntime(
        { preview: preview.binding, production: production.binding },
        { ...observation, autoRecharge: false },
      ),
    ).rejects.toThrow();
    expect(preview.sqlite.query("SELECT count(*) AS n FROM v2_budget_allocations").get()).toEqual({
      n: 0,
    });
  } finally {
    preview.close();
    production.close();
  }
});

test("model capability bounds cover the maximum product output without replacing the agreed model", () => {
  const bounds = modelBounds(observationSchema.parse(observation), "a".repeat(64)).bounds;
  expect(bounds.modelInputTokenLimit).toBe(bounds.modelContextTokenLimit);
  expect(bounds.modelOutputTokenLimit).toBe(128000);
});

test("authenticated API adapter uses one parameterized batch and refuses partial or failed responses", async () => {
  const bodies: unknown[] = [];
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json({
      success: true,
      result: [
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [{ value: 3 }], meta: { changes: 0 } },
      ],
    });
  }) as typeof fetch;
  const db = remoteBudgetD1("synthetic-test-token", "test-account", "test-database", fetcher);
  const statements = [
    db.prepare("INSERT INTO x VALUES (?)").bind(1),
    db.prepare("SELECT ? AS value").bind(3),
  ];
  expect((await db.batch(statements)).map((r) => r.meta.changes)).toEqual([1, 0]);
  expect(bodies).toEqual([
    {
      batch: [
        { sql: "INSERT INTO x VALUES (?)", params: [1] },
        { sql: "SELECT ? AS value", params: [3] },
      ],
    },
  ]);
  await expect(db.prepare("SELECT 1").run()).rejects.toThrow("AI_RUNTIME_D1_INVALID_RESPONSE");
});
