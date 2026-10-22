import { expect, test } from "bun:test";
import {
  ApiError,
  createCaseDeletionClient,
  createCasesClient,
  createJsonRequester,
  type DomainRequest,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { createCasesModel } from "../apps/mobile/src/features/cases/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { guidance } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

async function fixture() {
  const db = await createTestDatabase(),
    owner = await seedTestSession(db, { consent: true }),
    peer = await seedTestSession(db, { consent: true });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("v".repeat(32)).replace(/=+$/, "") };
  const cipher = await createCaseDataCipher(env),
    repo = createDomainRepository(db.binding, cipher);
  const id = crypto.randomUUID(),
    analysisId = crypto.randomUUID(),
    now = new Date().toISOString();
  await repo.commitInitialCase({
    ownerId: owner.userId,
    caseId: id,
    analysisId,
    outboxId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    input: "합성 비공개 설명 원문",
    now,
  });
  const guard = {
    ownerId: owner.userId,
    caseId: id,
    analysisId,
    inputRevision: 1,
    attempt: 1,
    expectedStatus: "queued" as const,
  };
  await repo.compareAndSetAnalysis(guard, { status: "retrieving" }, now);
  await repo.compareAndSetAnalysis(
    { ...guard, expectedStatus: "retrieving" },
    { status: "generating" },
    now,
  );
  await repo.compareAndSetAnalysis(
    { ...guard, expectedStatus: "generating" },
    { status: "validating" },
    now,
  );
  await repo.compareAndSetAnalysis(
    { ...guard, expectedStatus: "validating" },
    { status: "completed", result: guidance },
    now,
  );
  const v2Id = crypto.randomUUID();
  await createV2WorkspaceRepository(db.binding, cipher).create(
    { ownerId: owner.userId, now },
    v2Id,
    {
      narrative: "삭제를 검증하는 별도 합성 사건입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    },
    { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "b".repeat(64) },
  );
  const app = new Hono<ApiEnvironment>().route("/api", api);
  let cookie = owner.cookie,
    loseDelete = false,
    blockStorage = false,
    retainCleanup = false;
  const records = new Map<string, string>(),
    writes: { path: string; key: string; body: unknown }[] = [],
    methods: string[] = [];
  const fingerprint = async (value: string) =>
    Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
      "hex",
    );
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => {
        if (blockStorage) throw new Error("SYNTHETIC_LOCKED");
        return records.get(key) ?? null;
      },
      set: async (key, value) => {
        records.set(key, value);
      },
      remove: async (key) => {
        if (!retainCleanup) records.delete(key);
      },
    },
  });
  function client(onDeleted: (id: string) => void = () => {}) {
    const scope = createSessionScope();
    const json = createJsonRequester({
      scope,
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) => {
        methods.push(init.method ?? "GET");
        const headers = new Headers(init.headers);
        if (init.method === "DELETE")
          writes.push({ path, key: headers.get("idempotency-key") ?? "", body: init.body });
        headers.set("cookie", cookie);
        headers.set("origin", env.BETTER_AUTH_URL);
        const response = await app.request(path, { ...init, headers }, env);
        if (loseDelete && init.method === "DELETE" && response.ok) {
          loseDelete = false;
          throw new ApiError("UNAVAILABLE", "합성 삭제 ACK 유실", true);
        }
        return response;
      },
    });
    const request: DomainRequest = (path, options = {}) =>
      json({
        ...options,
        path,
        expectedOwner: owner.userId,
        ...(options.headers?.["idempotency-key"]
          ? { key: options.headers["idempotency-key"] }
          : {}),
      });
    const deletion = createCaseDeletionClient({
      scope,
      request,
      newKey: () => crypto.randomUUID(),
      recovery: { ownerId: owner.userId, storage, fingerprint },
      onDeleted,
    });
    const cases = (includeLegacyDetails: boolean) =>
      createCasesClient({
        mode: "real",
        scope,
        includeLegacyDetails,
        storage,
        persistence: "required",
        fingerprint,
        newKey: () => crypto.randomUUID(),
        challenge: async () => {
          throw new Error("READ_MUST_NOT_START_CHALLENGE");
        },
        request: (_action, _input, options = {}) => {
          if (!options.path) throw new Error("MISSING_WIRE_PATH");
          return json({ ...options, path: options.path, expectedOwner: owner.userId });
        },
      });
    return { deletion, cases, request, scope };
  }
  return {
    db,
    owner,
    peer,
    id,
    v2Id,
    client,
    records,
    writes,
    methods,
    setCookie(value: string) {
      cookie = value;
    },
    lose() {
      loseDelete = true;
    },
    locked(value: boolean) {
      blockStorage = value;
    },
    retain() {
      retainCleanup = true;
    },
  };
}
test("native v1 reads the actual encrypted stored guidance without reanalysis, and default web DTOs stay unchanged", async () => {
  const f = await fixture();
  try {
    const native = await f.client().cases(true).get(f.id);
    expect(native.legacyDetail?.result).toEqual(guidance);
    expect(native.legacyDetail?.status).toBe("completed");
    expect(native.schemaVersion).toBe("1");
    expect(await f.client().cases(false).get(f.id)).not.toHaveProperty("legacyDetail");
    expect(f.methods.every((method) => method === "GET")).toBe(true);
    expect(JSON.stringify([...f.records])).not.toContain(guidance.summary.userStatements[0]);
    f.setCookie(f.peer.cookie);
    await expect(f.client().cases(true).get(f.id)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  } finally {
    f.db.close();
  }
});
for (const version of ["1", "2"] as const)
  test(`native v${version} deletion replays the same durable empty-body request after lost ACK and client recreation`, async () => {
    const f = await fixture();
    try {
      const id = version === "1" ? f.id : f.v2Id,
        notifications: string[] = [];
      f.lose();
      await expect(
        f.client((value) => notifications.push(value)).deletion.deleteCase(id, "DELETE", version),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(notifications).toEqual([]);
      expect(f.records.size).toBe(1);
      f.setCookie(f.peer.cookie);
      await expect(f.client().deletion.deleteCase(id, "DELETE", version)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expect(f.records.size).toBe(1);
      f.setCookie(f.owner.cookie);
      await f
        .client((value) => notifications.push(value))
        .deletion.deleteCase(id, "DELETE", version);
      expect(notifications).toEqual([id]);
      expect(f.writes).toHaveLength(3);
      expect(new Set(f.writes.map((write) => write.key)).size).toBe(1);
      expect(f.writes.every((write) => write.body === undefined)).toBe(true);
      expect(f.records.size).toBe(0);
      expect(
        f.db.sqlite
          .query(`SELECT id FROM ${version === "1" ? "cases" : "v2_workspaces"} WHERE id=?`)
          .get(id),
      ).toBeNull();
      const deletionRows = f.db.sqlite
        .query(
          `SELECT count(*) n FROM ${version === "1" ? "deletion_jobs" : "v2_deletion_journals"}`,
        )
        .get();
      expect(deletionRows).toEqual({ n: 1 });
    } finally {
      f.db.close();
    }
  });
test("required deletion storage failure never reaches DELETE; failed cleanup cannot undo a confirmed removal", async () => {
  const f = await fixture();
  try {
    f.locked(true);
    await expect(f.client().deletion.deleteCase(f.id, "DELETE", "1")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.writes).toHaveLength(0);
    f.locked(false);
    f.retain();
    let notified = false;
    await f
      .client(() => {
        notified = true;
      })
      .deletion.deleteCase(f.id, "DELETE", "1");
    expect(notified).toBe(true);
    expect(f.records.size).toBe(1);
    expect(f.db.sqlite.query("SELECT id FROM cases WHERE id=?").get(f.id)).toBeNull();
  } finally {
    f.db.close();
  }
});
test("RN cases model reads legacy guidance and removes its selected case through actual Hono deletion before a fresh list", async () => {
  const f = await fixture();
  let stop = () => {};
  try {
    const session: SessionState = {
      phase: "ready",
      busy: false,
      role: "customer",
      error: null,
      consent: null,
      session: {
        user: { id: f.owner.userId, name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    };
    const model = createCasesModel({
      session: { getSnapshot: () => session, subscribe: () => () => {}, refresh: async () => {} },
      createClient: (_signal, _owner, onDeleted) => {
        const client = f.client((id) => {
          onDeleted(id);
          client.scope.invalidate();
        });
        return { ...client.cases(true), deleteCase: client.deletion.deleteCase };
      },
    });
    stop = model.start();
    await new Promise<void>((done) => {
      if (!model.getSnapshot().busy) return done();
      const unsubscribe = model.subscribe(() => {
        if (!model.getSnapshot().busy) {
          unsubscribe();
          done();
        }
      });
    });
    await model.open(f.id);
    expect(model.getSnapshot().item?.legacyDetail?.result).toEqual(guidance);
    model.setDeleteConfirmation("DELETE");
    await model.deleteCase();
    expect(model.getSnapshot()).toMatchObject({ view: "list", item: null, deleteConfirmation: "" });
    expect(model.getSnapshot().items.map((item) => item.id)).toEqual([f.v2Id]);
    expect(f.methods.every((method) => ["GET", "DELETE"].includes(method))).toBe(true);
  } finally {
    stop();
    f.db.close();
  }
});
test("an unannounced server role change denies legacy reading/removal and a fresh session exposes the new role", async () => {
  const f = await fixture();
  try {
    f.db.sqlite
      .query(
        "INSERT INTO app_metadata(key,value,updated_at) VALUES (?,'lawyer',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(`account-type:${f.owner.userId}`, new Date().toISOString());
    const client = f.client();
    await expect(client.cases(true).get(f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.deletion.deleteCase(f.id, "DELETE", "1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const session = await client.request<{ user: { accountType: string } }>("/api/me/session");
    expect(session.user.accountType).toBe("lawyer");
    expect(f.db.sqlite.query("SELECT id FROM cases WHERE id=?").get(f.id)).toEqual({ id: f.id });
  } finally {
    f.db.close();
  }
});
