import { expect, setSystemTime, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Hono } from "hono";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { api } from "../src/server/api";
import { createV2Core } from "../src/server/db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { decryptPart } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { r2 } from "./helpers/file-processing-fixture";
import { NOW, ready } from "./helpers/storage-capacity";

async function fixture(capacityBytes?: number, now = NOW) {
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
  const core = fileStorageRequestCore(f.core, false);
  const paid = createFileStorageBudget(core, "preview", f.actor.ownerId, () => now);
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
    const bucket = r2(),
      env = {
        ...testEnvironment(db),
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
    expect((await put()).status).toBe(200);
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
  await expect(f.service.cleanup(lease)).rejects.toThrow();
  expect(f.db.sqlite.query("SELECT state FROM v2_physical_blob_bindings").get()).toEqual({
    state: "held",
  });
  expect(f.bucket.objects.size).toBe(1);
  f.bucket.setDeleteFails(false);
  expect(await f.service.cleanup(lease)).toBe(true);
  expect(f.bucket.objects.size).toBe(0);
  expect(f.db.sqlite.query("SELECT state FROM v2_physical_blob_bindings").get()).toEqual({
    state: "released",
  });
  expect(f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get()).toEqual({
    held_bytes: 0,
  });
  await expect(f.put()).rejects.toThrow("NOT_FOUND");
  expect(f.bucket.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
});
