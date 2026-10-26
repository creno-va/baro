import { expect, test } from "bun:test";
import { v2LookupRequestsSchema, v2MessageRequestSchema } from "../src/contracts/v2";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LookupRepository } from "../src/server/db/v2-lookup";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import {
  publicStoredUserMessageSchema,
  storedUserMessageSchema,
} from "../src/server/modules/workspace/stored-message";
import { createTestDatabase } from "./helpers/d1";
import { fixture } from "./helpers/file-processing-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

const lookup = {
  tool: "hometax_status" as const,
  target: { businessNumber: "0000000000" },
  consent: { version: "2026-10-27" as const, recipient: "nts" as const, transmit: true as const },
};
async function lookupFixture(options: { lookups?: boolean; wrongHash?: boolean } = {}) {
  const f = await fixture();
  const operationId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    messageId = crypto.randomUUID();
  const request = v2MessageRequestSchema.parse({
    expectedRevision: 1,
    text: "명시적으로 동의한 사업자 상태를 조회해 주세요.",
    selectedFileIds: [],
    ...(options.lookups === false ? {} : { lookupRequests: [lookup] }),
  });
  const message = storedUserMessageSchema.parse({
    schemaVersion: "2",
    id: messageId,
    operationId,
    workspaceRevision: 2,
    createdAt: f.actor.now,
    role: "user",
    text: request.text,
    selectedFileIds: [],
    ...(request.lookupRequests ? { lookupRequests: request.lookupRequests } : {}),
  });
  const envelope = await f.core.encrypt("v2_messages", messageId, f.actor.ownerId, 1, message);
  f.db.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) VALUES(?,?,?,'chat',2,?)",
    )
    .run(operationId, f.actor.ownerId, f.workspaceId, f.actor.now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_idempotency(owner_id,route,key,request_hash,operation_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      f.actor.ownerId,
      `/api/v2/cases/${f.workspaceId}/chat`,
      "synthetic-lookup",
      options.wrongHash ? "f".repeat(64) : await runtimeDigest(request),
      operationId,
      f.actor.now,
      "2026-10-07T00:00:00.000Z",
    );
  f.db.sqlite
    .query(
      "INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,encrypted_payload,created_at) VALUES(?,?,2,?,'user',?,?)",
    )
    .run(messageId, f.workspaceId, operationId, envelope, f.actor.now);
  const lease = { jobId, token: crypto.randomUUID(), fencing: 1 };
  f.db.sqlite
    .query(
      "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,fencing,lease_token,lease_until,created_at,updated_at) VALUES(?,?,?,?,'workspace',?,2,'chat_response','running',1,?,?,?,?)",
    )
    .run(
      jobId,
      operationId,
      `${jobId}-1`,
      f.workspaceId,
      f.workspaceId,
      lease.token,
      "2026-10-06T00:05:00.000Z",
      f.actor.now,
      f.actor.now,
    );
  f.db.sqlite
    .query("UPDATE v2_workspaces SET revision=2,current_job_id=? WHERE id=?")
    .run(jobId, f.workspaceId);
  let now = f.actor.now;
  const repo = createV2LookupRepository(f.core, () => now);
  return {
    ...f,
    operationId,
    messageId,
    message,
    request,
    lease,
    repo,
    setNow: (value: string) => {
      now = value;
    },
    rows: () => f.db.sqlite.query("SELECT * FROM v2_lookup_executions").all(),
  };
}

test("explicit lookup consent binds the exact service, version, target and at most two unique tools", () => {
  expect(v2LookupRequestsSchema.safeParse([lookup]).success).toBe(true);
  const invalid = [
    [],
    [lookup, lookup],
    [lookup, lookup, lookup],
    [{ ...lookup, consent: { ...lookup.consent, recipient: "thecheat" } }],
    [{ ...lookup, consent: { ...lookup.consent, transmit: false } }],
    [{ ...lookup, consent: { ...lookup.consent, version: "old" } }],
    [{ ...lookup, target: { businessNumber: "0000000000", endpoint: "https://invalid.test" } }],
    [{ ...lookup, tool: "registry" }],
    [{ ...lookup, authorize: true }],
  ];
  for (const input of invalid) expect(v2LookupRequestsSchema.safeParse(input).success).toBe(false);
});

test("0018 upgrades an existing 0017 database without changing auth, consent or retained journals", async () => {
  const db = await createTestDatabase({ throughMigration: "0017_legacy_analysis_journal" });
  try {
    await seedTestSession(db, { now: Date.parse("2026-10-06T00:00:00.000Z"), consent: true });
    const names = [
      "user",
      "session",
      "user_consents",
      "legacy_ai_operations",
      "legacy_ai_attempts",
      "legacy_ai_observations",
      "v2_execution_admissions",
      "v2_execution_cost_observations",
    ];
    const before = names.map((name) => db.sqlite.query(`SELECT * FROM ${name}`).all());
    db.sqlite.exec(await Bun.file("drizzle/0018_external_lookup_admission.sql").text());
    expect(names.map((name) => db.sqlite.query(`SELECT * FROM ${name}`).all())).toEqual(before);
    expect(
      db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
    ).toEqual({ value: "0018_external_lookup_admission" });
    expect(db.sqlite.query("SELECT * FROM v2_lookup_executions").all()).toEqual([]);
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("private targets are encrypted and removed from the existing strict public message DTO", async () => {
  const f = await lookupFixture();
  expect(publicStoredUserMessageSchema.parse(f.message)).not.toHaveProperty("lookupRequests");
  const stored = f.db.sqlite
    .query("SELECT encrypted_payload FROM v2_messages WHERE id=?")
    .get(f.messageId);
  expect(JSON.stringify(stored)).not.toContain("0000000000");
  expect(await f.repo.claim(f.actor, f.lease, "hometax_status")).not.toBeNull();
  expect(JSON.stringify(f.rows())).not.toMatch(/0000000000|businessNumber|transmit|recipient/);
});

test("normal atomic chat admission preserves explicit lookup input only in its encrypted private extension", async () => {
  const f = await fixture();
  const request = v2MessageRequestSchema.parse({
    expectedRevision: f.rev(),
    text: "사업자 상태 조회에 동의합니다.",
    selectedFileIds: [],
    lookupRequests: [lookup],
  });
  const admission = {
    operationId: crypto.randomUUID(),
    key: crypto.randomUUID(),
    requestHash: await runtimeDigest(request),
  };
  const jobs = createV2JobsRepository(f.core),
    messageId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  expect(
    await jobs.admitWorkspace(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      admission,
      jobId,
      "chat_response",
      { id: messageId, request },
    ),
  ).toBe(true);
  const workspace = createV2WorkspaceRepository(f.db.binding, f.core.cipher);
  expect(await workspace.userMessage(f.actor, f.workspaceId, admission.operationId)).toMatchObject({
    lookupRequests: [lookup],
  });
  const publicMessages = await workspace.readMessages(f.actor, f.workspaceId);
  expect(publicMessages?.[0]).not.toHaveProperty("lookupRequests");
  expect(JSON.stringify(publicMessages)).not.toContain("0000000000");
});

test("signed Hono requests validate explicit consent behind fresh session and origin guards before job preparation", async () => {
  const f = await reportHttpFixture();
  try {
    const env = { ...f.env, ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) } };
    let prepared = 0;
    f.app.route(
      "/api/v2/cases",
      createWorkspacesApi({
        dependencies: async () => ({
          prepareJob: async (input) => {
            prepared++;
            expect(input.chat?.request.lookupRequests).toEqual([lookup]);
            return null; // Offline composition: no model permission or network.
          },
        }),
      }),
    );
    const request = {
      expectedRevision: f.rev(),
      text: "명시적 사업자 조회",
      selectedFileIds: [],
      lookupRequests: [lookup],
    };
    const headers = {
      cookie: f.cookie,
      origin: f.env.BETTER_AUTH_URL,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    };
    const path = `/api/v2/cases/${f.workspaceId}/messages`;
    const send = (body: unknown, nextHeaders: Record<string, string> = headers) =>
      f.app.request(
        path,
        { method: "POST", headers: nextHeaders, body: JSON.stringify(body) },
        env,
      );
    expect(
      (
        await send({
          ...request,
          lookupRequests: [{ ...lookup, consent: { ...lookup.consent, transmit: false } }],
        })
      ).status,
    ).toBe(400);
    expect((await send(request, { ...headers, cookie: "" })).status).toBe(401);
    expect((await send(request, { ...headers, origin: "https://untrusted.invalid" })).status).toBe(
      403,
    );
    expect(prepared).toBe(0);
    const response = await send(request);
    expect(response.status).toBe(503);
    expect(prepared).toBe(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toMatch(/0000000000|lookupRequests|recipient/);
    expect(f.db.sqlite.query("SELECT * FROM v2_lookup_executions").all()).toEqual([]);
  } finally {
    f.db.close();
  }
});

test("only one concurrent claimant wins, and a new repository or lease cannot reset an unknown lookup", async () => {
  const f = await lookupFixture();
  const claims = await Promise.all(
    Array.from({ length: 4 }, () => f.repo.claim(f.actor, f.lease, "hometax_status")),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(f.rows()).toHaveLength(1);
  const other = createV2LookupRepository(f.core, () => f.actor.now);
  expect(await other.claim(f.actor, f.lease, "hometax_status")).toBeNull();
  const next = { ...f.lease, token: crypto.randomUUID(), fencing: 2 };
  f.db.sqlite
    .query("UPDATE v2_jobs SET fencing=2,lease_token=? WHERE id=?")
    .run(next.token, next.jobId);
  expect(await other.claim(f.actor, next, "hometax_status")).toBeNull();
  expect(f.rows()[0]).toMatchObject({ transport: "unknown", observed_at: null });
});

test("missing consent input or a changed immutable request hash issues no claim", async () => {
  for (const options of [{ lookups: false }, { wrongHash: true }]) {
    const f = await lookupFixture(options);
    expect(await f.repo.claim(f.actor, f.lease, "hometax_status")).toBeNull();
    expect(f.rows()).toEqual([]);
  }
});

test("owner, role, consent, revision, tombstone, lease and operation state are fresh atomic claim predicates", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite
        .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
        .run(`account-type:${f.actor.ownerId}`),
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId),
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite.query("UPDATE v2_workspaces SET revision=3 WHERE id=?").run(f.workspaceId),
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite
        .query(
          "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
        )
        .run(f.workspaceId, f.actor.now),
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite
        .query("UPDATE v2_jobs SET lease_token=? WHERE id=?")
        .run(crypto.randomUUID(), f.lease.jobId),
    (f: Awaited<ReturnType<typeof lookupFixture>>) =>
      f.db.sqlite.query("UPDATE v2_operations SET state='cancelled' WHERE id=?").run(f.operationId),
  ]) {
    const f = await lookupFixture();
    // The fixture uses the normal customer fallback; make an explicit preference for this test.
    f.db.sqlite
      .query("INSERT OR REPLACE INTO app_metadata(key,value,updated_at) VALUES(?,'customer',?)")
      .run(`account-type:${f.actor.ownerId}`, f.actor.now);
    const decrypt = f.core.decrypt.bind(f.core);
    f.core.decrypt = async (...args) => {
      const value = await decrypt(...args);
      change(f);
      return value;
    };
    expect(await f.repo.claim(f.actor, f.lease, "hometax_status")).toBeNull();
    expect(f.rows()).toEqual([]);
  }
  const f = await lookupFixture();
  expect(
    await f.repo.claim({ ...f.actor, ownerId: "other_owner" }, f.lease, "hometax_status"),
  ).toBeNull();
  expect(await f.repo.claim(f.actor, f.lease, "thecheat")).toBeNull();
});

test("a closure-issued permit must stay authorized; forged JSON and revoked input cannot authorize HTTP", async () => {
  const f = await lookupFixture();
  expect(await f.repo.authorize({ request: lookup })).toBe(false);
  expect(await f.repo.observe({ request: lookup }, "response")).toBe(false);
  const permit = await f.repo.claim(f.actor, f.lease, "hometax_status");
  if (!permit) throw new Error("Synthetic permit missing");
  expect(await f.repo.authorize(permit)).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_messages SET encrypted_payload='changed' WHERE id=?")
    .run(f.messageId);
  expect(await f.repo.authorize(permit)).toBe(false);
  f.setNow("2026-10-06T00:05:01.000Z");
  expect(await f.repo.authorize(permit)).toBe(false);
});

test("real late receipts survive revocation and account deletion without resetting immutable transport facts", async () => {
  const f = await lookupFixture();
  const permit = await f.repo.claim(f.actor, f.lease, "hometax_status");
  if (!permit) throw new Error("Synthetic permit missing");
  expect(await f.repo.observe(permit, "unknown")).toBe(true);
  f.db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
    .run(f.actor.ownerId, f.actor.now);
  expect(await f.repo.authorize(permit)).toBe(false);
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(await f.repo.authorize(permit)).toBe(false);
  expect(f.db.sqlite.query("SELECT * FROM v2_messages WHERE id=?").get(f.messageId)).toBeNull();
  f.setNow("2026-10-06T00:01:00.000Z");
  expect(await f.repo.observe(permit, "response")).toBe(true);
  const final = f.rows();
  expect(await f.repo.observe(permit, "unknown")).toBe(false);
  expect(await f.repo.observe(permit, "provider_error")).toBe(false);
  expect(await f.repo.observe(permit, "response")).toBe(true);
  expect(f.rows()).toEqual(final);
  expect(() => f.db.sqlite.exec("DELETE FROM v2_lookup_executions")).toThrow(
    "LOOKUP_EXECUTION_RETAINED",
  );
  expect(() => f.db.sqlite.exec("UPDATE v2_lookup_executions SET tool='thecheat'")).toThrow(
    "LOOKUP_EXECUTION_IMMUTABLE",
  );
});
