import { expect, setSystemTime, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { api } from "../src/server/api";
import { createV2Core } from "../src/server/db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { stopUnsentOriginalWrite } from "../src/server/db/v2-original-parts";
import { createV2PaidRuntimeRepository, runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { createV2RuntimeRefreshRepository } from "../src/server/db/v2-runtime-refresh";
import { createV2StorageCapacityRepository } from "../src/server/db/v2-storage-capacity";
import {
  createStorageBudgetService,
  type StorageAdmission,
} from "../src/server/modules/budget/storage-ledger";
import { decryptPart, digest } from "../src/server/modules/files/binary";
import { FILE_STORAGE_WORK, fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { measureD1Work } from "./helpers/d1-work";
import { r2 } from "./helpers/file-processing-fixture";
import { intent, NOW, ready, verifier } from "./helpers/storage-capacity";

type FileStorageMetering = NonNullable<
  Parameters<typeof createStorageBudgetService>[0]["metering"]
>;

async function fixture(
  capacityBytes?: number,
  now = NOW,
  wrapDatabase?: (db: D1Database) => D1Database,
  metering?: FileStorageMetering,
) {
  const f = await ready({
    getLimit: 100,
    headLimit: 100,
    deleteLimit: 100,
    ...(capacityBytes ? { capacityBytes } : {}),
  });
  f.db.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(f.workspaceId);
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,'customer',?)")
    .run(`account-type:${f.actor.ownerId}`, NOW);
  const bucket = r2();
  const core = fileStorageRequestCore(
    wrapDatabase ? createV2Core(wrapDatabase(f.core.binding), f.core.cipher) : f.core,
    !!wrapDatabase,
  );
  const paid = metering
    ? createStorageBudgetService({
        core,
        environment: "preview",
        ownerId: f.actor.ownerId,
        clock: () => now,
        metering,
        // General ledger-port test composition only. The fixed production file
        // runtime intentionally has no metering closure or such synthetic proof.
        bounds: async (input, inputDigest) => ({
          inputDigest,
          evidenceHash: "e".repeat(64),
          verifiedAt: now,
          validUntil: input.deadlineAt,
          quantities: [{ sku: "r2_class_a_requests", maximumQuantity: "1" }],
        }),
      })
    : createFileStorageBudget(core, "preview", f.actor.ownerId, () => now);
  const service = createFilesService(core, {
    environment: "preview",
    bucket: bucket.port,
    paidStorage: paid,
    clock: () => now,
  });
  const session = await service.reserve(f.actor.ownerId, f.workspaceId, 1, crypto.randomUUID(), {
    name: "합성 원본.txt",
    byteLength: 5,
    mediaType: "text/plain",
    autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  });
  return {
    ...f,
    core,
    bucket,
    paid,
    service,
    cleanupService: createFilesService(f.core, {
      environment: "preview",
      bucket: bucket.port,
      clock: () => now,
    }),
    session,
    put: () =>
      service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        session.fileId,
        session.uploadSession,
        0,
        new Response("hello").body,
      ),
  };
}

async function unrelatedPending(f: Awaited<ReturnType<typeof fixture>>) {
  const core = createV2Core(f.db.binding, f.core.cipher),
    capacity = createV2StorageCapacityRepository(core, "preview"),
    other = await intent({ ...f, core });
  const physical = capacity.prepareCapacity(f.actor, other.input),
    claim = crypto.randomUUID();
  const revision = f.db.sqlite
    .query("SELECT revision FROM v2_workspaces WHERE id=?")
    .get(f.workspaceId) as { revision: number };
  expect(
    await core.changed([
      core.claim(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: revision.revision },
        claim,
        physical.predicate.sql,
        [...physical.predicate.values],
      ),
      other.statement(claim),
      ...physical.statements(core, f.actor, claim),
      core.finish(claim),
    ]),
  ).toBe(true);
  const before = f.db.sqlite
    .query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?")
    .get(other.id);
  return { id: other.id, before };
}

async function cleanupRecovered(f: Awaited<ReturnType<typeof fixture>>) {
  const core = createV2Core(f.db.binding, f.core.cipher),
    deletion = createV2DeletionRepository(core);
  const blob = f.db.sqlite.query("SELECT blob_id FROM v2_storage_paid_executions").get() as {
    blob_id: string;
  };
  const journal = await deletion.findByTarget("blob", blob.blob_id);
  if (!journal) throw new Error("Synthetic recovered journal missing");
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:04:00.000Z",
  );
  if (!lease) throw new Error("Synthetic recovered lease missing");
  expect(await f.cleanupService.cleanup(lease)).toBe(true);
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_physical_blob_bindings WHERE blob_id=?")
      .get(blob.blob_id),
  ).toEqual({ state: "released" });
}

// Synthetic fault injection after the actual SQLite statement/batch commits.
// Zero row metadata below is a test adapter, never a claimed native measurement.
function faultDatabase(
  db: D1Database,
  fault: (sql: string, result: D1Result<unknown>) => D1Result<unknown>,
) {
  const sources = new WeakMap<
    D1PreparedStatement,
    { sql: string; statement: D1PreparedStatement }
  >();
  const result = <T>(sql: string, value: D1Result<T>) =>
    fault(sql, { ...value, meta: { ...value.meta, rows_read: 0, rows_written: 0 } }) as D1Result<T>;
  const wrap = (sql: string, statement: D1PreparedStatement): D1PreparedStatement => {
    const value = {
      bind: (...values: unknown[]) => wrap(sql, statement.bind(...values)),
      all: async <T>() => result(sql, await statement.all<T>()),
      run: async <T>() => result(sql, await statement.run<T>()),
    } as D1PreparedStatement;
    sources.set(value, { sql, statement });
    return value;
  };
  return {
    prepare: (sql: string) => wrap(sql, db.prepare(sql)),
    async batch<T>(statements: D1PreparedStatement[]) {
      const originals = statements.map((s) => {
        const found = sources.get(s);
        if (!found) throw new Error("Synthetic statement missing");
        return found;
      });
      const values = await db.batch<T>(originals.map((v) => v.statement));
      return values.map((v, i) => result(originals[i]?.sql ?? "", v));
    },
  } as D1Database;
}

test.each(["read", "missing", "lost"])(
  "unsent writer start committed with %s response failure still records a cleanup journal",
  async (failure) => {
    let injected = false;
    const f = await fixture(undefined, NOW, (db) =>
      faultDatabase(db, (sql, value) => {
        if (
          !injected &&
          sql.startsWith("UPDATE v2_physical_blob_bindings SET writer_state='running'")
        ) {
          injected = true;
          if (failure === "lost") throw new Error("Synthetic committed response lost");
          if (failure === "missing")
            return { ...value, meta: undefined } as unknown as D1Result<unknown>;
          return { ...value, meta: { ...value.meta, rows_read: FILE_STORAGE_WORK.rowsRead + 1 } };
        }
        return value;
      }),
    );
    const other = await unrelatedPending(f);
    await expect(f.put()).rejects.toThrow();
    expect(injected).toBe(true);
    expect(f.bucket.calls.put).toBe(0);
    expect(
      f.db.sqlite
        .query("SELECT writer_state FROM v2_physical_blob_bindings WHERE blob_id!=?")
        .get(other.id),
    ).toEqual({
      writer_state: "stopped",
    });
    expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id!=?").get(other.id)).toEqual({
      state: "deleting",
    });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_deletion_journals WHERE target_kind='blob'")
        .get(),
    ).toEqual({ n: 1 });
    await cleanupRecovered(f);
    expect(
      f.db.sqlite.query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?").get(other.id),
    ).toEqual(other.before);
  },
);

test.each(["lost", "missing", "journal"])(
  "unsent cleanup retains independent journal work after %s response failure",
  async (failure) => {
    let injected = false;
    let stopped = false;
    const f = await fixture(undefined, NOW, (db) =>
      faultDatabase(db, (sql, value) => {
        const stop = sql.startsWith("UPDATE v2_physical_blob_bindings SET writer_state='stopped'");
        stopped ||= stop;
        if (
          !injected &&
          (failure === "journal"
            ? stopped && sql.startsWith("INSERT INTO v2_mutation_claims")
            : stop)
        ) {
          injected = true;
          if (failure === "missing")
            return { ...value, meta: undefined } as unknown as D1Result<unknown>;
          throw new Error("Synthetic stopped response lost");
        }
        return value;
      }),
    );
    f.paid.beforeDispatch = async () => null;
    await expect(f.put()).rejects.toThrow();
    expect(injected).toBe(true);
    expect(f.bucket.calls.put).toBe(0);
    expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
      writer_state: "stopped",
    });
    expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_deletion_journals WHERE target_kind='blob'")
        .get(),
    ).toEqual({ n: 1 });
    await cleanupRecovered(f);
  },
);

test.each(["beforeDispatch", "authorize"])(
  "unsent cleanup survives %s query exhaustion and preserves unknown cost exposure",
  async (stage) => {
    const f = await fixture(undefined, NOW, (db) => faultDatabase(db, (_sql, value) => value));
    const before = f.paid.beforeDispatch.bind(f.paid);
    f.paid.beforeDispatch = async (admission, access) => {
      const permit = await before(admission, access);
      expect(permit).not.toBeNull();
      try {
        for (let i = 0; i < FILE_STORAGE_WORK.queries; i++)
          await f.core.statement("SELECT 1").all();
      } catch (error) {
        if (stage === "beforeDispatch") throw error;
      }
      return permit;
    };
    await expect(f.put()).rejects.toThrow();
    expect(f.bucket.calls.put).toBe(0);
    expect(
      f.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
    ).toEqual({ state: "held", writer_state: "stopped" });
    expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
      state: "dispatched",
    });
    const cost = f.db.sqlite
      .query("SELECT reserved_krw,settled_krw FROM v2_monthly_budget WHERE environment='preview'")
      .get() as { reserved_krw: number; settled_krw: number };
    expect(cost.reserved_krw).toBeGreaterThan(0);
    expect(cost.settled_krw).toBe(0);
    await cleanupRecovered(f);
  },
);

test("unsent token recovery rejects cloned or substituted identity and supports an already-deleting exact original", async () => {
  const f = await fixture(),
    saved: { admission: StorageAdmission | null } = { admission: null };
  const prepare = f.paid.prepare.bind(f.paid);
  f.paid.prepare = async (input) => {
    saved.admission = await prepare(input);
    return null;
  };
  await expect(f.put()).rejects.toThrow("PROCESSING_UNAVAILABLE");
  const paid = saved.admission?.paid;
  if (!paid) throw new Error("Synthetic admission missing");
  const request = paid.request;
  if (request.intent.kind !== "case_original") throw new Error("Synthetic original intent missing");
  const blob = {
    id: request.blobId,
    reservationId: request.reservationId,
    kind: "original" as const,
    visibility: "private" as const,
    logicalBytes: request.pending.logicalBytes,
    cipherBytes: request.pending.cipherBytes,
    cipherHash: request.pending.cipherHash ?? "",
    keyVersion: "binary_v1",
    contentHash: await digest(new TextEncoder().encode("hello")),
  };
  const registration = {
    blob,
    uploadId: request.intent.uploadId,
    uploadRevision: request.intent.uploadRevision,
    ordinal: request.intent.ordinal,
  };
  const files = createV2FilesRepository(f.core),
    capacity = createV2StorageCapacityRepository(f.core, "preview");
  const physical = capacity.prepareCapacity(paid.actor, {
    blobId: blob.id,
    ownerId: paid.actor.ownerId,
    objectKey: `private/${blob.id}`,
    maximumCipherBytes: blob.cipherBytes,
  });
  expect(await files.prepareOriginalPart(paid.actor, registration, paid, physical)).toBe(true);
  const pendingPayload = await f.core
    .statement("SELECT encrypted_payload FROM v2_blobs WHERE id=?", [blob.id])
    .first<string>("encrypted_payload");
  if (!pendingPayload) throw new Error("Synthetic pending envelope missing");
  const writer = capacity.prepareWrite({
    blobId: blob.id,
    objectKey: `private/${blob.id}`,
    byteLength: blob.cipherBytes,
  });
  expect(await capacity.beginPreparedWrite(writer, NOW)).toBe(true);
  const input = { ...registration, paid, writer, pendingPayload };
  const before = f.db.sqlite
    .query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?")
    .get(blob.id);
  for (const invalid of [
    { ...input, writer: { ...writer } },
    {
      ...input,
      writer: capacity.prepareWrite({
        blobId: blob.id,
        objectKey: writer.objectKey,
        byteLength: writer.byteLength,
      }),
    },
    {
      ...input,
      writer: createV2StorageCapacityRepository(f.core, "production").prepareWrite({
        blobId: blob.id,
        objectKey: writer.objectKey,
        byteLength: writer.byteLength,
      }),
    },
    { ...input, paid: { ...paid, actor: { ...paid.actor, ownerId: "foreign-owner" } } },
    { ...input, blob: { ...blob, id: "foreign-blob" } },
    { ...input, uploadId: "foreign-upload" },
    { ...input, uploadRevision: input.uploadRevision + 1 },
    { ...input, ordinal: input.ordinal + 1 },
    { ...input, pendingPayload: "substituted-envelope" },
  ]) {
    expect(await stopUnsentOriginalWrite(f.core, invalid)).toBe(false);
    expect(
      f.db.sqlite.query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?").get(blob.id),
    ).toEqual(before);
  }
  expect(await files.abandonOriginalPart(paid.actor, blob.id)).toBe(true);
  expect(await stopUnsentOriginalWrite(f.core, input)).toBe(true);
  expect(await stopUnsentOriginalWrite(f.core, input)).toBe(false);
  expect(await capacity.beginPreparedWrite(writer, NOW)).toBe(false);
  expect(f.bucket.calls.put).toBe(0);
  await cleanupRecovered(f);
});

test("a confirmed false start never acquires a running obligation and remains cleanable", async () => {
  let freeze: (() => void) | undefined;
  const f = await fixture(undefined, NOW, (db) =>
    faultDatabase(db, (sql, value) => {
      if (sql.startsWith("SELECT encrypted_payload FROM v2_blobs WHERE id=? AND state='pending'"))
        freeze?.();
      return value;
    }),
  );
  freeze = () => {
    f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
  };
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(0);
  expect(
    f.db.sqlite.query("SELECT writer_state,writer_token FROM v2_physical_blob_bindings").get(),
  ).toEqual({ writer_state: "prepared", writer_token: null });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='active'");
  await cleanupRecovered(f);
});

test("an ambiguous actual PUT is never recovered as not_sent and keeps cleanup blocked", async () => {
  const f = await fixture(undefined, NOW, (db) => faultDatabase(db, (_sql, value) => value));
  f.bucket.setPutAmbiguous(true);
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(1);
  expect(f.bucket.objects.size).toBe(1);
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "running",
  });
  const core = createV2Core(f.db.binding, f.core.cipher),
    deletion = createV2DeletionRepository(core);
  const journal = f.db.sqlite
    .query("SELECT id FROM v2_deletion_journals WHERE target_kind='blob'")
    .get() as { id: string };
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:04:00.000Z",
  );
  if (!lease) throw new Error("Synthetic lease missing");
  expect(await f.cleanupService.cleanup(lease)).toBe(false);
  expect(f.bucket.calls.delete).toBe(0);
});

test("a known R2 response with a lost stop receipt journals independently and remains cleanable", async () => {
  let injected = false;
  const f = await fixture(undefined, NOW, (db) =>
    faultDatabase(db, (sql, value) => {
      if (
        !injected &&
        sql.startsWith("UPDATE v2_physical_blob_bindings SET writer_state='stopped'")
      ) {
        injected = true;
        throw new Error("Synthetic stop receipt lost after actual PUT");
      }
      return value;
    }),
  );
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "stopped",
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  await cleanupRecovered(f);
  expect(f.bucket.objects.size).toBe(0);
});

test.each(["authorize", "put_throw", "no_evidence", "ledger_failure", "cleanup_failure"])(
  "metered real storage ledger preserves recovery semantics for %s",
  async (scenario) => {
    let notificationReads = 0,
      usageWrites = 0,
      cleanupFailure = false;
    const transports: string[] = [];
    // Explicit synthetic authenticated console evidence, never a provider bill.
    const metering: FileStorageMetering = async (request, permit, transport) => {
      transports.push(transport.transport);
      const receipt = {
        id: crypto.randomUUID(),
        attemptId: permit.attemptId,
        invocationId: request.plan.invocationId,
        providerRequestId: null,
        dispatchToken: permit.dispatchToken,
        observedAt: NOW,
        transport: transport.transport,
        definitiveNoCharge: false,
        meteringComplete: false,
        quantities: [],
        chargedUsd: null,
        modelTokenDetails: null,
      };
      return {
        receipt,
        evidence: {
          digest: await runtimeDigest(receipt),
          evidenceHash: "e".repeat(64),
          method: "authenticated_console",
          verifiedAt: NOW,
        },
      };
    };
    const f = await fixture(
      undefined,
      NOW,
      (db) =>
        faultDatabase(db, (sql, value) => {
          if (
            scenario === "cleanup_failure" &&
            !cleanupFailure &&
            sql.startsWith("UPDATE v2_physical_blob_bindings SET writer_state='stopped'")
          ) {
            cleanupFailure = true;
            throw new Error("Synthetic cleanup response loss before notification");
          }
          if (sql.startsWith("SELECT h.state AS dispatch_state")) notificationReads++;
          if (sql.startsWith("INSERT INTO v2_runtime_usage")) usageWrites++;
          return value;
        }),
      scenario === "no_evidence" ? undefined : metering,
    );
    if (scenario === "put_throw") f.bucket.setPutAmbiguous(true);
    else {
      const before = f.paid.beforeDispatch.bind(f.paid);
      f.paid.beforeDispatch = async (admission, access) => {
        const permit = await before(admission, access);
        expect(permit).not.toBeNull();
        // Lose normal admission during the final authorize, after financial CAS.
        try {
          for (let i = 0; i < FILE_STORAGE_WORK.queries; i++)
            await f.core.statement("SELECT 1").all();
        } catch {}
        return permit;
      };
    }
    if (scenario === "ledger_failure")
      f.db.sqlite.exec(
        "CREATE TRIGGER synthetic_usage_failure BEFORE INSERT ON v2_runtime_usage BEGIN SELECT RAISE(ABORT,'synthetic'); END",
      );
    await expect(f.put()).rejects.toThrow();
    expect(f.bucket.calls.put).toBe(scenario === "put_throw" ? 1 : 0);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_deletion_journals WHERE target_kind='blob'")
        .get(),
    ).toEqual({ n: 1 });
    const recorded =
      scenario === "authorize" || scenario === "put_throw" || scenario === "cleanup_failure";
    if (scenario === "cleanup_failure") expect(cleanupFailure).toBe(true);
    expect(notificationReads).toBe(scenario === "no_evidence" ? 0 : 1);
    expect(usageWrites).toBe(recorded ? 1 : 0);
    expect(transports).toEqual(
      scenario === "no_evidence" ? [] : [scenario === "put_throw" ? "unknown" : "not_sent"],
    );
    expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
      state: recorded ? "unknown" : "dispatched",
    });
    const money = f.db.sqlite
      .query(
        "SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget WHERE environment='preview'",
      )
      .get() as { reserved_krw: number; ambiguous_krw: number; settled_krw: number };
    expect(recorded ? money.ambiguous_krw : money.reserved_krw).toBeGreaterThan(0);
    expect(money.settled_krw).toBe(0);
    await expect(f.core.statement("SELECT 1").all()).rejects.toThrow("PROCESSING_UNAVAILABLE");
    if (scenario !== "put_throw") await cleanupRecovered(f);
    else
      expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual(
        { writer_state: "running" },
      );
  },
);

test("signed global file composition stores an encrypted PDF chunk with actual workerd D1 capacity and retains unknown billing", async () => {
  setSystemTime(new Date(NOW));
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("local original test"); } }',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const f = await ready({ getLimit: 100, headLimit: 100, deleteLimit: 100 });
    f.db.sqlite
      .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
      .run(f.workspaceId);
    f.db.sqlite
      .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,'customer',?)")
      .run(`account-type:${f.actor.ownerId}`, NOW);
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const name of (await readdir("drizzle")).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
      await db.batch(
        (await Bun.file(`drizzle/${name}`).text())
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((sql) => db.prepare(sql)),
      );
    }
    // Only synthetic, pre-upload fixture rows; all actual admission runs in workerd.
    const inserts = [db.prepare("PRAGMA defer_foreign_keys=ON")];
    for (const { name } of f.db.sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]) {
      // Migration-owned derived rows already exist in native D1. Source-row
      // INSERT triggers reconstruct them; importing canonical mirrors directly
      // would bypass the production integrity contract.
      if (
        [
          "v2_physical_storage_totals",
          "v2_physical_binding_totals",
          "v2_physical_total_mutations",
          "v2_storage_funding_heads",
          "v2_storage_integrity_faults",
          "v2_storage_carryover",
        ].includes(name)
      )
        continue;
      for (const row of f.db.sqlite.query(`SELECT * FROM ${name}`).all() as Record<
        string,
        unknown
      >[]) {
        if (name === "app_metadata" && !String(row.key).startsWith("account-type:")) continue;
        inserts.push(
          db
            .prepare(
              `INSERT INTO ${name}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row)
                .map(() => "?")
                .join(",")})`,
            )
            .bind(...Object.values(row)),
        );
      }
    }
    await db.batch(inserts);
    const measured = measureD1Work(db);
    const bucket = r2(),
      env = {
        ...testEnvironment(measured.binding),
        APP_ENV: "preview",
        CASE_PRIVATE_R2: bucket.port,
        CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
      } as Env;
    const token = f.db.sqlite
      .query("SELECT token FROM session WHERE user_id=?")
      .get(f.actor.ownerId) as { token: string };
    const headers = {
      cookie: await signedSessionCookie(token.token, env.BETTER_AUTH_SECRET),
      origin: env.BETTER_AUTH_URL,
    };
    const app = new Hono().route("/api", api),
      base = `/api/v2/cases/${f.workspaceId}/files`;
    const bytes = new Uint8Array(
      await Bun.file("tests/fixtures/media/text-two-pages.pdf").arrayBuffer(),
    );
    const response = await app.request(
      base,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "if-match": "1",
        },
        body: JSON.stringify({
          name: "합성.pdf",
          byteLength: bytes.length,
          mediaType: "application/pdf",
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const session = (await response.json()) as { fileId: string; uploadSession: string };
    const list = await app.request(base, { headers }, env);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { status: string }[]).map((v) => v.status)).toEqual([
      "reserved",
    ]);
    const put = () =>
      app.request(
        `${base}/${session.fileId}/parts/0`,
        {
          method: "PUT",
          headers: {
            ...headers,
            "content-type": "application/octet-stream",
            "x-upload-session": session.uploadSession,
          },
          body: bytes,
        },
        env,
      );
    measured.reset();
    expect((await put()).status).toBe(200);
    expect(measured.work.statements).toBeLessThanOrEqual(FILE_STORAGE_WORK.queries + 20);
    expect(measured.work.rowsRead).toBeLessThanOrEqual(FILE_STORAGE_WORK.rowsRead + 1000);
    expect(measured.work.rowsWritten).toBeLessThanOrEqual(FILE_STORAGE_WORK.rowsWritten + 100);
    console.info("Synthetic signed native upload D1 work", measured.work);
    expect(bucket.calls.put).toBe(1);
    const core = createV2Core(db, f.core.cipher);
    const plan = await core
      .statement("SELECT payload_json FROM v2_storage_paid_executions")
      .first<string>("payload_json");
    expect(JSON.parse(plan ?? "null").plan.quantities.map((q: { sku: string }) => q.sku)).toEqual([
      "r2_class_a_requests",
      "worker_requests",
      "worker_cpu_ms",
      "d1_rows_read",
      "d1_rows_written",
    ]);
    // Same production-mode route remains closed when that environment has no
    // verified storage/price/funding projection; preview evidence cannot substitute.
    const production = { ...env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "true" } as Env;
    const revision = await core
      .statement("SELECT revision FROM v2_workspaces WHERE id=?", [f.workspaceId])
      .first<number>("revision");
    const reserved = await app.request(
      base,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "if-match": String(revision),
        },
        body: JSON.stringify({
          name: "격리 production 합성.pdf",
          byteLength: bytes.length,
          mediaType: "application/pdf",
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        }),
      },
      production,
    );
    expect(reserved.status).toBe(201);
    const pending = (await reserved.json()) as { fileId: string; uploadSession: string };
    expect((await app.request(base, { headers }, production)).status).toBe(200);
    const denied = await app.request(
      `${base}/${pending.fileId}/parts/0`,
      {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "x-upload-session": pending.uploadSession,
        },
        body: bytes,
      },
      production,
    );
    expect(denied.status).toBe(503);
    expect(await denied.json()).toMatchObject({ error: { code: "FILE_PROCESSING_FAILED" } });
    expect(bucket.calls.put).toBe(1);
    expect(
      await core
        .statement("SELECT state,writer_state FROM v2_physical_blob_bindings")
        .first<{ state: string; writer_state: string }>(),
    ).toEqual({ state: "held", writer_state: "stopped" });
    expect(
      await core
        .statement("SELECT state FROM v2_storage_paid_executions")
        .first<{ state: string }>(),
    ).toEqual({
      state: "dispatched",
    });
    expect(
      await core.statement("SELECT count(*) AS n FROM v2_upload_parts").first<number>("n"),
    ).toBe(1);
    const exposure = await core
      .statement(
        "SELECT reserved_krw,settled_krw FROM v2_monthly_budget WHERE environment='preview'",
      )
      .first<{ reserved_krw: number; settled_krw: number }>();
    expect(exposure?.reserved_krw).toBeGreaterThan(0);
    expect(exposure?.settled_krw).toBe(0);
    const runtime = createV2PaidRuntimeRepository(core, "preview", verifier);
    const current = await runtime.exposure(NOW);
    if (!current) throw new Error("Synthetic native runtime missing");
    expect(await runtime.freeze("2026-10", current.control_revision, 1, NOW)).toBe(true);
    const updatedPrice = { ...f.pp, id: "zz-native-refreshed-price" };
    const updatedFunding = { ...f.fp, id: "zz-native-refreshed-funding" };
    expect(await runtime.putPricingProof(updatedPrice, NOW)).toBe(true);
    expect(await runtime.putFundingProof(updatedFunding, NOW)).toBe(true);
    expect(
      await createV2RuntimeRefreshRepository(core, "preview", verifier).refresh(
        {
          id: "native-same-allocation-refresh",
          month: "2026-10",
          expectedControlRevision: current.control_revision + 1,
          allocationVersion: 1,
          allocationProofId: f.ap.id,
          pricingProofId: updatedPrice.id,
          fundingProofId: updatedFunding.id,
        },
        NOW,
      ),
    ).toBe(true);
    expect((await runtime.exposure(NOW))?.reserved_krw).toBe(exposure?.reserved_krw);
    expect(
      await core.statement("SELECT count(*) n FROM v2_runtime_refreshes").first<number>("n"),
    ).toBe(1);
    const stored = [...bucket.objects.values()][0];
    if (!stored) throw new Error("Synthetic R2 object missing");
    expect(
      await decryptPart(
        f.core.cipher,
        {
          environment: "preview",
          ownerId: f.actor.ownerId,
          fileId: session.fileId,
          uploadId: session.uploadSession,
          revision: 1,
          index: 0,
          byteLength: bytes.length,
        },
        stored,
      ),
    ).toEqual(bytes);
    // An idempotent retry reads the same bound object and does not issue a second PUT.
    expect((await put()).status).toBe(200);
    expect(bucket.calls.put).toBe(1);
  } finally {
    await mf.dispose();
    setSystemTime();
  }
}, 30000);

test.each(["expiry", "capacity", "frozen"])(
  "file storage refuses expired or unavailable %s before creating an intent",
  async (failure) => {
    const f = await fixture(
      failure === "capacity" ? 10 : undefined,
      failure === "expiry" ? "2026-10-31T23:59:00.000Z" : NOW,
    );
    if (failure === "frozen")
      f.db.sqlite.query("UPDATE v2_runtime_controls SET phase='frozen'").run();
    await expect(f.put()).rejects.toThrow("PROCESSING_UNAVAILABLE");
    expect(f.bucket.calls.put).toBe(0);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get()).toEqual({
      held_bytes: 0,
    });
  },
);

test("capacity freeze after paid preparation rolls back pending, physical binding and financial hold together", async () => {
  const f = await fixture(),
    prepare = f.paid.prepare.bind(f.paid);
  f.paid.prepare = async (input) => {
    const admission = await prepare(input);
    f.db.sqlite.query("UPDATE v2_runtime_controls SET phase='frozen'").run();
    return admission;
  };
  await expect(f.put()).rejects.toThrow("CONFLICT");
  expect(f.bucket.calls.put).toBe(0);
  for (const table of ["v2_blobs", "v2_physical_blob_bindings", "v2_cost_attempts"])
    expect(f.db.sqlite.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
});

test("deletion during a late PUT retains the writer obligation, then stops it without publishing the original", async () => {
  const f = await fixture();
  const deletion = createV2DeletionRepository(f.core);
  let lease: CleanupLease | null = null;
  f.bucket.setPutHook(async () => {
    expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
      writer_state: "running",
    });
    const revision = f.db.sqlite
      .query("SELECT revision FROM v2_workspaces WHERE id=?")
      .get(f.workspaceId) as { revision: number };
    expect(
      await deletion.file(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: revision.revision },
        f.session.fileId,
        1,
      ),
    ).toBe(true);
    expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
      writer_state: "running",
    });
    const journal = await deletion.findByTarget("file", f.session.fileId);
    if (!journal) throw new Error("Synthetic deletion journal missing");
    lease = await deletion.acquire(
      journal.id,
      crypto.randomUUID(),
      NOW,
      "2026-10-06T00:04:00.000Z",
    );
    if (!lease) throw new Error("Synthetic cleanup lease missing");
    expect(await f.service.cleanup(lease)).toBe(false);
    expect(f.bucket.calls.delete).toBe(0);
  });
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(1);
  expect(
    f.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ state: "held", writer_state: "stopped" });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_tombstones WHERE target_kind='file'").get(),
  ).toEqual({ n: 1 });
  if (!lease) throw new Error("Synthetic cleanup lease missing");
  // A failed delete preserves its physical obligation. A later successful
  // DELETE + absent HEAD receipt releases it without accepting another PUT.
  f.bucket.setDeleteFails(true);
  await expect(f.cleanupService.cleanup(lease)).rejects.toThrow();
  expect(f.db.sqlite.query("SELECT state FROM v2_physical_blob_bindings").get()).toEqual({
    state: "held",
  });
  expect(f.bucket.objects.size).toBe(1);
  f.bucket.setDeleteFails(false);
  expect(await f.cleanupService.cleanup(lease)).toBe(true);
  expect(f.bucket.objects.size).toBe(0);
  expect(f.db.sqlite.query("SELECT state FROM v2_physical_blob_bindings").get()).toEqual({
    state: "released",
  });
  expect(f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get()).toEqual({
    held_bytes: 0,
  });
  const retry = createFilesService(createV2Core(f.db.binding, f.core.cipher), {
    environment: "preview",
    bucket: f.bucket.port,
    clock: () => NOW,
  });
  await expect(
    retry.putPart(
      f.actor.ownerId,
      f.workspaceId,
      f.session.fileId,
      f.session.uploadSession,
      0,
      new Response("hello").body,
    ),
  ).rejects.toThrow("NOT_FOUND");
  expect(f.bucket.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
});
