import { expect, spyOn, test } from "bun:test";
import { inspectAiRuntime, modelBounds } from "../scripts/provision-ai-budget";
import { caseDetailResponseSchema } from "../src/contracts";
import { api } from "../src/server/api";
import { createCaseDataCipher } from "../src/server/crypto";
import { usageDateKst } from "../src/server/db/repository";
import { MODEL_ID } from "../src/server/model-policy";
import { createLegacyAnalysisLedger } from "../src/server/modules/budget/legacy-analysis-ledger";
import {
  type GatewayAttemptRequest,
  responseReceipt,
  unavailableReceipt,
} from "../src/server/modules/llm-gateway/attempts";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import {
  createLegacyAnalysisRuntime,
  LEGACY_ANALYSIS_PHASES,
} from "../src/server/runtime/analysis";
import { analysisFixture } from "./analysis-execution.test";
import observation from "./helpers/gemini-observation";
import { seedTestSession } from "./helpers/session";

function environment(f: Awaited<ReturnType<typeof analysisFixture>>) {
  return {
    ...f.env,
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    AI_GATEWAY_ID: "synthetic-legacy",
    AI: f.binding,
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observation, "a".repeat(64))),
  } as unknown as Env;
}
async function journal() {
  const f = await analysisFixture();
  await f.execute().phase("initialize");
  const env = environment(f),
    background: Promise<void>[] = [];
  const options = {
    env,
    params: f.identity,
    instanceId: `${f.identity.analysisId}-1`,
    input: async () => ({}),
    waitUntil: (work: Promise<void>) => {
      background.push(work);
    },
  };
  const ledger = await createLegacyAnalysisLedger(options);
  const wire = prepareGatewayWireInput("screening", {});
  const request: GatewayAttemptRequest = {
    invocationId: crypto.randomUUID(),
    requestId: f.identity.analysisId,
    model: MODEL_ID,
    phase: "screening",
    attemptOrdinal: 1,
    correction: false,
    ...(await gatewayWireIdentity(wire)),
    outputTokenUpperBound: wire.max_completion_tokens,
  };
  return { ...f, env, ledger, options, request, background };
}
const receipt = () =>
  responseReceipt({
    id: "synthetic-response",
    service_tier: "default",
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  });

test("retained preview analysis completes through the actual runtime composition", async () => {
  const f = await analysisFixture();
  const env = {
    ...f.env,
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    AI_GATEWAY_ID: "synthetic-legacy",
    AI: f.binding,
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observation, "a".repeat(64))),
  } as unknown as Env;
  const settlements: Promise<void>[] = [];
  const runtime = await createLegacyAnalysisRuntime(env, f.identity, `${f.identity.analysisId}-1`, {
    waitUntil: (work) => {
      settlements.push(work);
    },
    retrieval: f.legal,
  });
  let terminal: string | undefined;
  for (const phase of LEGACY_ANALYSIS_PHASES) {
    const result = await runtime.phase(phase);
    terminal = result.status;
    if (["failed", "stopped", "waiting_for_answers"].includes(result.status)) break;
  }
  const saved = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  expect(terminal).toBe("completed");
  expect(saved?.status).toBe("completed");
  expect(f.calls).toEqual(["minimize", "screening", "structure", "generation", "validation"]);
  await Promise.all(settlements);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) AS n FROM legacy_ai_attempts WHERE state='final' AND transport='response'",
      )
      .get(),
  ).toEqual({ n: 5 });
  expect(f.db.sqlite.query("SELECT quota_state FROM legacy_ai_operations").get()).toEqual({
    quota_state: "consumed",
  });
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 1, responses_reserved: 0 });
  const response = await api.request(
    `/cases/${f.caseId}`,
    { headers: { cookie: f.session.cookie } },
    env,
  );
  expect(response.status).toBe(200);
  expect(caseDetailResponseSchema.parse(await response.json()).result?.kind).toBe("guidance");
});

test("one immutable phase ordinal wins concurrent workers and cannot be replayed after transport", async () => {
  const f = await journal();
  const other = await createLegacyAnalysisLedger(f.options);
  const winners = await Promise.all([
    f.ledger.beforeDispatch(f.request),
    other.beforeDispatch({ ...f.request, invocationId: crypto.randomUUID() }),
  ]);
  expect(winners.filter(Boolean)).toHaveLength(1);
  const winner = winners[0] ? f.ledger : other;
  const handle = winners.find(Boolean);
  if (!handle) throw new Error("NO_WINNER");
  expect(await winner.confirmDispatch(handle)).toBe(true);
  expect(await winner.confirmDispatch(handle)).toBe(false);
  await winner.afterTransport(handle, receipt());
  expect(await f.ledger.beforeDispatch(f.request)).toBeNull();
  expect(
    await other.beforeDispatch({ ...f.request, invocationId: crypto.randomUUID() }),
  ).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM legacy_ai_attempts").get()).toEqual({ n: 1 });
  expect(f.calls).toEqual([]);
});

test("wire mismatch, skipped ordinals and missing capability cannot create dispatch authority", async () => {
  const f = await journal();
  for (const request of [
    { ...f.request, wireInputSha256: "f".repeat(64) },
    { ...f.request, inputBytes: f.request.inputBytes + 1 },
    { ...f.request, outputTokenUpperBound: f.request.outputTokenUpperBound + 1 },
    { ...f.request, requestId: crypto.randomUUID() },
    { ...f.request, attemptOrdinal: 2 },
    { ...f.request, attemptOrdinal: 4 },
  ])
    expect(await f.ledger.beforeDispatch(request)).toBeNull();
  const missing = await createLegacyAnalysisLedger({
    ...f.options,
    env: { ...f.env, AI_MODEL_TOKEN_BOUNDS_JSON: "null" },
  });
  expect(await missing.beforeDispatch(f.request)).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM legacy_ai_attempts").get()).toEqual({ n: 0 });
});

for (const revoke of [
  "consent",
  "role",
  "revision",
  "current_analysis",
  "input",
  "tombstone",
  "case_delete",
  "account_delete",
] as const) {
  test(`a fresh ${revoke} fence denies an already prepared dispatch`, async () => {
    const f = await journal(),
      handle = await f.ledger.beforeDispatch(f.request);
    expect(handle).not.toBeNull();
    if (!handle) throw new Error("NO_HANDLE");
    if (revoke === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.session.userId);
    if (revoke === "role")
      f.db.sqlite
        .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
        .run(`account-type:${f.session.userId}`);
    if (revoke === "revision")
      f.db.sqlite
        .query("UPDATE cases SET input_revision=input_revision+1 WHERE id=?")
        .run(f.caseId);
    if (revoke === "current_analysis")
      f.db.sqlite.query("UPDATE cases SET current_analysis_id=NULL WHERE id=?").run(f.caseId);
    if (revoke === "input") {
      const encrypted = await (await createCaseDataCipher(f.env)).encrypt(
        '{"narrative":"changed synthetic source"}',
        { table: "cases", column: "encrypted_input", rowId: f.caseId, userId: f.session.userId },
      );
      f.db.sqlite.query("UPDATE cases SET encrypted_input=? WHERE id=?").run(encrypted, f.caseId);
    }
    if (revoke === "tombstone")
      f.db.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
        .run(f.session.userId, new Date().toISOString());
    if (revoke === "case_delete") f.db.sqlite.query("DELETE FROM cases WHERE id=?").run(f.caseId);
    if (revoke === "account_delete")
      f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.session.userId);
    expect(await f.ledger.confirmDispatch(handle)).toBe(false);
    await f.ledger.afterTransport(handle, unavailableReceipt("not_sent"));
    expect(
      f.db.sqlite.query("SELECT state,transport,dispatch_token FROM legacy_ai_attempts").get(),
    ).toEqual({ state: "final", transport: "not_sent", dispatch_token: null });
    expect(f.calls).toEqual([]);
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
}

test("ownership changes cannot reuse a prepared source or billing identity", async () => {
  const f = await journal(),
    handle = await f.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("NO_HANDLE");
  const other = await seedTestSession(f.db, { consent: true });
  f.db.sqlite.query("UPDATE cases SET user_id=? WHERE id=?").run(other.userId, f.caseId);
  expect(await f.ledger.confirmDispatch(handle)).toBe(false);
  expect(f.calls).toEqual([]);
});

test("unknown exposure survives source deletion and a late response retains both actual observations", async () => {
  const f = await journal(),
    handle = await f.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("NO_HANDLE");
  expect(await f.ledger.confirmDispatch(handle)).toBe(true);
  await f.ledger.afterTransport(handle, unavailableReceipt("unknown"));
  expect(await f.ledger.beforeDispatch({ ...f.request, attemptOrdinal: 2 })).toBeNull();
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.session.userId);
  const late = receipt();
  await f.ledger.afterTransport(handle, late);
  await f.ledger.afterTransport(handle, late);
  expect(
    f.db.sqlite.query("SELECT analysis_id,case_id,quota_state FROM legacy_ai_operations").get(),
  ).toEqual({ analysis_id: null, case_id: null, quota_state: "released" });
  expect(f.db.sqlite.query("SELECT owner_id FROM v2_billing_principals").get()).toEqual({
    owner_id: null,
  });
  expect(f.db.sqlite.query("SELECT state,transport FROM legacy_ai_attempts").get()).toEqual({
    state: "final",
    transport: "response",
  });
  const saved = f.db.sqlite
    .query("SELECT payload_json FROM legacy_ai_observations ORDER BY rowid")
    .all() as { payload_json: string }[];
  expect(saved.map((r) => JSON.parse(r.payload_json).transport)).toEqual(["unknown", "response"]);
  expect(JSON.parse(saved[1]?.payload_json ?? "null")).toEqual(late);
  expect(JSON.stringify(saved)).not.toContain(f.session.userId);
  expect(JSON.stringify(saved)).not.toContain("narrative");
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("the shared daily200 quota denies legacy calls without changing paid history", async () => {
  const f = await journal();
  const day = usageDateKst(new Date().toISOString());
  f.db.sqlite
    .query("INSERT INTO v2_daily_usage(owner_id,day,responses_used) VALUES(?,?,200)")
    .run(f.session.userId, day);
  expect(await f.ledger.beforeDispatch(f.request)).toBeNull();
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 200, responses_reserved: 0 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM legacy_ai_attempts").get()).toEqual({ n: 0 });
  expect(f.calls).toEqual([]);
});

test("legacy reservations use the same last daily response slot and release only their own unit", async () => {
  const f = await journal(),
    day = usageDateKst(new Date().toISOString());
  f.db.sqlite
    .query(
      "INSERT INTO v2_daily_usage(owner_id,day,responses_used,responses_reserved) VALUES(?,?,198,1)",
    )
    .run(f.session.userId, day);
  expect(await f.ledger.beforeDispatch(f.request)).not.toBeNull();
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 198, responses_reserved: 2 });
  f.db.sqlite
    .query("UPDATE analyses SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE id=?")
    .run(f.identity.analysisId);
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 198, responses_reserved: 1 });
});

test("a waiting clarification consumes one visible response and retains the question batch", async () => {
  const f = await analysisFixture("questions"),
    env = environment(f),
    background: Promise<void>[] = [];
  const runtime = await createLegacyAnalysisRuntime(env, f.identity, `${f.identity.analysisId}-1`, {
    retrieval: f.legal,
    waitUntil: (work) => {
      background.push(work);
    },
  });
  for (const phase of LEGACY_ANALYSIS_PHASES) {
    const result = await runtime.phase(phase);
    if (result.status === "waiting_for_answers") break;
  }
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.status).toBe(
    "waiting_for_answers",
  );
  expect(f.calls).toEqual(["minimize", "screening", "structure", "questions"]);
  expect(f.db.sqlite.query("SELECT quota_state FROM legacy_ai_operations").get()).toEqual({
    quota_state: "consumed",
  });
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 1, responses_reserved: 0 });
  await Promise.all(background);
});

test("an explicit retry cannot overlap unknown transport and can resume only after the late terminal receipt", async () => {
  const f = await journal(),
    handle = await f.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("NO_HANDLE");
  expect(await f.ledger.confirmDispatch(handle)).toBe(true);
  await f.ledger.afterTransport(handle, unavailableReceipt("unknown"));
  f.db.sqlite
    .query("UPDATE analyses SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE id=?")
    .run(f.identity.analysisId);
  expect(
    await f.repo.retryAnalysis(
      f.session.userId,
      f.caseId,
      f.identity.analysisId,
      1,
      1,
      crypto.randomUUID(),
      "a".repeat(64),
      new Date().toISOString(),
    ),
  ).toBe(true);
  await f.execute(2).phase("initialize");
  const retry = await createLegacyAnalysisLedger({
    ...f.options,
    instanceId: `${f.identity.analysisId}-2`,
  });
  const next = { ...f.request, invocationId: crypto.randomUUID() };
  expect(await retry.beforeDispatch(next)).toBeNull();
  await f.ledger.afterTransport(handle, receipt());
  const allowed = await retry.beforeDispatch(next);
  expect(allowed).not.toBeNull();
  expect(await f.ledger.confirmDispatch(handle)).toBe(false);
  expect(
    f.db.sqlite.query("SELECT workflow_attempt,quota_state FROM legacy_ai_operations").get(),
  ).toEqual({ workflow_attempt: 2, quota_state: "reserved" });
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 0, responses_reserved: 1 });
});

test("an explicit retry cancels only an old provably unsent preparation", async () => {
  const f = await journal(),
    old = await f.ledger.beforeDispatch(f.request);
  if (!old) throw new Error("NO_HANDLE");
  f.db.sqlite
    .query("UPDATE analyses SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE id=?")
    .run(f.identity.analysisId);
  expect(
    await f.repo.retryAnalysis(
      f.session.userId,
      f.caseId,
      f.identity.analysisId,
      1,
      1,
      crypto.randomUUID(),
      "a".repeat(64),
      new Date().toISOString(),
    ),
  ).toBe(true);
  await f.execute(2).phase("initialize");
  const retry = await createLegacyAnalysisLedger({
    ...f.options,
    instanceId: `${f.identity.analysisId}-2`,
  });
  expect(
    await retry.beforeDispatch({ ...f.request, invocationId: crypto.randomUUID() }),
  ).not.toBeNull();
  expect(await f.ledger.confirmDispatch(old)).toBe(false);
  expect(
    f.db.sqlite
      .query("SELECT state,transport,dispatch_token FROM legacy_ai_attempts WHERE id=?")
      .get(old.attemptId),
  ).toEqual({ state: "final", transport: "not_sent", dispatch_token: null });
});

test("actual gateway timeout retains unknown transport and records the late usage without publishing", async () => {
  const f = await analysisFixture(),
    env = environment(f),
    background: Promise<void>[] = [];
  let resolve: (value: unknown) => void = () => {};
  let wire: Parameters<typeof f.binding.run> | undefined;
  const delayed = new Promise<unknown>((done) => {
    resolve = done;
  });
  env.AI = {
    run: async (...args: Parameters<typeof f.binding.run>) => {
      wire = args;
      return delayed;
    },
  } as unknown as Env["AI"];
  const runtime = await createLegacyAnalysisRuntime(env, f.identity, `${f.identity.analysisId}-1`, {
    retrieval: f.legal,
    timeoutMs: 10,
    waitUntil: (work) => {
      background.push(work);
    },
  });
  await runtime.phase("initialize");
  expect((await runtime.phase("minimize")).status).toBe("failed");
  expect(f.db.sqlite.query("SELECT state,transport FROM legacy_ai_attempts").get()).toEqual({
    state: "unknown",
    transport: "unknown",
  });
  expect(f.db.sqlite.query("SELECT quota_state FROM legacy_ai_operations").get()).toEqual({
    quota_state: "released",
  });
  if (!wire) throw new Error("NO_DISPATCH");
  const output = await f.binding.run(...wire);
  resolve({ ...(output as object), ...{ usage: { prompt_tokens: 10, completion_tokens: 20 } } });
  await Promise.all(background);
  expect(f.calls).toEqual(["minimize"]);
  expect(f.db.sqlite.query("SELECT state,transport FROM legacy_ai_attempts").get()).toEqual({
    state: "final",
    transport: "response",
  });
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.status).toBe("failed");
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM legacy_ai_observations").get()).toEqual({
    n: 2,
  });
});

test("usage observation IO failures do not fail valid output or erase mandatory transport evidence", async () => {
  const f = await analysisFixture(),
    env = environment(f),
    background: Promise<void>[] = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO legacy_ai_observations"))
      throw new Error("synthetic private observer failure");
    return prepare(sql);
  };
  const logs = spyOn(console, "error").mockImplementation(() => {});
  try {
    const runtime = await createLegacyAnalysisRuntime(
      env,
      f.identity,
      `${f.identity.analysisId}-1`,
      {
        retrieval: f.legal,
        waitUntil: (work) => {
          background.push(work);
        },
      },
    );
    for (const phase of LEGACY_ANALYSIS_PHASES) await runtime.phase(phase);
    await Promise.all(background);
    expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.status).toBe(
      "completed",
    );
    expect(f.calls).toHaveLength(5);
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) AS n FROM legacy_ai_attempts WHERE state='final' AND transport='response'",
        )
        .get(),
    ).toEqual({ n: 5 });
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM legacy_ai_observations").get()).toEqual({
      n: 0,
    });
    expect(logs).toHaveBeenCalled();
    expect(JSON.stringify(logs.mock.calls)).not.toContain("synthetic private observer failure");
  } finally {
    logs.mockRestore();
  }
});

test("stale capability observation dates do not restore a monetary expiry gate", async () => {
  const f = await journal(),
    configured = modelBounds(observation, "a".repeat(64));
  configured.bounds.validUntil = new Date(Date.parse(configured.verifiedAt) + 1000).toISOString();
  const ledger = await createLegacyAnalysisLedger({
    ...f.options,
    env: { ...f.env, AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(configured) },
  });
  expect(await ledger.beforeDispatch(f.request)).not.toBeNull();
});

test("the additive0017 upgrade preserves existing ciphertext, outstanding money and receipt rows", async () => {
  const f = await analysisFixture("guidance", { throughMigration: "0016_unpriced_execution" });
  const principal = crypto.randomUUID(),
    quote = crypto.randomUUID(),
    attempt = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_billing_principals(id,owner_id,created_at) VALUES(?,NULL,'2026-10-04T00:00:00.000Z')",
    )
    .run(principal);
  f.db.sqlite
    .query(
      "INSERT INTO v2_cost_quotes(id,version,reviewed_at,valid_until,provider_pricing_version,exchange_rate,safety_margin,estimated_krw) VALUES(?,1,'2026-10-04T00:00:00.000Z','2026-10-05T00:00:00.000Z','synthetic-stale',1400,1,456)",
    )
    .run(quote);
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,ambiguous_krw) VALUES('2026-10',1,'preview',0,456) ON CONFLICT(month) DO UPDATE SET ambiguous_krw=456",
  );
  f.db.sqlite
    .query(
      "INSERT INTO v2_cost_attempts(id,principal_id,operation_id,invocation_id,attempt,month,quote_id,service,state,reserved_krw,created_at) VALUES(?,?,?,?,1,'2026-10',?,'model','ambiguous',456,'2026-10-04T00:00:00.000Z')",
    )
    .run(attempt, principal, crypto.randomUUID(), crypto.randomUUID(), quote);
  f.db.sqlite
    .query(
      "INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) VALUES(?,?,'reserved','ambiguous')",
    )
    .run(crypto.randomUUID(), attempt);
  const tables = f.db.sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='app_metadata' ORDER BY name",
    )
    .all() as { name: string }[];
  const read = () =>
    tables.map(({ name }) =>
      f.db.sqlite.query(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    );
  const prior = read();
  const migration = await Bun.file("drizzle/0017_legacy_analysis_journal.sql").text();
  f.db.sqlite.transaction(() => f.db.sqlite.exec(migration))();
  expect(read()).toEqual(prior);
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0017_legacy_analysis_journal" });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("technical plans and observation history cannot be rewritten or deleted", async () => {
  const f = await journal(),
    handle = await f.ledger.beforeDispatch(f.request);
  if (!handle) throw new Error("NO_HANDLE");
  expect(await f.ledger.confirmDispatch(handle)).toBe(true);
  await f.ledger.afterTransport(handle, receipt());
  const prior = f.db.sqlite.query("SELECT * FROM legacy_ai_attempts").all();
  expect(() =>
    f.db.sqlite
      .query("UPDATE legacy_ai_attempts SET wire_hash=? WHERE id=?")
      .run("f".repeat(64), handle.attemptId),
  ).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM legacy_ai_attempts")).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM legacy_ai_observations")).toThrow();
  expect(() =>
    f.db.sqlite.exec("UPDATE legacy_ai_observations SET observed_at='2000-01-01T00:00:00Z'"),
  ).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM legacy_ai_operations")).toThrow();
  expect(f.db.sqlite.query("SELECT * FROM legacy_ai_attempts").all()).toEqual(prior);
  const before = f.db.sqlite.serialize();
  expect(
    (await inspectAiRuntime({ preview: f.db.binding })).results[0]?.legacyAnalysisObservations,
  ).toEqual({
    attempts: 1,
    unresolvedTransport: 0,
    receiptObserved: 1,
    unpricedAttempts: 1,
    knownObservedKrw: null,
  });
  expect(f.db.sqlite.serialize()).toEqual(before);
});

for (const mode of ["out_of_scope", "urgent_redirect"] as const) {
  test(`the actual retained runtime publishes ${mode} without continuing model phases`, async () => {
    const f = await analysisFixture(mode),
      background: Promise<void>[] = [];
    const runtime = await createLegacyAnalysisRuntime(
      environment(f),
      f.identity,
      `${f.identity.analysisId}-1`,
      {
        retrieval: f.legal,
        waitUntil: (work) => {
          background.push(work);
        },
      },
    );
    await runtime.phase("initialize");
    await runtime.phase("minimize");
    expect((await runtime.phase("screening")).status).toBe("completed");
    expect(f.calls).toEqual(["minimize", "screening"]);
    expect(
      f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
    ).toEqual({ responses_used: 1, responses_reserved: 0 });
    await Promise.all(background);
  });
}
