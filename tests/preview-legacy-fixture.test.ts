import { expect, test } from "bun:test";
import {
  legacyFixtureEffectiveMode,
  legacyFixtureReceipt,
  preparePreviewLegacyFixture,
  verifyLegacyFixtureConfiguration,
} from "../scripts/preview-legacy-fixture";
import { modelBounds } from "../scripts/provision-ai-budget";
import { saveAccountType } from "../src/server/auth/account-type";
import { quotaPredicate } from "../src/server/db/v2-accounting";
import { reconcileDispatch } from "../src/server/modules/dispatch/service";
import { domainRepository } from "../src/server/modules/intake/service";
import { createLegalRetrieval } from "../src/server/modules/legal-retrieval/service";
import {
  createLegacyAnalysisRuntime,
  LEGACY_ANALYSIS_PHASES,
} from "../src/server/runtime/analysis";
import { guidance } from "./fixtures/contracts";
import lawList from "./fixtures/legal/official-list.json";
import lawDetail from "./fixtures/legal/official-sample.json";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { previewCustomerFixture } from "./preview-customer-fixture.test";

const NOW = "2026-10-15T01:00:00.000Z";
async function fixture() {
  const f = await previewCustomerFixture();
  const prepare = (options: Partial<Parameters<typeof preparePreviewLegacyFixture>[0]> = {}) =>
    preparePreviewLegacyFixture({
      db: f.db.binding,
      cipher: f.cipher,
      mode: "create",
      now: NOW,
      verifyAtomicity: async () => true,
      ...options,
    });
  return { ...f, prepareLegacy: prepare };
}

test("status reads no unrelated case and writes nothing before one fixed creation", async () => {
  const f = await fixture(),
    before = f.changes();
  expect((await f.prepareLegacy({ mode: "status" })).status).toBe("absent");
  expect(f.changes()).toBe(before);
  const first = await f.prepareLegacy();
  expect(first.status).toBe("prepared");
  expect(first.modelExecutionVerified).toBe(false);
  expect(first.analysisStatus).toBe("queued");
  expect(f.n("cases")).toBe(1);
  expect(f.n("analyses")).toBe(1);
  expect(f.n("dispatch_outbox")).toBe(1);
  expect(f.n("v2_workspaces")).toBe(0);
  expect(
    f.db.sqlite
      .query("SELECT responses_used,responses_reserved,cases_used FROM v2_daily_usage")
      .get(),
  ).toEqual({ responses_used: 0, responses_reserved: 0, cases_used: 1 });
  const rows = f.db.sqlite
    .query(
      "SELECT c.id,c.encrypted_input,c.user_id,c.current_analysis_id,a.workflow_instance_id FROM cases c JOIN analyses a ON a.id=c.current_analysis_id",
    )
    .get() as {
    id: string;
    encrypted_input: string;
    user_id: string;
    current_analysis_id: string;
    workflow_instance_id: string;
  };
  expect(rows.user_id).toBe(f.owner.userId);
  expect(rows.workflow_instance_id).toBe(`${rows.current_analysis_id}-1`);
  const original = await f.cipher.decrypt(rows.encrypted_input, {
    table: "cases",
    column: "encrypted_input",
    rowId: rows.id,
    userId: rows.user_id,
  });
  expect(JSON.parse(original).narrative).toContain("실제 사람이나 계약은 없습니다");
  const unchanged = f.changes();
  expect((await f.prepareLegacy()).status).toBe("present");
  expect((await f.prepareLegacy({ mode: "status" })).status).toBe("present");
  expect(f.changes()).toBe(unchanged);
});

test("concurrent creators produce exactly one case, outbox and new-case debit", async () => {
  const f = await fixture();
  const outcomes = await Promise.all([f.prepareLegacy(), f.prepareLegacy()]);
  expect(outcomes.filter((v) => v.status === "prepared")).toHaveLength(1);
  expect(f.n("cases")).toBe(1);
  expect(f.n("analyses")).toBe(1);
  expect(f.n("dispatch_outbox")).toBe(1);
  expect(f.db.sqlite.query("SELECT cases_used FROM v2_daily_usage").get()).toEqual({
    cases_used: 1,
  });
  expect(f.db.sqlite.query("SELECT analysis_count FROM daily_usage").get()).toEqual({
    analysis_count: 1,
  });
});

test("the seeded outbox reaches the actual retained runtime and recorded publication with synthetic adapters", async () => {
  const f = await fixture();
  expect((await f.prepareLegacy()).status).toBe("prepared");
  const source = f.db.sqlite.query("SELECT id,encrypted_input FROM cases").get() as {
    id: string;
    encrypted_input: string;
  };
  const narrative = JSON.parse(
    await f.cipher.decrypt(source.encrypted_input, {
      table: "cases",
      column: "encrypted_input",
      rowId: source.id,
      userId: f.owner.userId,
    }),
  ).narrative;
  const calls: string[] = [],
    background: Promise<void>[] = [];
  const env = {
    ...f.owner.env,
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("q".repeat(32)).replace(/=+$/, ""),
    AI_GATEWAY_ID: "synthetic",
    LAW_API_OC: "synthetic",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observation, "a".repeat(64))),
    AI: {
      run: async (_model: string, input: Record<string, unknown>) => {
        const { phase, data } = syntheticGatewayInput(input);
        calls.push(phase);
        let output: unknown;
        if (phase === "minimize")
          output = { schemaVersion: "1", sentences: [narrative], maskingHints: [] };
        if (phase === "screening")
          output = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
        if (phase === "structure")
          output = {
            schemaVersion: "1",
            parties: [],
            amounts: [],
            dates: [],
            agreements: [],
            performance: [],
            evidence: [],
            unknowns: [],
          };
        if (phase === "generation")
          output = {
            ...guidance,
            asOfDate: data.asOfDate,
            summary: { ...guidance.summary, userStatements: [narrative] },
            citations: data.retrieval.chunks.map((c: { citation: unknown }) => c.citation),
            issues: guidance.issues.map((i) => ({
              ...i,
              citationIds: [data.retrieval.chunks[0].citation.id],
            })),
          };
        if (phase === "validation")
          output = { schemaVersion: "1", pass: true, sanitizedResult: data.draft, findings: [] };
        return {
          choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        };
      },
    },
  } as unknown as Env;
  const legal = createLegalRetrieval(
    env,
    await domainRepository(env),
    async (url) => Response.json(url.includes("lawSearch") ? lawList : lawDetail),
    async () => {},
  );
  let workflowError: unknown;
  env.ANALYSIS_WORKFLOW = {
    create: async (request: {
      id: string;
      params: { analysisId: string; inputRevision: number };
    }) => {
      let runtime: Awaited<ReturnType<typeof createLegacyAnalysisRuntime>>;
      try {
        runtime = await createLegacyAnalysisRuntime(env, request.params, request.id, {
          retrieval: legal,
          waitUntil: (work) => {
            background.push(work);
          },
        });
      } catch (error) {
        workflowError = error;
        throw error;
      }
      for (const phase of LEGACY_ANALYSIS_PHASES) {
        const result = await runtime.phase(phase);
        if (["failed", "stopped", "completed", "waiting_for_answers"].includes(result.status))
          break;
      }
      return { id: request.id };
    },
  } as unknown as Workflow;
  await reconcileDispatch(env, NOW);
  if (workflowError) throw workflowError;
  await Promise.all(background);
  const recorded = await f.prepareLegacy({ mode: "status" });
  expect(recorded.analysisStatus).toBe("completed");
  expect(recorded.outboxStatus).toBe("dispatched");
  expect(recorded.modelExecutionVerified).toBe(true);
  expect(recorded.resultKind).toBe("guidance");
  expect(calls).toEqual(["minimize", "screening", "structure", "generation", "validation"]);
  expect(
    f.db.sqlite
      .query("SELECT cases_used,responses_used,responses_reserved FROM v2_daily_usage")
      .get(),
  ).toEqual({ cases_used: 1, responses_used: 1, responses_reserved: 0 });
  const before = f.changes();
  expect((await f.prepareLegacy()).status).toBe("present");
  expect(f.changes()).toBe(before);
});

for (const kind of ["v2", "legacy"] as const) {
  test(`the shared last new-case slot includes prior ${kind} creations`, async () => {
    const f = await fixture();
    if (kind === "v2")
      f.db.sqlite
        .query("INSERT INTO v2_daily_usage(owner_id,day,cases_used) VALUES(?,'2026-10-15',2)")
        .run(f.owner.userId);
    else
      f.db.sqlite
        .query(
          "INSERT INTO daily_usage(user_id,usage_date_kst,analysis_count,updated_at) VALUES(?,'2026-10-15',2,?)",
        )
        .run(f.owner.userId, NOW);
    expect((await f.prepareLegacy()).status).toBe("prepared");
    expect(f.db.sqlite.query("SELECT cases_used FROM v2_daily_usage").get()).toEqual({
      cases_used: 3,
    });
    const quota = quotaPredicate({ kind: "new_case", units: 1 }, f.owner.userId, "2026-10-15");
    expect(
      await f.db.binding
        .prepare(`SELECT 1 WHERE ${quota.sql}`)
        .bind(...quota.values)
        .first(),
    ).toBeNull();
  });
}

test("a full day rejects creation before the atomicity probe", async () => {
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO v2_daily_usage(owner_id,day,cases_used) VALUES(?,'2026-10-15',3)")
    .run(f.owner.userId);
  let probes = 0;
  expect(
    (
      await f.prepareLegacy({
        verifyAtomicity: async () => {
          probes++;
          return true;
        },
      })
    ).code,
  ).toBe("ACCESS_OR_QUOTA_REJECTED");
  expect(probes).toBe(0);
  expect(f.n("cases")).toBe(0);
});

test("source role/consent must still hold at the atomic write", async () => {
  const f = await fixture();
  const result = await f.prepareLegacy({
    verifyAtomicity: async () => {
      await saveAccountType(f.db.binding, f.owner.userId, "lawyer");
      return true;
    },
  });
  expect(result.status).toBe("blocked");
  expect(result.code).toBe("ACCESS_OR_QUOTA_REJECTED");
  expect(f.n("cases")).toBe(0);
  expect(f.n("dispatch_outbox")).toBe(0);
  expect(f.n("v2_daily_usage")).toBe(0);
});

test("a missing marker or current consent never selects another profile", async () => {
  const wrong = await previewCustomerFixture("An unrelated profile");
  expect(
    (
      await preparePreviewLegacyFixture({
        db: wrong.db.binding,
        cipher: wrong.cipher,
        mode: "create",
        now: NOW,
        verifyAtomicity: async () => true,
      })
    ).code,
  ).toBe("SOURCE_MARKER_MISMATCH");
  expect(wrong.n("cases")).toBe(0);
  const f = await fixture();
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  expect((await f.prepareLegacy()).code).toBe("ACCESS_OR_QUOTA_REJECTED");
  expect(f.n("cases")).toBe(0);
});

test("an unproven REST batch cannot seed a case and failed batches preserve rollback", async () => {
  const f = await fixture();
  expect((await f.prepareLegacy({ verifyAtomicity: async () => false })).code).toBe(
    "ATOMICITY_NOT_PROVEN",
  );
  expect(f.n("cases")).toBe(0);
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_legacy_fixture BEFORE INSERT ON analyses BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
  );
  expect((await f.prepareLegacy()).status).toBe("unknown");
  expect(f.n("cases")).toBe(0);
  expect(f.n("v2_mutation_claims")).toBe(0);
  expect(f.n("daily_usage")).toBe(0);
  expect(
    f.db.sqlite
      .query("SELECT value FROM app_metadata WHERE key='baro-test-fixture:legacy-analysis-v1'")
      .get(),
  ).toBeNull();
});

test("a lost creation ACK becomes status-only and preserves the one queued analysis", async () => {
  const f = await fixture(),
    batch = f.db.binding.batch.bind(f.db.binding);
  f.db.binding.batch = async (...args) => {
    await batch(...args);
    throw new Error("synthetic lost ACK");
  };
  expect((await f.prepareLegacy()).status).toBe("unknown");
  f.db.binding.batch = batch;
  const before = f.changes();
  expect((await f.prepareLegacy()).status).toBe("present");
  expect(f.changes()).toBe(before);
  expect(f.n("cases")).toBe(1);
  expect(f.n("analyses")).toBe(1);
});

test("a deleted fixture retains its latch and is never recreated", async () => {
  const f = await fixture();
  await f.prepareLegacy();
  f.db.sqlite.exec("DELETE FROM cases");
  const before = f.changes();
  expect((await f.prepareLegacy()).code).toBe("FIXTURE_DELETED");
  expect(f.changes()).toBe(before);
  expect(f.n("cases")).toBe(0);
});

test("configuration and reruns cannot choose production or dispatch a new candidate fixture", async () => {
  const config = await Bun.file("wrangler.jsonc").json();
  expect(() => verifyLegacyFixtureConfiguration(config)).not.toThrow();
  config.env.preview.d1_databases[0].database_id = "not-the-preview-database";
  expect(() => verifyLegacyFixtureConfiguration(config)).toThrow();
  for (const attempt of [undefined, "", "01", "2", "3", 1])
    expect(legacyFixtureEffectiveMode("create", attempt)).toBe("status");
  expect(legacyFixtureEffectiveMode("create", "1")).toBe("create");
  const f = await fixture();
  const result = await f.prepareLegacy();
  const receipt = legacyFixtureReceipt("a".repeat(40), "create", "create", {
    ...result,
    privateOwner: f.owner.userId,
  } as typeof result);
  expect(JSON.stringify(receipt)).not.toContain(f.owner.userId);
  expect(JSON.stringify(receipt)).not.toContain("narrative");
  expect(receipt.uiCreationVerified).toBe(false);
  const invalid = legacyFixtureReceipt("PRIVATE", "PRIVATE", "PRIVATE", result);
  expect(JSON.stringify(invalid)).not.toContain("PRIVATE");
  const workflow = await Bun.file(".github/workflows/preview-legacy-fixture.yml").text();
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("github.sha == inputs.target_sha");
  expect(workflow).toContain("deployment: false");
  expect(workflow).not.toMatch(
    /schedule:|pull_request:|production_environment|source_id:|case_id:|reset:/,
  );
});
