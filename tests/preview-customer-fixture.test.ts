import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  fixtureExecutionMode,
  fixtureReceipt,
  preparePreviewCustomerFixture,
  verifyFixtureRelease,
  verifyFixtureRestAtomicity,
} from "../scripts/preview-customer-fixture";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createCaseDataCipher, type EnvelopeCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-15T01:00:00.000Z";
const SHA = "a".repeat(40);
const PROFILE = "4d279ff5-aaf2-4481-86ec-09b2d288495c";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture(name = "합성검증 프로필 1014") {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("q".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher);
  const actor = { ownerId: owner.userId, now: NOW };
  const lawyers = createV2LawyersRepository(core);
  expect(await lawyers.createProfile(actor, PROFILE)).toBe(true);
  expect(
    await lawyers.saveProfileDraft(actor, PROFILE, 1, crypto.randomUUID(), {
      name,
      office: {
        name: "합성 테스트 사무실",
        country: "KR",
        region: "seoul",
        address: "합성 테스트 주소",
        addressDetail: null,
        postalCode: null,
      },
    }),
  ).toBe(true);
  db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,'customer')")
    .run(`account-type:${owner.userId}`);
  let probes = 0;
  const prepare = (overrides: Partial<Parameters<typeof preparePreviewCustomerFixture>[0]> = {}) =>
    preparePreviewCustomerFixture({
      db: db.binding,
      cipher,
      mode: "create",
      now: NOW,
      verifyAtomicity: async () => {
        probes++;
        return true;
      },
      ...overrides,
    });
  const n = (table: string) =>
    (db.sqlite.query(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
  const changes = () => (db.sqlite.query("SELECT total_changes() n").get() as { n: number }).n;
  return { db, owner, cipher, core, actor, prepare, n, changes, probes: () => probes };
}

test("one real SQLite encrypted intake consumes one quota and preserves identity, profile and cost records", async () => {
  const f = await fixture();
  const protectedTables = [
    "user",
    "session",
    "user_consents",
    "v2_role_bindings",
    "v2_profiles",
    "v2_profile_revisions",
    "v2_cost_attempts",
    "v2_execution_admissions",
    "v2_runtime_proofs",
  ];
  const before = protectedTables.map((name) =>
    JSON.stringify(f.db.sqlite.query(`SELECT * FROM ${name}`).all()),
  );
  expect(await f.prepare()).toEqual({
    status: "created",
    code: "OK",
    restAtomicity: "verified_this_run",
    phase: "readback",
    domainCreateInvoked: true,
  });
  expect(f.probes()).toBe(1);
  const row = f.db.sqlite
    .query("SELECT id,owner_id,revision,status,encrypted_payload FROM v2_workspaces")
    .get() as {
    id: string;
    owner_id: string;
    revision: number;
    status: string;
    encrypted_payload: string;
  };
  expect(row.owner_id === f.owner.userId && row.revision === 1 && row.status === "intake").toBe(
    true,
  );
  expect(row.encrypted_payload.includes("individual")).toBe(false);
  const intake = await createV2WorkspaceRepository(f.db.binding, f.cipher).readIntake(
    f.actor,
    row.id,
  );
  expect(intake?.narrative.startsWith("합성 검증 사건입니다.")).toBe(true);
  expect(intake?.narrative.includes("실제 인물이나 계약은 없으며")).toBe(true);
  expect(
    f.db.sqlite
      .query(
        "SELECT cases_used,cases_reserved,responses_used,responses_reserved FROM v2_daily_usage",
      )
      .get(),
  ).toEqual({ cases_used: 1, cases_reserved: 0, responses_used: 0, responses_reserved: 0 });
  expect(f.db.sqlite.query("SELECT kind,units,state FROM v2_quota_reservations").get()).toEqual({
    kind: "new_case",
    units: 1,
    state: "consumed",
  });
  expect(f.n("v2_jobs")).toBe(0);
  expect(
    protectedTables.every(
      (name, index) =>
        JSON.stringify(f.db.sqlite.query(`SELECT * FROM ${name}`).all()) === before[index],
    ),
  ).toBe(true);
  const envelope = f.db.sqlite.query("SELECT encrypted_payload FROM v2_intakes").get() as {
    encrypted_payload: string;
  };
  await expect(
    f.cipher.decrypt(envelope.encrypted_payload, {
      table: "v2_intakes",
      column: "encrypted_payload",
      rowId: row.id,
      userId: "other-owner",
      revision: 1,
    }),
  ).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
});

test("status is read-only; after 24 hours and downstream revision changes the same fixture remains read-only", async () => {
  const f = await fixture();
  const before = f.changes();
  expect((await f.prepare({ mode: "status" })).status).toBe("absent");
  expect(f.changes()).toBe(before);
  expect(f.probes()).toBe(0);
  await f.prepare();
  f.db.sqlite.exec("UPDATE v2_workspaces SET revision=2");
  const saved = f.changes();
  expect((await f.prepare({ now: "2026-10-17T01:00:00.000Z" })).status).toBe("already_present");
  expect(f.changes()).toBe(saved);
  expect(f.n("v2_workspaces")).toBe(1);
  expect(f.probes()).toBe(1);
});

test("another owner's existing encrypted case and quota stay byte-for-byte unchanged", async () => {
  const f = await fixture();
  const control = await seedTestSession(f.db, { now: Date.parse(NOW), consent: true });
  const caseId = crypto.randomUUID();
  const repository = createV2WorkspaceRepository(f.db.binding, f.cipher);
  expect(
    (
      await repository.create(
        { ownerId: control.userId, now: NOW },
        caseId,
        {
          narrative: "다른 합성 소유자의 기존 사건 자료는 이번 fixture 준비에서 그대로 보존합니다.",
          subjectContext: "individual",
          jurisdiction: "KR",
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "b".repeat(64) },
      )
    ).kind,
  ).toBe("created");
  const snapshot = () =>
    JSON.stringify([
      f.db.sqlite.query("SELECT * FROM v2_workspaces WHERE id=?").get(caseId),
      f.db.sqlite.query("SELECT * FROM v2_intakes WHERE id=?").get(caseId),
      f.db.sqlite.query("SELECT * FROM v2_daily_usage WHERE owner_id=?").all(control.userId),
      f.db.sqlite.query("SELECT * FROM v2_quota_reservations WHERE owner_id=?").all(control.userId),
    ]);
  const before = snapshot();
  expect((await f.prepare()).status).toBe("created");
  expect(snapshot() === before).toBe(true);
  expect(f.n("v2_workspaces")).toBe(2);
});

test("a wrong encryption key cannot identify the source and changes no rows", async () => {
  const f = await fixture();
  const before = f.changes();
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
  });
  await expect(f.prepare({ cipher })).rejects.toThrow("CRYPTO_DECRYPT_FAILED");
  expect(f.changes()).toBe(before);
  expect(f.probes()).toBe(0);
});

test("concurrent invocations admit at most one fixed workspace and quota", async () => {
  const f = await fixture();
  const results = await Promise.all([f.prepare(), f.prepare()]);
  expect(results.filter((r) => r.status === "created").length).toBe(1);
  expect(f.n("v2_workspaces")).toBe(1);
  expect(f.n("v2_operations")).toBe(1);
  expect(f.n("v2_quota_reservations")).toBe(1);
});

test.each([
  "marker",
  "schema",
  "role",
  "consent",
  "quota",
  "account-tombstone",
  "profile-tombstone",
])("preflight %s refusal changes no rows and never probes", async (kind) => {
  const f = await fixture(kind === "marker" ? "다른 합성 이름" : undefined);
  if (kind === "schema")
    f.db.sqlite.exec("UPDATE app_metadata SET value='wrong-schema' WHERE key='schema_version'");
  if (kind === "role")
    f.db.sqlite
      .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
      .run(`account-type:${f.owner.userId}`);
  if (kind === "consent") f.db.sqlite.exec("UPDATE user_consents SET privacy_version='old'");
  if (kind === "quota")
    f.db.sqlite
      .query("INSERT INTO v2_daily_usage(owner_id,day,cases_used) VALUES(?,'2026-10-15',3)")
      .run(f.owner.userId);
  if (kind === "account-tombstone" || kind === "profile-tombstone")
    f.db.sqlite
      .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
      .run(
        kind === "account-tombstone" ? "account" : "profile",
        kind === "account-tombstone" ? f.owner.userId : PROFILE,
        NOW,
      );
  const before = f.changes();
  expect((await f.prepare()).status).toBe("blocked");
  expect(f.changes()).toBe(before);
  expect(f.probes()).toBe(0);
  expect(f.n("v2_workspaces")).toBe(0);
});

test.each(["role", "consent", "profile-revision", "profile-cipher", "account-tombstone", "quota"])(
  "canonical claim rejects %s change after the latch and before encrypted domain admission",
  async (kind) => {
    const f = await fixture();
    let fired = false;
    const cipher: EnvelopeCipher = {
      ...f.cipher,
      encrypt: async (plaintext, context) => {
        const result = await f.cipher.encrypt(plaintext, context);
        if (!fired && context.table === "v2_intakes") {
          fired = true;
          if (kind === "role")
            f.db.sqlite
              .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
              .run(`account-type:${f.owner.userId}`);
          if (kind === "consent") f.db.sqlite.exec("DELETE FROM user_consents");
          if (kind === "profile-revision")
            f.db.sqlite.exec("UPDATE v2_profiles SET revision=revision+1");
          if (kind === "profile-cipher")
            f.db.sqlite.exec(
              "UPDATE v2_profile_revisions SET encrypted_payload=encrypted_payload||'x'",
            );
          if (kind === "account-tombstone")
            f.db.sqlite
              .query("INSERT INTO v2_tombstones VALUES('account',?,?)")
              .run(f.owner.userId, NOW);
          if (kind === "quota")
            f.db.sqlite
              .query("INSERT INTO v2_daily_usage(owner_id,day,cases_used) VALUES(?,'2026-10-15',3)")
              .run(f.owner.userId);
        }
        return result;
      },
    };
    expect((await f.prepare({ cipher })).code).toBe("CLAIM_REJECTED");
    expect(fired).toBe(true);
    expect(f.n("v2_workspaces") + f.n("v2_operations") + f.n("v2_quota_reservations")).toBe(0);
  },
);

test("explicit customer preference retains existing role fallback semantics", async () => {
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'lawyer_applicant',?)")
    .run(f.owner.userId, NOW);
  f.db.sqlite.query("DELETE FROM app_metadata WHERE key=?").run(`account-type:${f.owner.userId}`);
  expect((await f.prepare()).code).toBe("ACCESS_OR_QUOTA_REJECTED");
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,'customer')")
    .run(`account-type:${f.owner.userId}`);
  expect((await f.prepare()).status).toBe("created");
});

test("real SQL failure rolls back every domain/quota row and the durable attempt forbids a later write", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER fixture_fail_intake BEFORE INSERT ON v2_intakes BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  expect((await f.prepare()).status).toBe("unknown");
  expect(
    f.n("v2_workspaces") +
      f.n("v2_operations") +
      f.n("v2_daily_usage") +
      f.n("v2_quota_reservations"),
  ).toBe(0);
  f.db.sqlite.exec("DROP TRIGGER fixture_fail_intake");
  const before = f.changes();
  expect((await f.prepare({ now: "2026-10-17T01:00:00.000Z" })).code).toBe("ATTEMPT_UNRESOLVED");
  expect(f.changes()).toBe(before);
  expect(f.probes()).toBe(1);
});

test("a lost committed batch response is unknown first and recovered only by reads", async () => {
  const f = await fixture();
  const db = {
    prepare: f.db.binding.prepare.bind(f.db.binding),
    batch: async (statements: D1PreparedStatement[]) => {
      await f.db.binding.batch(statements);
      throw new Error("private transport diagnostic that must never escape");
    },
  } as unknown as D1Database;
  const result = await f.prepare({ db });
  expect(result.status).toBe("unknown");
  expect(JSON.stringify(fixtureReceipt(SHA, result)).includes("private transport")).toBe(false);
  const before = f.changes();
  expect((await f.prepare()).status).toBe("already_present");
  expect(f.changes()).toBe(before);
  expect(f.n("v2_workspaces")).toBe(1);
});

test("an unconfirmed intent write never invokes domain creation and a later dispatch is read-only even with no row", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER fixture_fail_intent BEFORE INSERT ON app_metadata WHEN NEW.key='baro-test-fixture:customer-intake-v1:attempt' BEGIN SELECT RAISE(ABORT,'synthetic interrupted intent'); END",
  );
  const result = await f.prepare();
  expect(result.status).toBe("unknown");
  expect(result.phase).toBe("intent");
  expect(result.domainCreateInvoked).toBe(false);
  expect(f.n("v2_workspaces") + f.n("v2_operations")).toBe(0);
  f.db.sqlite.exec("DROP TRIGGER fixture_fail_intent");
  const mode = await fixtureExecutionMode({
    requested: "create",
    runId: "2",
    runNumber: "2",
    runAttempt: "1",
    github: async () => ({
      total_count: 2,
      workflow_runs: [
        { id: 2, run_number: 2, display_title: "Preview customer fixture create" },
        { id: 1, run_number: 1, display_title: "Preview customer fixture create" },
      ],
    }),
  });
  expect(mode).toBe("status");
  const before = f.changes();
  expect((await f.prepare({ mode })).status).toBe("absent");
  expect(f.changes()).toBe(before);
  expect(f.probes()).toBe(1);
});

test("create requires complete dispatch history, including later pages, and reruns only read", async () => {
  const current = { id: 201, run_number: 101, display_title: "Preview customer fixture create" };
  const first = [
    current,
    ...Array.from({ length: 99 }, (_, index) => ({
      id: 200 - index,
      run_number: 100 - index,
      display_title: "Preview customer fixture status",
    })),
  ];
  const input = { requested: "create" as const, runId: "201", runNumber: "101", runAttempt: "1" };
  for (const finalName of [
    "Preview customer fixture create",
    "Preview customer fixture status",
    "unknown earlier title",
  ]) {
    let calls = 0;
    const mode = await fixtureExecutionMode({
      ...input,
      github: async () => ({
        total_count: 101,
        workflow_runs: ++calls === 1 ? first : [{ id: 1, run_number: 1, display_title: finalName }],
      }),
    });
    expect(mode).toBe(finalName === "Preview customer fixture status" ? "create" : "status");
    expect(calls).toBe(2);
  }
  for (const page of [
    { total_count: 2, workflow_runs: [current] },
    { total_count: 0, workflow_runs: [] },
    { total_count: 1001, workflow_runs: first },
    { total_count: 2, workflow_runs: [current, current] },
  ])
    expect(await fixtureExecutionMode({ ...input, github: async () => page })).toBe("status");
  expect(
    await fixtureExecutionMode({
      ...input,
      runAttempt: "2",
      github: async () => {
        throw new Error("history is not needed on rerun");
      },
    }),
  ).toBe("status");
});

test("deletion tombstone and incomplete committed state never trigger recreation", async () => {
  const f = await fixture();
  await f.prepare();
  f.db.sqlite.exec("DELETE FROM v2_intakes");
  const incomplete = f.changes();
  expect((await f.prepare()).code).toBe("FIXTURE_INCOMPLETE");
  expect(f.changes()).toBe(incomplete);
  f.db.sqlite.exec("DELETE FROM v2_workspaces");
  const deleted = f.changes();
  expect((await f.prepare()).code).toBe("FIXTURE_TOMBSTONED");
  expect(f.changes()).toBe(deleted);
});

test("probe requires the known UNIQUE rejection plus actual absence in real SQLite", async () => {
  const f = await fixture();
  let writes = 0;
  const verified = await verifyFixtureRestAtomicity(f.db.binding, async (batch) => {
    writes++;
    try {
      await f.db.binding.batch(batch.map((q) => f.db.binding.prepare(q.sql).bind(...q.params)));
    } catch (error) {
      return Response.json(
        {
          success: false,
          errors: [{ message: error instanceof Error ? error.message : "unknown" }],
        },
        { status: 400 },
      );
    }
    return Response.json({ success: true });
  });
  expect(verified).toBe(true);
  expect(writes).toBe(1);
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'baro-test-fixture:%'")
      .get(),
  ).toEqual({ n: 0 });
});

test.each(["partial", "timeout", "wrong-error", "success"])(
  "probe %s cannot authorize creation or hide residue",
  async (mode) => {
    const f = await fixture();
    const verifyAtomicity = () =>
      verifyFixtureRestAtomicity(f.db.binding, async (batch) => {
        if (mode === "partial") {
          const first = batch[0];
          if (!first) throw new Error("missing test statement");
          await f.db.binding
            .prepare(first.sql)
            .bind(...first.params)
            .run();
          return Response.json(
            { success: false, errors: [{ message: "UNIQUE constraint failed: app_metadata.key" }] },
            { status: 400 },
          );
        }
        if (mode === "timeout") throw new Error("synthetic timeout");
        return Response.json(
          mode === "success"
            ? { success: true }
            : { success: false, errors: [{ message: "different failure" }] },
        );
      });
    expect((await f.prepare({ verifyAtomicity })).code).toBe("ATOMICITY_NOT_PROVEN");
    expect(f.n("v2_workspaces")).toBe(0);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'baro-test-fixture:%'")
        .get(),
    ).toEqual({ n: mode === "partial" ? 1 : 0 });
  },
);

const releaseInput = () => ({
  sha: SHA,
  actor: "hyunhomon",
  triggeringActor: "hyunhomon",
  ref: "refs/heads/main",
  event: "workflow_dispatch",
  repository: "creno-va/baro",
  checkoutSha: SHA,
  github: async (path: string) =>
    path === "git/ref/heads/main"
      ? { object: { sha: SHA } }
      : {
          workflow_runs: [
            { head_sha: SHA, head_branch: "main", conclusion: "success", event: "push" },
          ],
        },
  fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    return Response.json({
      status: String(url).endsWith("ready") ? "ready" : "ok",
      service: "baro",
      environment: "preview",
      release: SHA,
      schemaVersion: "0016_unpriced_execution",
    });
  }) as typeof fetch,
});
test("release gate requires exact main CI, preview live/ready and current schema", async () => {
  await expect(verifyFixtureRelease(releaseInput())).resolves.toBeUndefined();
  for (const override of [
    { actor: "other" },
    { triggeringActor: "other" },
    { ref: "refs/heads/feature" },
    { event: "push" },
    { repository: "other/repository" },
    { checkoutSha: "b".repeat(40) },
    { sha: "not-sha" },
  ])
    await expect(verifyFixtureRelease({ ...releaseInput(), ...override })).rejects.toThrow(
      "CONFIGURATION_INVALID",
    );
  for (const override of [
    { environment: "production" },
    { release: "b".repeat(40) },
    { schemaVersion: "old" },
  ])
    await expect(
      verifyFixtureRelease({
        ...releaseInput(),
        fetcher: (async (url: string | URL | Request) =>
          Response.json({
            status: String(url).endsWith("ready") ? "ready" : "ok",
            service: "baro",
            environment: "preview",
            release: SHA,
            schemaVersion: "0016_unpriced_execution",
            ...override,
          })) as typeof fetch,
      }),
    ).rejects.toThrow("RELEASE_NOT_VERIFIED");
  await expect(
    verifyFixtureRelease({
      ...releaseInput(),
      github: async (path) =>
        path === "git/ref/heads/main" ? { object: { sha: SHA } } : { workflow_runs: [] },
    }),
  ).rejects.toThrow("RELEASE_NOT_VERIFIED");
});

test("the public create API still requires a genuine verification step; business-only data never bypasses it", async () => {
  const f = await fixture();
  let checks = 0;
  const app = new Hono<ApiEnvironment>().route(
    "/api/v2/cases",
    createWorkspacesApi({
      turnstile: async () => {
        checks++;
        return false;
      },
    }),
  );
  const env = {
    ...f.owner.env,
    CASE_DATA_KEY_V1: btoa("q".repeat(32)).replace(/=+$/, ""),
    CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  } as Env;
  const body = {
    narrative: "로컬 회귀 전용 합성 사실을 확인하는 충분한 길이의 입력입니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
  };
  const send = (value: unknown) =>
    app.request(
      "/api/v2/cases",
      {
        method: "POST",
        headers: {
          cookie: f.owner.cookie,
          origin: env.BETTER_AUTH_URL,
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.1",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(value),
      },
      env,
    );
  // Use a current test session for this isolated HTTP boundary test.
  f.db.sqlite.query("UPDATE session SET expires_at=?").run(Date.now() + 3600000);
  expect((await send(body)).status).toBe(400);
  expect((await send({ ...body, turnstileToken: "rejected-local-test-token" })).status).toBe(403);
  expect(checks).toBe(1);
  expect(f.n("v2_workspaces")).toBe(0);
});

test("receipt and workflow have fixed non-sensitive fields and no production or arbitrary fixture inputs", async () => {
  const f = await fixture();
  const receipt = fixtureReceipt(SHA, await f.prepare({ mode: "status" }));
  expect(Object.keys(receipt).sort()).toEqual(
    [
      "candidateSha",
      "phase",
      "domainCreateInvoked",
      "code",
      "environment",
      "externalIntegrationVerified",
      "receiptVersion",
      "restAtomicity",
      "status",
      "turnstileVerified",
      "uiCreationVerified",
    ].sort(),
  );
  expect(
    JSON.stringify(receipt).includes(PROFILE) || JSON.stringify(receipt).includes(f.owner.userId),
  ).toBe(false);
  const workflow = await Bun.file(".github/workflows/preview-customer-fixture.yml").text();
  expect(
    workflow.includes("name: preview") &&
      workflow.includes("deployment: false") &&
      workflow.includes("group: cloudflare-preview"),
  ).toBe(true);
  expect(/target_environment:|owner_id:|profile_id:|narrative:|sql:/.test(workflow)).toBe(false);
  const child = Bun.spawnSync({
    cmd: [process.execPath, "scripts/preview-customer-fixture.ts", SHA, "create"],
    env: { FIXTURE_ENVIRONMENT: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(child.exitCode).toBe(1);
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(JSON.parse(new TextDecoder().decode(child.stdout)).code).toBe("CONFIGURATION_INVALID");
});
