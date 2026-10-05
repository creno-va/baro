import { afterEach, expect, test } from "bun:test";
import { api } from "../src/server/api";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import {
  CLEANUP_ATTEMPTS,
  CLEANUP_SETTLE_MS,
  deleteAccount,
  reconcileDeletion,
  replayDeletionJournal,
} from "../src/server/modules/deletion/service";
import { reconcileDispatch } from "../src/server/modules/dispatch/service";
import { createTestDatabase } from "./helpers/d1";
import { createOAuthFixture, responseCookies } from "./helpers/oauth";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture(recent = true) {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, {
    consent: true,
    ...(recent ? { oauthAuthenticatedAt: Date.now() } : {}),
  });
  const other = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, "") };
  const repo = createDomainRepository(db.binding, await createCaseDataCipher(env));
  const p = {
    ownerId: owner.userId,
    caseId: crypto.randomUUID(),
    analysisId: crypto.randomUUID(),
    outboxId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    input: "synthetic private sentinel",
    now: new Date().toISOString(),
  };
  await repo.commitInitialCase(p);
  db.sqlite
    .query(
      "INSERT INTO account(id,user_id,provider_id,account_id,created_at,updated_at) VALUES(?,?,'google','synthetic-subject',1,1)",
    )
    .run(crypto.randomUUID(), owner.userId);
  return { db, owner, other, env, repo, p };
}
function request(
  f: Awaited<ReturnType<typeof fixture>>,
  body: unknown = { confirmation: "DELETE" },
  origin = f.env.BETTER_AUTH_URL,
) {
  return api.request(
    "/me",
    {
      method: "DELETE",
      headers: { cookie: f.owner.cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    f.env,
  );
}
test("account deletion requires origin/strict confirmation/recent OAuth; sliding updates and revoked SQL session fail closed", async () => {
  const f = await fixture(false);
  expect((await request(f, undefined, "https://attacker.example")).status).toBe(403);
  expect((await request(f, { confirmation: "delete" })).status).toBe(400);
  expect((await request(f, { confirmation: "DELETE", ownerId: f.other.userId })).status).toBe(400);
  f.db.sqlite
    .query("UPDATE session SET updated_at=? WHERE id=?")
    .run(Date.now(), f.owner.sessionId);
  expect((await request(f)).status).toBe(403);
  for (const stamp of [Date.now() - 601_000, Date.now() + 60_000]) {
    f.db.sqlite
      .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
      .run(stamp, f.owner.sessionId);
    expect((await request(f)).status).toBe(403);
  }
  f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.owner.sessionId);
  expect(await deleteAccount(f.env.DB, f.owner.userId, f.owner.sessionId, Date.now())).toBe(false);
  expect(await f.repo.findCase(f.owner.userId, f.p.caseId)).not.toBeNull();
});
test("atomic deletion immediately revokes all sessions/cascades owned data, retains only opaque journal and other owner", async () => {
  const f = await fixture();
  await seedTestSession(f.db, { userId: crypto.randomUUID() });
  f.db.sqlite
    .query(
      "INSERT INTO citations(id,analysis_id,source_id,law_name,article,effective_date,verified_at,source_url,content_hash) VALUES(?,?,'synthetic','합성 법령','제1조','2026-10-05',?,'https://www.law.go.kr',?)",
    )
    .run(crypto.randomUUID(), f.p.analysisId, f.p.now, "a".repeat(64));
  f.db.sqlite
    .query("INSERT INTO case_feedback VALUES(?,?,1,?)")
    .run(f.p.caseId, f.p.analysisId, f.p.now);
  f.db.sqlite
    .query("UPDATE analyses SET attempt=3,workflow_instance_id=? WHERE id=?")
    .run(`${f.p.analysisId}-3`, f.p.analysisId);
  f.db.sqlite.query("DELETE FROM dispatch_outbox WHERE analysis_id=?").run(f.p.analysisId);
  f.db.sqlite
    .query(
      "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES(?,?,?,1,1,9999999999999)",
    )
    .run(crypto.randomUUID(), f.owner.userId, crypto.randomUUID());
  const response = await request(f);
  expect(response.status).toBe(202);
  expect((await response.json()) as unknown).toEqual({ status: "accepted" });
  expect(response.headers.getSetCookie().some((s) => /session_token=.*Max-Age=0/i.test(s))).toBe(
    true,
  );
  for (const table of [
    "account",
    "session",
    "user_consents",
    "daily_usage",
    "idempotency_records",
  ]) {
    expect(
      f.db.sqlite.query(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).get(f.owner.userId),
    ).toEqual({ n: 0 });
  }
  for (const table of ["cases", "analyses", "citations", "dispatch_outbox", "case_feedback"])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(
    (await api.request("/me/consent", { headers: { cookie: f.owner.cookie } }, f.env)).status,
  ).toBe(401);
  expect(
    (await api.request("/me/consent", { headers: { cookie: f.other.cookie } }, f.env)).status,
  ).toBe(200);
  const journal = f.db.sqlite.query("SELECT * FROM deletion_jobs").get() as {
    workflow_instance_ids: string;
  };
  expect(JSON.parse(journal.workflow_instance_ids)).toEqual(
    [1, 2, 3].map((i) => `${f.p.analysisId}-${i}`),
  );
  expect(JSON.stringify(journal)).not.toMatch(/sentinel|example.test|token|ciphertext|narrative/);
  expect((await request(f)).status).toBe(401);
  const guard = {
    ownerId: f.owner.userId,
    caseId: f.p.caseId,
    analysisId: f.p.analysisId,
    inputRevision: 1,
    attempt: 3,
    expectedStatus: "queued" as const,
  };
  expect(await f.repo.saveCheckpoint(guard, "late synthetic response", f.p.now)).toBe(false);
  expect(await f.repo.findCurrentAnalysis(f.owner.userId, f.p.caseId)).toBeNull();
});
test("journal insert or cascade failure rolls back deletion and session revocation without leaking SQL", async () => {
  for (const table of ["deletion_jobs", "user"]) {
    const f = await fixture();
    f.db.sqlite.exec(
      `CREATE TRIGGER injected BEFORE ${table === "user" ? "DELETE" : "INSERT"} ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic'); END`,
    );
    const response = await request(f);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/SQL|stack|synthetic|sentinel/);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 0 });
    expect(await f.repo.findCase(f.owner.userId, f.p.caseId)).not.toBeNull();
    expect(
      (await api.request("/me/consent", { headers: { cookie: f.owner.cookie } }, f.env)).status,
    ).toBe(200);
  }
});
test("cleanup crash lease expires, durable chunks advance, daily recheck catches delayed instances and final successful sweep permits GC", async () => {
  const f = await fixture();
  const now = Date.now();
  await deleteAccount(f.env.DB, f.owner.userId, f.owner.sessionId, now);
  const ids = Array.from({ length: 12 }, () => `${crypto.randomUUID()}-1`);
  f.db.sqlite
    .query("UPDATE deletion_jobs SET workflow_instance_ids=?,attempts=1,next_attempt_at=?")
    .run(JSON.stringify(ids), new Date(now + 60000).toISOString());
  const instances = new Set(ids);
  let calls = 0;
  const env = {
    DB: f.env.DB,
    ANALYSIS_WORKFLOW: {
      get: async (id: string) => {
        calls++;
        if (!instances.has(id)) throw new Error("instance.not_found");
        return {
          delete: async () => {
            instances.delete(id);
          },
        };
      },
    } as unknown as Workflow,
  };
  await reconcileDeletion(env, new Date(now).toISOString());
  expect(calls).toBe(0);
  const at = new Date(now + CLEANUP_SETTLE_MS).toISOString();
  await reconcileDeletion(env, at);
  expect(instances.size).toBe(2);
  expect(f.db.sqlite.query("SELECT cleanup_cursor FROM deletion_jobs").get()).toEqual({
    cleanup_cursor: 10,
  });
  await reconcileDeletion(env, at);
  expect(instances.size).toBe(0);
  instances.add(ids[0] as string);
  await reconcileDeletion(env, new Date(now + CLEANUP_SETTLE_MS + 86400000).toISOString());
  expect(instances.size).toBe(0);
  await reconcileDeletion(env, new Date(now + CLEANUP_SETTLE_MS + 86400000).toISOString());
  const end = new Date(now + 36 * 86400000).toISOString();
  await reconcileDeletion(env, end);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 1 });
  await reconcileDeletion(env, end);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 0 });
});
test("account deletion remains available without current consent or encryption key", async () => {
  const f = await fixture();
  Reflect.deleteProperty(f.env, "CASE_DATA_KEY_V1");
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  expect((await request(f)).status).toBe(202);
});
test("real callback establishes deletion authentication; synthetic provider exchange is not live OAuth evidence", async () => {
  const f = await createOAuthFixture("google");
  databases.push(f.database);
  const start = await f.begin();
  const callback = await f.callback(start.state, start.cookie);
  const cookie = responseCookies(callback);
  const state = await api.request("/me/deletion", { headers: { cookie } }, f.env);
  expect(state.status).toBe(200);
  expect(await state.json()).toMatchObject({ recentOAuth: true, providers: ["google"] });
  expect(
    (
      await api.request(
        "/me",
        {
          method: "DELETE",
          headers: { cookie, origin: f.env.BETTER_AUTH_URL, "content-type": "application/json" },
          body: '{"confirmation":"DELETE"}',
        },
        f.env,
      )
    ).status,
  ).toBe(202);
});
test("cleanup active/completed/absent states, lease restart, final race sweep and bounded failure preserve journals", async () => {
  const f = await fixture();
  const now = Date.now();
  await deleteAccount(f.env.DB, f.owner.userId, f.owner.sessionId, now);
  const instances = new Set([`${f.p.analysisId}-1`]);
  let calls = 0;
  const workflow = {
    get: async (id: string) => {
      calls++;
      if (!instances.has(id)) throw new Error("instance.not_found");
      return {
        delete: async () => {
          instances.delete(id);
        },
      };
    },
  } as unknown as Workflow;
  const env = { DB: f.env.DB, ANALYSIS_WORKFLOW: workflow };
  await Promise.all([
    reconcileDeletion(env, new Date(now).toISOString()),
    reconcileDeletion(env, new Date(now).toISOString()),
  ]);
  expect(calls).toBe(1);
  expect(instances.size).toBe(0);
  expect(f.db.sqlite.query("SELECT cleanup_state FROM deletion_jobs").get()).toEqual({
    cleanup_state: "pending",
  });
  instances.add(`${f.p.analysisId}-1`); // delayed create/crash after initial cleanup
  await reconcileDeletion(env, new Date(now + CLEANUP_SETTLE_MS).toISOString());
  expect(instances.size).toBe(0);
  expect(f.db.sqlite.query("SELECT cleanup_state FROM deletion_jobs").get()).toEqual({
    cleanup_state: "completed",
  });
  f.db.sqlite.exec(
    "UPDATE deletion_jobs SET cleanup_state='pending',attempts=7,next_attempt_at='1970-01-01T00:00:00.000Z',cleanup_cursor=0",
  );
  env.ANALYSIS_WORKFLOW = {
    get: async () => {
      throw new Error("provider-token synthetic sentinel");
    },
  } as unknown as Workflow;
  const original = console.error;
  const logs: string[] = [];
  console.error = (value) => {
    logs.push(String(value));
  };
  try {
    await reconcileDeletion(env, new Date(now + 40 * 86400000).toISOString());
  } finally {
    console.error = original;
  }
  expect(f.db.sqlite.query("SELECT cleanup_state,attempts FROM deletion_jobs").get()).toEqual({
    cleanup_state: "failed",
    attempts: CLEANUP_ATTEMPTS,
  });
  expect(logs.join()).toContain("deletion_cleanup_failed");
  expect(logs.join()).not.toMatch(/provider-token|sentinel/);
  await reconcileDeletion(env, new Date(now + 41 * 86400000).toISOString());
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 1 });
});
test("dispatch create racing deletion reopens completed journal before removing orphan", async () => {
  const f = await fixture();
  const instances = new Set<string>();
  f.env.ANALYSIS_WORKFLOW = {
    create: async ({ id }: { id: string }) => {
      await deleteAccount(f.env.DB, f.owner.userId, f.owner.sessionId, Date.now());
      f.db.sqlite.exec("UPDATE deletion_jobs SET cleanup_state='completed'");
      instances.add(id);
    },
    get: async (id: string) => ({
      delete: async () => {
        instances.delete(id);
      },
    }),
  } as unknown as Workflow;
  await reconcileDispatch(f.env);
  expect(instances.size).toBe(0);
  expect(f.db.sqlite.query("SELECT cleanup_state FROM deletion_jobs").get()).toEqual({
    cleanup_state: "pending",
  });
  expect(await f.repo.findCase(f.owner.userId, f.p.caseId)).toBeNull();
});
test("backup restored before deletion is replayed from separately retained journal before traffic; repeat replay and case-only isolation", async () => {
  const f = await fixture();
  const source = [
    {
      id: crypto.randomUUID(),
      target_type: "account",
      target_id: f.owner.userId,
      deleted_at: f.p.now,
      workflow_instance_ids: [`${f.p.analysisId}-1`],
      expires_at: new Date(Date.now() + 35 * 86400000).toISOString(),
    },
  ];
  expect(await replayDeletionJournal(f.env.DB, source)).toEqual({ replayed: 1 });
  expect(await replayDeletionJournal(f.env.DB, source)).toEqual({ replayed: 1 });
  expect(
    (await api.request("/me/consent", { headers: { cookie: f.owner.cookie } }, f.env)).status,
  ).toBe(401);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM user WHERE id=?").get(f.other.userId),
  ).toEqual({ n: 1 });
  expect(f.db.sqlite.query("SELECT cleanup_state FROM deletion_jobs").get()).toEqual({
    cleanup_state: "pending",
  });
  await expect(
    replayDeletionJournal(f.env.DB, [{ ...source[0], plaintext: "shadow copy" }]),
  ).rejects.toThrow();
});
