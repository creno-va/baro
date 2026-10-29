import { expect, test } from "bun:test";
import { z } from "zod";
import {
  createV2Core,
  MAX_REHYDRATE_BYTES,
  readSnapshot,
  type V2Core,
} from "../src/server/db/v2-core";
import { createReportsService } from "../src/server/modules/reports/service";
import { countD1Calls } from "./helpers/d1-call-count";
import { reportFixture } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";

async function fixture() {
  const f = await reportFixture();
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const row = f.db.sqlite
    .query("SELECT snapshot_id,workspace_revision FROM v2_reports WHERE id=?")
    .get(report.id) as { snapshot_id: string; workspace_revision: number };
  const read = (core: V2Core = f.core, batch = true) =>
    readSnapshot(
      core,
      f.actor,
      row.snapshot_id,
      "report",
      report.id,
      row.workspace_revision,
      z.unknown(),
      batch ? { batchInitialRead: true } : undefined,
    );
  const tombstone = (kind: "report" | "workspace" | "account") => {
    const id =
      kind === "report" ? report.id : kind === "workspace" ? f.workspaceId : f.actor.ownerId;
    f.db.sqlite
      .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
      .run(kind, id, f.actor.now);
  };
  return { ...f, report, row, read, tombstone };
}

test("report snapshot batch preserves exact plaintext and all three SQL checks with two calls", async () => {
  const f = await fixture();
  const meter = countD1Calls(f.db.binding);
  const core = createV2Core(meter.binding, f.core.cipher);
  const old = await f.read(core, false);
  expect(meter.work).toEqual({ calls: 3, statements: 3 });
  meter.reset();
  expect(await f.read(core)).toEqual(old);
  expect(meter.work).toEqual({ calls: 2, statements: 3 });
});

for (const failure of [
  "owner",
  "purpose",
  "target",
  "revision",
  "state",
  "oversize",
  "report",
  "workspace",
  "account",
] as const)
  test(`report snapshot batch does not fetch parts behind invalid ${failure}`, async () => {
    const f = await fixture();
    let fetched = -1;
    const binding = {
      ...f.db.binding,
      async batch<T>(statements: D1PreparedStatement[]) {
        const results = await f.db.binding.batch<T>(statements);
        fetched = results[1]?.results.length ?? -1;
        return results;
      },
    } as D1Database;
    if (failure === "report" || failure === "workspace" || failure === "account")
      f.tombstone(failure);
    else if (failure === "oversize") {
      // Seed a distinct oversized snapshot; do not disable or bypass the
      // immutable-header trigger on the existing published report.
      f.db.sqlite
        .query(
          "INSERT INTO v2_private_snapshots(id,owner_id,workspace_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at,state) SELECT 'synthetic-oversize',owner_id,workspace_id,purpose,'synthetic-oversize-target',revision,part_count,?,'synthetic-envelope',created_at,'published' FROM v2_private_snapshots WHERE id=?",
        )
        .run(MAX_REHYDRATE_BYTES + 1, f.row.snapshot_id);
      f.db.sqlite
        .query(
          "INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT 'synthetic-oversize-part','synthetic-oversize',part_index,byte_length,encrypted_payload FROM v2_private_parts WHERE snapshot_id=?",
        )
        .run(f.row.snapshot_id);
    } else if (failure === "state")
      f.db.sqlite
        .query("UPDATE v2_private_snapshots SET state='sealed' WHERE id=?")
        .run(f.row.snapshot_id);
    const work = readSnapshot(
      createV2Core(binding, f.core.cipher),
      failure === "owner" ? { ...f.actor, ownerId: "synthetic-foreign-owner" } : f.actor,
      failure === "oversize" ? "synthetic-oversize" : f.row.snapshot_id,
      failure === "purpose" ? "file_manifest" : "report",
      failure === "target"
        ? "synthetic-foreign-target"
        : failure === "oversize"
          ? "synthetic-oversize-target"
          : f.report.id,
      f.row.workspace_revision + (failure === "revision" ? 1 : 0),
      z.unknown(),
      { batchInitialRead: true },
    );
    if (failure === "oversize") await expect(work).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
    else expect(await work).toBeNull();
    expect(fetched).toBe(0);
  });

for (const failure of ["count", "order", "bytes", "ciphertext", "hash"] as const)
  test(`report snapshot batch rejects ${failure} corruption`, async () => {
    const f = await fixture();
    let differentEnvelope = "";
    if (failure === "hash") {
      const part = f.db.sqlite
        .query("SELECT id,encrypted_payload FROM v2_private_parts WHERE snapshot_id=?")
        .get(f.row.snapshot_id) as { id: string; encrypted_payload: string };
      const context = {
        table: "v2_private_parts",
        column: "encrypted_payload",
        rowId: part.id,
        userId: f.actor.ownerId,
        targetId: f.report.id,
        purpose: "report",
        revision: f.row.workspace_revision,
        part: 0,
      } as const;
      const plaintext = await f.core.cipher.decrypt(part.encrypted_payload, context);
      const changed = plaintext.replace("합성", "가상");
      expect(changed).not.toBe(plaintext);
      expect(new TextEncoder().encode(changed).length).toBe(
        new TextEncoder().encode(plaintext).length,
      );
      differentEnvelope = await f.core.cipher.encrypt(changed, context);
    }
    // Published data cannot be mutated in SQL. Inject corrupt read results at
    // the offline adapter boundary to exercise the unchanged decoder checks.
    const binding = {
      ...f.db.binding,
      async batch<T>(statements: D1PreparedStatement[]) {
        const results = await f.db.binding.batch<T>(statements);
        const header = results[0]?.results[0] as Record<string, unknown>;
        const part = results[1]?.results[0] as Record<string, unknown>;
        if (failure === "count") header.part_count = Number(header.part_count) + 1;
        if (failure === "order") part.part_index = Number(part.part_index) + 1;
        if (failure === "bytes") part.byte_length = Number(part.byte_length) + 1;
        if (failure === "ciphertext") part.encrypted_payload = "synthetic-corrupt";
        if (failure === "hash") part.encrypted_payload = differentEnvelope;
        return results;
      },
    } as D1Database;
    await expect(f.read(createV2Core(binding, f.core.cipher))).rejects.toThrow();
  });

for (const change of ["report", "workspace", "account", "header"] as const)
  test(`report snapshot still rechecks ${change} after asynchronous decryption`, async () => {
    const f = await fixture();
    let changed = false;
    const core = createV2Core(f.db.binding, {
      ...f.core.cipher,
      async decrypt(...args: Parameters<typeof f.core.cipher.decrypt>) {
        const value = await f.core.cipher.decrypt(...args);
        if (!changed && args[1].table === "v2_private_parts") {
          changed = true;
          if (change === "header")
            f.db.sqlite
              .query("UPDATE v2_private_snapshots SET state='abandoned' WHERE id=?")
              .run(f.row.snapshot_id);
          else f.tombstone(change);
        }
        return value;
      },
    });
    expect(await f.read(core)).toBeNull();
    expect(changed).toBe(true);
  });

for (const failure of ["throw", "missing_result"] as const)
  test(`report snapshot batch fails closed on ${failure}`, async () => {
    const f = await fixture();
    let decrypted = 0;
    const core = createV2Core(
      {
        ...f.db.binding,
        async batch() {
          if (failure === "throw") throw new Error("synthetic database unavailable");
          return [];
        },
      } as unknown as D1Database,
      {
        ...f.core.cipher,
        async decrypt(...args: Parameters<typeof f.core.cipher.decrypt>) {
          decrypted++;
          return f.core.cipher.decrypt(...args);
        },
      },
    );
    await expect(f.read(core)).rejects.toThrow();
    expect(decrypted).toBe(0);
  });

test("report review head deletion during body decryption does not return legacy fallback", async () => {
  const f = await fixture();
  let changed = false;
  const core = createV2Core(f.db.binding, {
    ...f.core.cipher,
    async decrypt(...args: Parameters<typeof f.core.cipher.decrypt>) {
      const value = await f.core.cipher.decrypt(...args);
      if (!changed && args[1].table === "v2_private_parts" && args[1].targetId === f.report.id) {
        changed = true;
        f.db.sqlite
          .query(
            "DELETE FROM v2_private_snapshots WHERE purpose='report' AND target_id=? AND revision=?",
          )
          .run(f.report.id, f.row.workspace_revision + 1);
      }
      return value;
    },
  });
  await expect(
    createReportsService(core, f.deps).get(f.actor.ownerId, f.workspaceId),
  ).rejects.toThrow("STALE_REVISION");
  expect(changed).toBe(true);
});

test("signed report writes retain legacy role fallback and fresh consent with combined access", async () => {
  const f = await reportHttpFixture();
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  f.db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'lawyer_applicant',?)")
    .run(f.actor.ownerId, f.actor.now);
  const routes = [
    ["POST", `/api/v2/cases/${f.workspaceId}/reports`],
    ["PATCH", `/api/v2/cases/${f.workspaceId}/reports`],
    ["POST", `/api/v2/reports/${report.id}/zip`],
  ] as const;
  for (const preference of [null, "invalid", "lawyer", "customer"]) {
    f.db.sqlite
      .query("DELETE FROM app_metadata WHERE key=?")
      .run(`account-type:${f.actor.ownerId}`);
    if (preference)
      f.db.sqlite
        .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
        .run(`account-type:${f.actor.ownerId}`, preference, f.actor.now);
    for (const [method, path] of routes) {
      const response = await f.app.request(
        path,
        {
          method,
          headers: {
            cookie: f.cookie,
            origin: f.env.BETTER_AUTH_URL,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ unsupported: true }),
        },
        f.env,
      );
      // Both explicit account types and the legacy lawyer fallback reach strict
      // input validation; stale/missing consent still stops all writes below.
      expect(response.status).toBe(400);
    }
  }
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  for (const [method, path] of routes) {
    const response = await f.app.request(
      path,
      {
        method,
        headers: { cookie: f.cookie, origin: f.env.BETTER_AUTH_URL },
        body: "{}",
      },
      f.env,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CONSENT_REQUIRED" } });
  }
});
