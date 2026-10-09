import { expect, test } from "bun:test";
import { V2_LIMITS } from "../src/contracts/v2";
import { createV2Core } from "../src/server/db/v2-core";
import {
  applyReportWorkPlan,
  REPORT_QUERY_LIMIT,
  reportRequestCore,
  reportWorkPlan,
} from "../src/server/modules/reports/limits";
import { readyFile, reportFixture } from "./helpers/report-fixture";

test("large synchronous ZIP plans fail before original GET/PUT; the same reviewed report can export a smaller selection", async () => {
  const f = await reportFixture(),
    ids: string[] = [];
  for (let i = 0; i < 4; i++)
    ids.push((await readyFile(f, `synthetic original ${i}`)).session.fileId);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId),
    before = { ...f.bucket.calls };
  await expect(f.reports.zip(f.actor.ownerId, report.id, crypto.randomUUID(), ids)).rejects.toThrow(
    "EXPORT_LIMIT_EXCEEDED",
  );
  expect(f.bucket.calls).toEqual(before);
  expect(() =>
    reportWorkPlan({
      pdfBytes: 4_000_000,
      zipBytes: 900_000_000,
      selectedFiles: 1,
      originalParts: 108,
      sourceRows: 5,
      reportFiles: 4,
    }),
  ).toThrow("EXPORT_LIMIT_EXCEEDED");
  const queries = f.db.queryCount;
  const zip = await f.reports.zip(f.actor.ownerId, report.id, crypto.randomUUID(), [
    ids[0] as string,
    ids[1] as string,
  ]);
  const bytes = await new Response(zip.body).arrayBuffer();
  expect(bytes.byteLength).toBe(zip.byteLength);
  expect(f.db.queryCount - queries).toBeLessThan(800);
});
test("D1 query limit counts bound reads and every batch statement before dispatch", async () => {
  const f = await reportFixture(),
    core = reportRequestCore(f.core, false),
    before = f.db.queryCount;
  for (let i = 0; i < REPORT_QUERY_LIMIT - 1; i++)
    await core.statement("SELECT ? AS n", [i]).first();
  await expect(
    core.binding.batch([core.statement("SELECT 1"), core.statement("SELECT 2")]),
  ).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
  expect(f.db.queryCount - before).toBe(REPORT_QUERY_LIMIT - 1);
  await core.statement("SELECT 1").first();
  await expect(core.statement("SELECT 1").first()).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
  expect(f.db.queryCount - before).toBe(REPORT_QUERY_LIMIT);
});
test("actual D1 row receipts enforce the quoted envelope; missing row metadata does not authorize native production composition", async () => {
  const f = await reportFixture(),
    before = f.db.queryCount;
  const strict = reportRequestCore(f.core);
  await expect(strict.statement("SELECT 1").first()).rejects.toThrow("STORAGE_UNAVAILABLE");
  const prepare = f.db.binding.prepare.bind(f.db.binding);
  // Explicit SQL adapter supplies synthetic D1 billing metadata. This is not an
  // observation of remote Cloudflare row scans or a real platform cost receipt.
  const binding = {
    prepare(sql: string) {
      const s = prepare(sql);
      const all = s.all.bind(s);
      return {
        ...s,
        all: async () => {
          const r = await all();
          return { ...r, meta: { ...r.meta, rows_read: 500000, rows_written: 0 } };
        },
      };
    },
  } as unknown as D1Database;
  const core = reportRequestCore(createV2Core(binding, f.core.cipher));
  const plan = reportWorkPlan({ pdfBytes: 100, sourceRows: 1, reportFiles: 0 });
  applyReportWorkPlan(core, plan);
  await core.binding.prepare("SELECT 1").all();
  await expect(core.binding.prepare("SELECT 1").all()).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
  const used = f.db.queryCount;
  await expect(core.binding.prepare("SELECT 1").all()).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
  expect(f.db.queryCount).toBe(used);
  expect(f.db.queryCount - before).toBe(3);
});

test("single-query stream fence rechecks role, consent, same-revision source identity, immutable report and deletion", async () => {
  const { exportFence } = await import("../src/server/modules/reports/fence");
  const { sourceDigest } = await import("../src/server/modules/reports/source");
  const f = await reportFixture();
  const file = await readyFile(f, "synthetic fence original");
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const row = f.db.sqlite.query("SELECT * FROM v2_reports WHERE id=?").get(report.id) as {
    id: string;
    revision: number;
    workspace_id: string;
    snapshot_id: string;
    encrypted_payload: string;
  };
  const fence = await exportFence(
    f.core,
    f.actor,
    row,
    await sourceDigest(f.core, f.actor, f.workspaceId),
    () => f.actor.now,
  );
  let before = f.db.queryCount;
  await fence.check();
  expect(f.db.queryCount - before).toBe(1);
  const deny = async () => {
    before = f.db.queryCount;
    await expect(fence.check()).rejects.toThrow("STALE_REVISION");
    expect(f.db.queryCount - before).toBe(1);
  };
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?, 'lawyer',?)")
    .run(`account-type:${f.actor.ownerId}`, f.actor.now);
  await deny();
  f.db.sqlite
    .query("UPDATE app_metadata SET value='customer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  await fence.check();
  f.db.sqlite
    .query("UPDATE user_consents SET terms_version='old-policy' WHERE user_id=?")
    .run(f.actor.ownerId);
  await deny();
  const { CURRENT_POLICY_VERSIONS } = await import("../src/contracts/consent");
  f.db.sqlite
    .query("UPDATE user_consents SET terms_version=? WHERE user_id=?")
    .run(CURRENT_POLICY_VERSIONS.termsVersion, f.actor.ownerId);
  const payload = (
    f.db.sqlite
      .query("SELECT encrypted_payload FROM v2_files WHERE id=?")
      .get(file.session.fileId) as { encrypted_payload: string }
  ).encrypted_payload;
  f.db.sqlite
    .query("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
    .run(`${payload}x`, file.session.fileId);
  await deny();
  f.db.sqlite
    .query("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
    .run(payload, file.session.fileId);
  await fence.check();
  f.db.sqlite
    .query("UPDATE v2_reports SET encrypted_payload=? WHERE id=?")
    .run(`${row.encrypted_payload}x`, row.id);
  await deny();
  f.db.sqlite
    .query("UPDATE v2_reports SET encrypted_payload=? WHERE id=?")
    .run(row.encrypted_payload, row.id);
  await fence.check();
  f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspaceId);
  await deny();
});

test("report work plan admits the exact query/source boundary and rejects the next chunk or source row", () => {
  const input = { pdfBytes: 262144, sourceRows: 250, reportFiles: 33 };
  expect(reportWorkPlan(input)).toEqual({ queries: 800, rowsRead: 2700000, rowsWritten: 1000 });
  expect(() => reportWorkPlan({ ...input, pdfBytes: input.pdfBytes + 1 })).toThrow(
    "EXPORT_LIMIT_EXCEEDED",
  );
  expect(() => reportWorkPlan({ ...input, sourceRows: input.sourceRows + 1 })).toThrow(
    "EXPORT_LIMIT_EXCEEDED",
  );
});

test("an actual one-upload-part ZIP preserves every byte; the next-byte multipart plan fails before original GET/export PUT", async () => {
  const f = await reportFixture();
  const original = "S".repeat(V2_LIMITS.chunkBytes);
  const file = await readyFile(f, original);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const before = f.db.queryCount;
  const zip = await f.reports.zip(f.actor.ownerId, report.id, crypto.randomUUID(), [
    file.session.fileId,
  ]);
  const bytes = new Uint8Array(await new Response(zip.body).arrayBuffer());
  expect(bytes.byteLength).toBe(zip.byteLength);
  // Single-entry stored ZIP: local header includes the UTF-8 filename and no data descriptor.
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint32(0, true)).toBe(0x04034b50);
  const start = 30 + header.getUint16(26, true) + header.getUint16(28, true);
  expect(bytes.subarray(start, start + file.bytes.byteLength)).toEqual(file.bytes);
  expect(f.db.queryCount - before).toBeLessThanOrEqual(800);

  const larger = await reportFixture();
  const split = await readyFile(larger, `${original}S`);
  const largerReport = await larger.reports.get(larger.actor.ownerId, larger.workspaceId);
  const calls = { ...larger.bucket.calls };
  const objects = larger.bucket.objects.size;
  await expect(
    larger.reports.zip(larger.actor.ownerId, largerReport.id, crypto.randomUUID(), [
      split.session.fileId,
    ]),
  ).rejects.toThrow("EXPORT_LIMIT_EXCEEDED");
  expect(larger.bucket.calls).toEqual(calls);
  expect(larger.bucket.objects.size).toBe(objects);
});
