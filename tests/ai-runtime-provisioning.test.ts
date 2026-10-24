import { expect, test } from "bun:test";
import { modelCapabilityConfiguration } from "../scripts/configure-ai-runtime";
import {
  inspectAiRuntime,
  modelBounds,
  observationSchema,
  observeAiRuntime,
  provisionAiRuntime,
} from "../scripts/provision-ai-budget";
import { remoteBudgetD1 } from "../scripts/remote-budget-d1";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies } from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import observation from "./helpers/gemini-observation";
import { seedTestSession } from "./helpers/session";

test("model capability configuration is independent of billing fields and preserves original dates", async () => {
  const original = await modelCapabilityConfiguration(observation, "2027-01-01T00:00:00.000Z");
  const changed = await modelCapabilityConfiguration(
    {
      ...observation,
      fundingState: "unavailable",
      pricing: null,
      fx: null,
      authorizedByDirectUserInstruction: false,
    },
    "2027-01-01T00:00:00.000Z",
  );
  expect(changed).toEqual(original);
  expect(changed.bounds.checkedAt).toBe(observation.checkedAt);
  expect(changed.bounds.validUntil).toBe(observation.validUntil);
  expect(changed.verifiedAt).toBe(observation.checkedAt);
  await expect(
    modelCapabilityConfiguration({ ...observation, contextTokens: 1 }),
  ).rejects.toThrow();
  await expect(
    modelCapabilityConfiguration({ ...observation, checkedAt: "2099-01-01T00:00:00.000Z" }),
  ).rejects.toThrow();
});

test("stale optional cost refresh reports its original observation without changing any ledger", async () => {
  const db = await createTestDatabase();
  try {
    const before = db.sqlite.serialize();
    const stale = {
      ...observation,
      checkedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-02-01T00:00:00.000Z",
    };
    const result = await observeAiRuntime({ preview: db.binding }, stale, "refresh");
    expect(result.costObservationState).toBe("stale");
    expect(result.observedAt).toBe(stale.checkedAt);
    expect(result.results[0]?.refreshCommitted).toBe(false);
    expect(result.results[0]?.observationInstalled).toBe(false);
    expect(db.sqlite.serialize()).toEqual(before);
  } finally {
    db.close();
  }
});

test("runtime status is read-only and exposes only the operational allowlist", async () => {
  const db = await createTestDatabase();
  try {
    await seedTestSession(db, { consent: true });
    const before = db.sqlite.serialize();
    const statements: string[] = [];
    const prepare = db.binding.prepare.bind(db.binding);
    db.binding.prepare = (sql) => {
      statements.push(sql);
      return prepare(sql);
    };
    const status = await inspectAiRuntime({ preview: db.binding });
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
    expect(db.sqlite.serialize()).toEqual(before);
    expect(status.results).toHaveLength(1);
    expect(status.results[0]?.schema).toBe("0017_legacy_analysis_journal");
    expect(Object.keys(status.results[0] ?? {}).sort()).toEqual([
      "carryover",
      "control",
      "environment",
      "executionObservations",
      "funding",
      "fundingAuthority",
      "initializationPrerequisites",
      "legacyAnalysisObservations",
      "projection",
      "schema",
    ]);
    expect(JSON.stringify(status)).not.toMatch(/email|token|payload_json|owner_id|reference/i);
  } finally {
    db.close();
  }
});

test("a fresh customer can admit their first text-only AI job without a prior file upload", async () => {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  try {
    const now = new Date().toISOString();
    const o = observationSchema.parse({
      ...observation,
      spendAllowanceKrw: 10000000,
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
      AI_GATEWAY_ID: "synthetic-gateway",
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
      spendAllowanceKrw: 10000000,
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
  expect(bounds.modelOutputTokenLimit).toBe(65536);
});

test("observations accept new balances/FX without activation; same-allocation refresh preserves holds and retries exactly once", async () => {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  try {
    const now = new Date().toISOString();
    const initial = {
      ...observation,
      checkedAt: now,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      spendAllowanceKrw: 10000000,
    };
    await provisionAiRuntime({ preview: preview.binding, production: production.binding }, initial);
    for (const db of [preview, production])
      db.sqlite.exec(
        "UPDATE v2_runtime_controls SET phase='frozen',pending_version=1,revision=revision+1",
      );
    preview.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=321,ambiguous_krw=123");
    const checkedAt = new Date().toISOString();
    const fresh = {
      ...initial,
      checkedAt,
      creditUsd: "23.75",
      fx: { ...initial.fx, krwPerUsd: "1400.25", asOf: checkedAt },
      pricing: {
        ...initial.pricing,
        fx: { ...initial.pricing.fx, krwPerUsd: "1400.25", asOf: checkedAt },
      },
    };
    const installed = await observeAiRuntime({ preview: preview.binding }, fresh, "observe");
    expect(installed.results[0]?.refreshCommitted).toBe(false);
    expect(preview.sqlite.query("SELECT phase FROM v2_runtime_controls").get()).toEqual({
      phase: "frozen",
    });
    const result = await observeAiRuntime({ preview: preview.binding }, fresh, "refresh");
    expect(result.results[0]?.control).toMatchObject({
      phase: "active",
      allocation_version: 1,
      reserved_krw: 321,
      ambiguous_krw: 123,
    });
    const saved = preview.sqlite.query("SELECT * FROM v2_runtime_refreshes").all();
    expect(saved).toHaveLength(1);
    await observeAiRuntime({ preview: preview.binding }, fresh, "refresh");
    expect(preview.sqlite.query("SELECT * FROM v2_runtime_refreshes").all()).toEqual(saved);
    expect(production.sqlite.query("SELECT phase FROM v2_runtime_controls").get()).toEqual({
      phase: "frozen",
    });
    preview.sqlite.exec(
      "UPDATE v2_runtime_controls SET phase='frozen',pending_version=1,revision=revision+1",
    );
    const replay = await observeAiRuntime({ preview: preview.binding }, fresh, "refresh");
    expect(replay.results[0]?.control?.phase).toBe("frozen");
    const next = await observeAiRuntime(
      { preview: preview.binding },
      fresh,
      "refresh",
      "separate-config-operation",
    );
    expect(next.results[0]?.control?.phase).toBe("active");
    expect(preview.sqlite.query("SELECT count(*) n FROM v2_runtime_refreshes").get()).toEqual({
      n: 2,
    });
  } finally {
    preview.close();
    production.close();
  }
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

test("a fresh funding stop is installed even when the accompanying pricing authority has expired", async () => {
  const db = await createTestDatabase();
  try {
    const now = new Date().toISOString();
    const result = await observeAiRuntime(
      { preview: db.binding },
      {
        ...observation,
        checkedAt: now,
        validUntil: new Date(Date.now() + 3600000).toISOString(),
        fundingState: "unavailable",
        spendAllowanceKrw: 0,
        pricing: { ...observation.pricing, validUntil: "2026-10-07T00:00:00Z" },
      },
      "observe",
    );
    expect(result.results[0]?.pricingInstalled).toBe(false);
    expect(
      db.sqlite
        .query(
          "SELECT json_extract(p.payload_json,'$.state') state FROM v2_storage_funding_heads h JOIN v2_runtime_proofs p ON p.id=h.proof_id",
        )
        .get(),
    ).toEqual({ state: "unavailable" });
    expect(db.sqlite.query("SELECT count(*) n FROM v2_runtime_controls").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

test("historical GPT capability cannot silently configure Gemini and old observation remains readable", async () => {
  const historical = await Bun.file("docs/operations/AI-RUNTIME-OBSERVATION.json").json();
  expect(observationSchema.parse(historical).model).toBe("openai/gpt-6-sol");
  await expect(modelCapabilityConfiguration(historical)).rejects.toThrow();
  const documented = await Bun.file("docs/operations/GEMINI-MODEL-CAPABILITY.json").json();
  const result = await modelCapabilityConfiguration(documented, "2027-01-01T00:00:00.000Z");
  expect(result.model).toBe("google/gemini-3.8-flash");
  expect(result.bounds.modelContextTokenLimit).toBe(1048576);
  expect(result.bounds.modelOutputTokenLimit).toBe(65536);
  expect(result.verifiedAt).toBe(documented.checkedAt);
});
