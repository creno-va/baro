import { expect, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import type { PrivateBucket } from "../src/server/modules/files/service";
import { reportRequestCore } from "../src/server/modules/reports/limits";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { createReportsService } from "../src/server/modules/reports/service";
import { reportFixture } from "./helpers/report-fixture";

/** Real SQLite migrations, AES, physical admission and runtime transport journal.
 * Only the R2/font/stream adapters are offline; no actual Cloudflare call is claimed. */
async function setup(wrongReceipt = false) {
  const f = await reportFixture();
  f.db.sqlite.exec(
    "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
  );
  const core = reportRequestCore(
    createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false }),
    false,
  );
  const env = { APP_ENV: "preview", CASE_PRIVATE_R2: f.bucketPort } as Env;
  const { testOnlyUnmeteredStorage: _test, ...deps } = f.deps;
  const costs = createReportDependencies(env, core, f.actor.ownerId, () => f.actor.now).costs;
  if (!costs) throw new Error("Synthetic report runtime absent");
  const bucket: PrivateBucket = {
    ...f.bucketPort,
    put: async (key, value, options) => {
      const receipt = await f.bucketPort.put(key, value, options);
      return wrongReceipt && receipt ? Object.assign(receipt, { size: receipt.size + 1 }) : receipt;
    },
  };
  const reports = createReportsService(core, {
    ...deps,
    bucket,
    costs,
  });
  const draft = await reports.get(f.actor.ownerId, f.workspaceId);
  return { ...f, reports, draft };
}

function output(f: Awaited<ReturnType<typeof setup>>) {
  return f.db.sqlite
    .query(
      "SELECT b.id,b.state,p.writer_state,p.state physical_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='report_pdf'",
    )
    .get() as { id: string; state: string; writer_state: string; physical_state: string };
}

function cleanupTargets(f: Awaited<ReturnType<typeof setup>>, blobId: string) {
  return f.db.sqlite
    .query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob' AND target_id=?")
    .get(blobId);
}

function transport(f: Awaited<ReturnType<typeof setup>>) {
  return f.db.sqlite.query("SELECT state,transport FROM v2_execution_admissions").get();
}

test("exact R2 response survives writer-stop persistence failure with independent cleanup", async () => {
  const f = await setup();
  f.db.sqlite.exec(`CREATE TEMP TRIGGER synthetic_stop_failure BEFORE UPDATE OF writer_state ON v2_physical_blob_bindings
    WHEN NEW.writer_state='stopped' AND OLD.writer_state='running' BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END`);
  await expect(f.reports.pdf(f.actor.ownerId, f.draft.id)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "deleting",
    writer_state: "running",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 1 });
  expect(f.bucket.objects.has(`private/${blob.id}`)).toBe(true);
  expect(transport(f)).toEqual({ state: "final", transport: "response" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_cost_observations").get()).toEqual({
    n: 0,
  });
});

test("unsent report failure still journals cleanup when writer-stop also fails", async () => {
  const f = await setup();
  f.db.sqlite.exec(`CREATE TEMP TRIGGER synthetic_admission_failure BEFORE INSERT ON v2_execution_admissions
    BEGIN SELECT RAISE(ABORT,'synthetic admission failure'); END;
    CREATE TEMP TRIGGER synthetic_stop_failure BEFORE UPDATE OF writer_state ON v2_physical_blob_bindings
    WHEN NEW.writer_state='stopped' AND OLD.writer_state='running' BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END`);
  await expect(f.reports.pdf(f.actor.ownerId, f.draft.id)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "deleting",
    writer_state: "running",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 1 });
  expect(f.bucket.objects.size).toBe(0);
  expect(transport(f)).toBeNull();
});

test("unknown R2 completion keeps its writer running and transport unknown", async () => {
  const f = await setup();
  f.setFailure(true);
  await expect(f.reports.pdf(f.actor.ownerId, f.draft.id)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "deleting",
    writer_state: "running",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 1 });
  expect(f.bucket.objects.has(`private/${blob.id}`)).toBe(true);
  expect(transport(f)).toEqual({ state: "unknown", transport: "unknown" });
});

test("a wrong-size R2 response never proves the physical writer stopped", async () => {
  const f = await setup(true);
  await expect(f.reports.pdf(f.actor.ownerId, f.draft.id)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "deleting",
    writer_state: "running",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 1 });
  expect(transport(f)).toEqual({ state: "final", transport: "response" });
});

test("cleanup persistence failure does not suppress the confirmed R2 response", async () => {
  const f = await setup();
  f.db.sqlite.exec(`CREATE TEMP TRIGGER synthetic_stop_failure BEFORE UPDATE OF writer_state ON v2_physical_blob_bindings
    WHEN NEW.writer_state='stopped' AND OLD.writer_state='running' BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END;
    CREATE TEMP TRIGGER synthetic_cleanup_failure BEFORE INSERT ON v2_deletion_journals
    BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END`);
  await expect(f.reports.pdf(f.actor.ownerId, f.draft.id)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "pending",
    writer_state: "running",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 0 });
  expect(transport(f)).toEqual({ state: "final", transport: "response" });
});

test("successful report writes stop the writer and return the decrypted PDF", async () => {
  const f = await setup();
  const pdf = await f.reports.pdf(f.actor.ownerId, f.draft.id);
  const bytes = new Uint8Array(await new Response(pdf.body).arrayBuffer());
  expect(bytes.byteLength).toBe(pdf.byteLength);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const blob = output(f);
  expect(blob).toMatchObject({
    state: "stored",
    writer_state: "stopped",
    physical_state: "held",
  });
  expect(cleanupTargets(f, blob.id)).toEqual({ n: 0 });
  expect(transport(f)).toEqual({ state: "final", transport: "response" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_cost_observations").get()).toEqual({
    n: 0,
  });
});
