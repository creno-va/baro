import { afterEach, expect, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { inspectAiPreflight } from "../scripts/ai-preflight";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { usageDateKst } from "../src/server/db/repository";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { inspectAiConfiguration } from "../src/server/runtime/ai-configuration";
import { createTestDatabase } from "./helpers/d1";

const sha = "a".repeat(40),
  secret = "NEVER-EXPORT-PRIVATE-CREDENTIAL";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture() {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  databases.push(preview, production);
  const now = new Date().toISOString();
  const observed = observationSchema.parse({
    ...observation,
    checkedAt: now,
    validUntil: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    fx: { ...observation.fx, asOf: now },
  });
  const provisioned = await provisionAiRuntime(
    { preview: preview.binding, production: production.binding },
    observed,
  );
  const bindings: Record<string, unknown>[] = [
    ...Object.entries({
      APP_ENV: "preview",
      AI_GATEWAY_ID: "baro-preview",
      BETTER_AUTH_URL: "https://preview.baro.site",
      RELEASE_SHA: sha,
      MONTHLY_BUDGET_CAP_ENABLED: "false",
      AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observed, provisioned.evidenceHash)),
    }).map(([name, text]) => ({ name, type: "plain_text", text })),
    { name: "DB", type: "d1", id: "e8cdcf75-5bd8-469e-848e-f31816df4327" },
    { name: "AI", type: "ai" },
    ...[
      "WORKSPACE_PROCESSING",
      "ANALYSIS_WORKFLOW",
      "FILE_PROCESSING",
      "ASSET_PROCESSING",
      "PROFILE_PUBLICATION",
    ].map((name) => ({ name, type: "workflow" })),
    ...["CASE_PRIVATE_R2", "PROFILE_PUBLIC_R2"].map((name) => ({ name, type: "r2_bucket" })),
    { name: "FILE_PROCESSOR", type: "durable_object_namespace" },
    ...["CASE_DATA_KEY_V1", "BETTER_AUTH_SECRET", "LAW_API_OC", "TURNSTILE_SECRET_KEY"].map(
      (name) => ({ name, type: "secret_text", text: secret }),
    ),
  ];
  const queries: string[] = [];
  const database = {
    prepare(sql: string) {
      expect(sql).toMatch(/^\s*SELECT\b/i);
      queries.push(sql);
      return preview.binding.prepare(sql);
    },
  } as D1Database;
  const fetcher = (async (url, init) => {
    expect(init?.method).toBe("GET");
    if (String(url).endsWith("/ai-configuration")) {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      const text = (name: string) => bindings.find((b) => b.name === name)?.text;
      const bounds = bindings.find((b) => b.name === "AI_MODEL_TOKEN_BOUNDS_JSON");
      const forbidden = async () => {
        throw new Error("Unexpected external call");
      };
      const receipt = await inspectAiConfiguration(
        {
          APP_ENV: text("APP_ENV"),
          RELEASE_SHA: text("RELEASE_SHA"),
          AI_GATEWAY_ID: text("AI_GATEWAY_ID"),
          AI_MODEL_TOKEN_BOUNDS_JSON:
            bounds?.type === "secret_text"
              ? JSON.stringify(modelBounds(observed, provisioned.evidenceHash))
              : bounds?.text,
          CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
          AI: { run: forbidden },
          WORKSPACE_PROCESSING: { create: forbidden, get: forbidden },
          ANALYSIS_ACCOUNT_LIMIT: { limit: forbidden },
          CASE_ACCOUNT_LIMIT: { limit: forbidden },
          CASE_IP_LIMIT: { limit: forbidden },
        } as unknown as Env,
        now,
      );
      return Response.json(receipt, { status: receipt.status === "ready" ? 200 : 503 });
    }
    return Response.json({ success: true, result: { bindings, secret } });
  }) as typeof fetch;
  const input = {
    token: secret,
    environment: "preview" as const,
    candidateSha: sha,
    now,
    fetcher,
    database,
  };
  return { preview, bindings, input, queries, observed };
}

test("text readiness uses real pricing/funding/allocation readers and issues only SELECTs", async () => {
  const f = await fixture();
  const before = f.preview.sqlite.query("SELECT total_changes() AS n").get();
  const report = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(report.status).toBe("configuration_ready");
  expect(report.blockers).toEqual([]);
  expect(report.budgetGroups.model).toEqual({ available: true, missingSkus: [] });
  expect(report.unverified).toContain("live-provider-success");
  expect(f.queries.length).toBeGreaterThan(5);
  expect(f.preview.sqlite.query("SELECT total_changes() AS n").get()).toEqual(before);
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(JSON.stringify(report)).not.toContain("payload_json");
});

test("the remote D1 transport sends only SELECT batches and exports no raw rows", async () => {
  const f = await fixture();
  let queries = 0;
  const fetcher = (async (url, init) => {
    if (init?.method === "GET") return f.input.fetcher(url, init);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as { batch: { sql: string; params: unknown[] }[] };
    const result = [];
    for (const statement of body.batch) {
      expect(statement.sql).toMatch(/^\s*SELECT\b/i);
      queries++;
      result.push(
        await f.preview.binding
          .prepare(statement.sql)
          .bind(...statement.params)
          .all(),
      );
    }
    return Response.json({ success: true, result });
  }) as typeof fetch;
  const { database: _database, ...input } = f.input;
  const report = await inspectAiPreflight({ ...input, scope: "text", fetcher });
  expect(report.status).toBe("configuration_ready");
  expect(queries).toBeGreaterThan(5);
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(JSON.stringify(report)).not.toContain("payload_json");
});

test("default all scope never labels model-only proofs or unwired legacy/media as ready", async () => {
  const f = await fixture(),
    report = await inspectAiPreflight(f.input);
  expect(report.status).toBe("blocked");
  expect(report.scope).toBe("all");
  expect(report.budgetGroups.processing?.missingSkus).toContain("container_cpu_seconds");
  expect(report.budgetGroups.asr?.missingSkus).toEqual(["asr_seconds"]);
  expect(report.budgetGroups.storage?.missingSkus).toContain("r2_storage_gb_months");
  expect(report.blockers).toContain("legacy_analysis_attempt_ledger_wired");
  expect(report.blockers).toContain("media_storage_vision_metering_wired");
});

test("hidden bounds require runtime attestation and malformed plaintext cannot pass", async () => {
  const f = await fixture(),
    bounds = f.bindings.find((b) => b.name === "AI_MODEL_TOKEN_BOUNDS_JSON");
  if (!bounds) throw new Error("Missing fixture bounds");
  bounds.text = secret;
  const invalid = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(invalid.blockers).toContain("model_bounds_valid");
  const undersized = modelBounds(f.observed, "a".repeat(64));
  bounds.text = JSON.stringify({
    ...undersized,
    bounds: { ...undersized.bounds, modelOutputTokenLimit: 1 },
  });
  expect((await inspectAiPreflight({ ...f.input, scope: "text" })).blockers).toContain(
    "runtime_configuration_attested",
  );
  bounds.text = secret;
  bounds.type = "secret_text";
  const hidden = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(hidden.checks.model_bounds).toBe("secret_present");
  expect(hidden.checks.runtime_configuration_attested).toBe(true);
  expect(hidden.checks.model_reservation_headroom).toBe(true);
  expect(JSON.stringify([invalid, hidden])).not.toContain(secret);
});

test("missing, stale-release, foreign-environment and incomplete runtime receipts fail closed", async () => {
  const f = await fixture();
  const bounds = f.bindings.find((b) => b.name === "AI_MODEL_TOKEN_BOUNDS_JSON");
  if (bounds) bounds.type = "secret_text";
  for (const failure of ["missing", "release", "environment", "phases"]) {
    const fetcher = (async (url, init) => {
      const response = await f.input.fetcher(url, init);
      if (!String(url).endsWith("/ai-configuration")) return response;
      if (failure === "missing") return new Response(secret, { status: 404 });
      const receipt = (await response.json()) as {
        release: string;
        environment: string;
        reservations: unknown[];
      };
      if (failure === "release") receipt.release = "b".repeat(40);
      if (failure === "environment") receipt.environment = "production";
      if (failure === "phases") receipt.reservations[1] = receipt.reservations[0];
      return Response.json(receipt);
    }) as typeof fetch;
    const report = await inspectAiPreflight({ ...f.input, scope: "text", fetcher });
    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("runtime_configuration_attested");
    expect(report.unverified).toContain("per-invocation-reservation-headroom");
    expect(JSON.stringify(report)).not.toContain(secret);
  }
});

test("positive remaining credit or cap below the real phase reservation is not ready", async () => {
  const f = await fixture();
  const proof = f.preview.sqlite
    .query("SELECT payload_json FROM v2_runtime_proofs WHERE kind='funding'")
    .get() as { payload_json: string };
  const allowance = JSON.parse(proof.payload_json).spendAllowanceKrw as number;
  for (const remaining of [1, 100]) {
    f.preview.sqlite.query("UPDATE v2_monthly_budget SET settled_krw=?").run(allowance - remaining);
    const report = await inspectAiPreflight({ ...f.input, scope: "text" });
    expect(report.checks.model_paid_available).toBe(true);
    expect(report.blockers).toContain("model_reservation_headroom");
  }
  f.preview.sqlite.exec("UPDATE v2_monthly_budget SET settled_krw=0,limit_krw=100");
  const cap = f.bindings.find((b) => b.name === "MONTHLY_BUDGET_CAP_ENABLED");
  if (cap) cap.text = "true";
  const report = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(report.checks.model_paid_available).toBe(true);
  expect(report.blockers).toContain("model_reservation_headroom");
});

test("the deployed budget cap setting determines whether a full allocation can admit work", async () => {
  const f = await fixture();
  f.preview.sqlite.exec("UPDATE v2_monthly_budget SET limit_krw=0");
  expect(
    (await inspectAiPreflight({ ...f.input, scope: "text" })).checks.model_paid_available,
  ).toBe(true);
  const cap = f.bindings.find((b) => b.name === "MONTHLY_BUDGET_CAP_ENABLED");
  if (!cap) throw new Error("Missing fixture cap setting");
  cap.text = "true";
  expect((await inspectAiPreflight({ ...f.input, scope: "text" })).blockers).toContain(
    "model_paid_available",
  );
});

test("settings, schema, release and dependency failures are sanitized blockers", async () => {
  const f = await fixture();
  f.bindings.splice(
    f.bindings.findIndex((b) => b.name === "AI"),
    1,
  );
  const release = f.bindings.find((b) => b.name === "RELEASE_SHA");
  if (release) release.text = secret;
  f.preview.sqlite.query("UPDATE app_metadata SET value=? WHERE key='schema_version'").run(secret);
  const report = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(report.blockers).toContain("binding_AI");
  expect(report.blockers).toContain("release_matches");
  expect(report.blockers).toContain("schema_matches");
  expect(JSON.stringify(report)).not.toContain(secret);
  const unavailable = await inspectAiPreflight({
    ...f.input,
    scope: "text",
    fetcher: (async () => new Response(secret, { status: 403 })) as unknown as typeof fetch,
    database: {
      prepare() {
        throw new Error(secret);
      },
    } as unknown as D1Database,
  });
  expect(unavailable.blockers).toContain("worker_metadata_available");
  expect(unavailable.blockers).toContain("database_read_available");
  expect(JSON.stringify(unavailable)).not.toContain(secret);
});

test("proof tampering, exhausted funding and frozen controls fail without changing state", async () => {
  const f = await fixture();
  // Simulate damaged/restored evidence in this isolated in-memory fixture only.
  f.preview.sqlite.exec("DROP TRIGGER v2_runtime_proofs_update_immutable");
  const row = f.preview.sqlite
    .query("SELECT id,payload_json FROM v2_runtime_proofs WHERE kind='funding'")
    .get() as { id: string; payload_json: string };
  const payload = { ...JSON.parse(row.payload_json), spendAllowanceKrw: 1 };
  f.preview.sqlite
    .query("UPDATE v2_runtime_proofs SET payload_json=?,digest=? WHERE id=?")
    .run(JSON.stringify(payload), await runtimeDigest(payload), row.id);
  f.preview.sqlite.exec("UPDATE v2_monthly_budget SET settled_krw=1");
  expect((await inspectAiPreflight({ ...f.input, scope: "text" })).blockers).toContain(
    "model_paid_available",
  );
  f.preview.sqlite.exec("UPDATE v2_monthly_budget SET settled_krw=0");
  f.preview.sqlite
    .query("UPDATE v2_runtime_proofs SET digest=? WHERE kind='pricing'")
    .run("b".repeat(64));
  expect((await inspectAiPreflight({ ...f.input, scope: "text" })).blockers).toContain(
    "model_paid_available",
  );
  f.preview.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
  expect((await inspectAiPreflight({ ...f.input, scope: "text" })).blockers).toContain(
    "current_month_active",
  );
});

test("bounds and paid proof expiry inside a five-minute job horizon block admission", async () => {
  const f = await fixture(),
    bounds = f.bindings.find((b) => b.name === "AI_MODEL_TOKEN_BOUNDS_JSON");
  if (!bounds) throw new Error("Missing fixture bounds");
  // Move the fixture proof's expiry without relaxing the inspected read-only adapter.
  f.preview.sqlite.exec("DROP TRIGGER v2_runtime_proofs_update_immutable");
  const parsed = JSON.parse(String(bounds.text));
  parsed.bounds.validUntil = new Date(Date.parse(f.input.now) + 4 * 60_000).toISOString();
  bounds.text = JSON.stringify(parsed);
  const proof = f.preview.sqlite
    .query("SELECT id,payload_json FROM v2_runtime_proofs WHERE kind='funding'")
    .get() as { id: string; payload_json: string };
  const payload = { ...JSON.parse(proof.payload_json), validUntil: parsed.bounds.validUntil };
  f.preview.sqlite
    .query("UPDATE v2_runtime_proofs SET payload_json=?,digest=?,valid_until=? WHERE id=?")
    .run(JSON.stringify(payload), await runtimeDigest(payload), payload.validUntil, proof.id);
  const report = await inspectAiPreflight({ ...f.input, scope: "text" });
  expect(report.blockers).toContain("model_bounds_five_minute_horizon");
  expect(report.blockers).toContain("model_five_minute_horizon");
  expect(report.warnings).toContain("model_expires_within_seven_days");
});

test("KST month rollover requires the next active allocation before the job horizon", async () => {
  const f = await fixture();
  const [year, month] = usageDateKst(f.input.now).slice(0, 7).split("-").map(Number);
  const boundary = Date.UTC(year as number, month as number, 1) - 9 * 3_600_000;
  const report = await inspectAiPreflight({
    ...f.input,
    scope: "text",
    now: new Date(boundary - 60_000).toISOString(),
  });
  expect(report.checks.current_month_active).toBe(true);
  expect(report.warnings).toContain("kst_month_rollover_requires_verified_allocation");
  expect(report.blockers).toContain("next_month_active_before_horizon");
  const next = await inspectAiPreflight({
    ...f.input,
    scope: "text",
    now: new Date(boundary).toISOString(),
  });
  expect(next.blockers).toContain("current_month_active");
});
