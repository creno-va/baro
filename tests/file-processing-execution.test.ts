import { expect, test } from "bun:test";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createFileProcessingExecution } from "../src/server/modules/file-processing/execution";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { digest } from "../src/server/modules/files/binary";
import { createMediaGateway } from "../src/server/modules/llm-gateway/transcription";
import { fixture, uploaded } from "./helpers/file-processing-fixture";

const signal = () => new AbortController().signal;
async function setup(options: { before?: () => void; corrupt?: boolean } = {}) {
  const f = await fixture({
    probe: async (input) => ({
      category: "document",
      format: "txt",
      byteLength: input.byteLength,
      pageCount: 2,
    }),
  });
  const original = new TextEncoder().encode("first synthetic page\fsecond synthetic page");
  const u = await uploaded(f, original),
    jobId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const jobs = createV2JobsRepository(f.core);
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: { operationId, key: crypto.randomUUID(), requestHash: await digest(original) },
        quotas: [{ kind: "visible_ai_response", units: 1, responseKind: "file_interpretation" }],
      },
    ),
  ).toBe(true);
  let nativeCalls = 0;
  const receipts: string[] = [];
  // Explicit offline adapter. This tests lifecycle/fencing/AES/storage publication,
  // not actual configured pricing/funding or native/provider execution success.
  const costs: ProcessingCosts = {
    before: async () => {
      options.before?.();
      return { attemptId: "synthetic", dispatchToken: "synthetic" };
    },
    after: async (_, r) => {
      receipts.push(r.transport);
    },
  };
  const processor = createProcessorTransport({
    costs,
    stop: async () => {},
    fetch: async (request) => {
      nativeCalls++;
      const raw = new Uint8Array(await request.arrayBuffer());
      expect(raw).toEqual(original); // actual original AES download supplied the bytes.
      const unit = Number(request.headers.get("x-baro-unit"));
      const text = new TextEncoder().encode(new TextDecoder().decode(raw).split("\f")[unit]);
      const hash = await digest(text);
      const manifest = {
        version: 1,
        unit,
        totalUnits: 2,
        frameOffset: 0,
        decodedFrameCount: 0,
        probe: { category: "document", format: "txt", byteLength: original.length, pageCount: 2 },
        coverage: {
          category: "document",
          status: "complete",
          pageCount: 2,
          pages: [{ page: unit + 1, status: "processed" }],
        },
        artifacts: [
          {
            index: 0,
            kind: "extracted_text",
            position: { kind: "document", page: unit + 1, paragraph: null, table: null },
            byteLength: text.length,
            contentHash: options.corrupt ? "a".repeat(64) : hash,
          },
        ],
        outputBytes: text.length,
      };
      return new Response(
        `${[
          { type: "manifest", value: manifest },
          { type: "artifact", index: 0, data: btoa(String.fromCharCode(...text)) },
          { type: "complete" },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      );
    },
  });
  const media = createMediaGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          throw new Error("Text extraction must not call a model");
        },
      },
    },
    { costs, waitUntil: () => {} },
  );
  const execution = createFileProcessingExecution(
    f.core,
    {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      fileId: u.session.fileId,
      fileRevision: 2,
      jobId,
    },
    {
      environment: "preview",
      files: f.service,
      bucket: f.bucket.port,
      processor,
      media,
      costs,
      clock: () => f.actor.now,
      instanceId: `${jobId}-1`,
    },
  );
  return { ...f, u, jobId, operationId, jobs, execution, receipts, nativeCalls: () => nativeCalls };
}

test("actual SQLite/AES two-unit extraction stages bounded rows and atomically publishes complete coverage", async () => {
  const f = await setup();
  expect((await f.execution.initialize()).totalUnits).toBe(2);
  const originalManifest = f.db.sqlite
    .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
    .get(f.u.session.fileId);
  for (let unit = 0; unit < 2; unit++) {
    expect((await f.execution.extractUnit(unit, signal())).artifactCount).toBe(1);
    await f.execution.interpretArtifact(unit, 0, signal());
    await f.execution.prepareUnit(unit, signal());
  }
  expect(f.nativeCalls()).toBe(2);
  const prepared = await f.execution.preparePublication(2, signal());
  for (let part = 0; part < prepared.partCount; part++)
    await f.execution.stageCoveragePart(part, signal());
  for (let unit = 0; unit < 2; unit++) {
    const pages = await f.execution.resultPages(unit, 0);
    for (let page = 0; page < pages.pageCount; page++)
      await f.execution.stageResultPage(unit, 0, page, signal());
  }
  const files = createV2FilesRepository(f.core);
  expect((await files.metadata(f.actor, f.u.session.fileId))?.status).toBe("queued");
  expect((await f.execution.publish(signal())).status).toBe("ready");
  const result = await files.read(f.actor, f.u.session.fileId);
  expect(result?.coverage).toEqual({
    category: "document",
    status: "complete",
    pageCount: 2,
    pages: [
      { page: 1, status: "processed" },
      { page: 2, status: "processed" },
    ],
  });
  expect(result?.observations.map((v) => v.text)).toEqual([
    "first synthetic page",
    "second synthetic page",
  ]);
  expect(result?.derivatives).toHaveLength(2);
  expect(
    f.db.sqlite
      .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
      .get(f.u.session.fileId),
  ).toEqual(originalManifest);
  expect((await f.jobs.find(f.actor, f.jobId))?.status).toBe("completed");
  expect((await f.execution.publish(signal())).status).toBe("ready");
  expect((await f.execution.initialize()).status).toBe("ready");
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("cancelled job cannot disclose original or invoke native after initial lease", async () => {
  const f = await setup();
  await f.execution.initialize();
  f.db.sqlite.query("UPDATE v2_jobs SET status='cancelled' WHERE id=?").run(f.jobId);
  const puts = f.bucket.calls.put,
    gets = f.bucket.calls.get;
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(f.nativeCalls()).toBe(0);
  expect(f.bucket.calls.put).toBe(puts);
  expect(f.bucket.calls.get).toBe(gets);
});

test("consent revocation during cost reservation prevents remote disclosure", async () => {
  let f: Awaited<ReturnType<typeof setup>>,
    armed = false;
  f = await setup({
    before: () => {
      if (armed)
        f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.u.session.fileId);
    },
  });
  await f.execution.initialize();
  armed = true;
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(f.nativeCalls()).toBe(0);
  expect(f.receipts).toContain("not_sent");
});

test("native dishonest artifact hash cannot create a private output or ready coverage", async () => {
  const f = await setup({ corrupt: true });
  await f.execution.initialize();
  const puts = f.bucket.calls.put;
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
  expect(f.bucket.calls.put).toBe(puts);
  expect(
    (await createV2FilesRepository(f.core).metadata(f.actor, f.u.session.fileId))
      ?.coverageSnapshotId,
  ).toBeNull();
});

test("stored derivative ciphertext mutation is rejected before observation or publication", async () => {
  const f = await setup();
  await f.execution.initialize();
  await f.execution.extractUnit(0, signal());
  const row = f.db.sqlite
    .query(
      "SELECT object_key FROM v2_blobs WHERE kind='derivative' AND state='stored' ORDER BY rowid LIMIT 1",
    )
    .get() as { object_key: string };
  const bytes = f.bucket.objects.get(row.object_key);
  if (!bytes) throw new Error("synthetic ciphertext missing");
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_file_observations").get()).toEqual({
    n: 0,
  });
});

test("ambiguous R2 PUT journals old intent and replay uses a fresh blob without another logical AI quota", async () => {
  const f = await setup();
  await f.execution.initialize();
  const quota = f.db.sqlite.query("SELECT * FROM v2_quota_reservations").all();
  f.bucket.setPutAmbiguous(true);
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const old = f.db.sqlite
    .query("SELECT id,object_key FROM v2_blobs WHERE kind='derivative' AND state='deleting'")
    .get() as { id: string; object_key: string };
  expect(old).toBeDefined();
  const oldBytes = f.bucket.objects.get(old.object_key);
  if (!oldBytes) throw new Error("synthetic ciphertext missing");
  const oldCipher = oldBytes.slice();
  f.bucket.setPutAmbiguous(false);
  expect((await f.execution.extractUnit(0, signal())).artifactCount).toBe(1);
  await f.execution.interpretArtifact(0, 0, signal());
  expect(f.bucket.objects.get(old.object_key)).toEqual(oldCipher);
  expect(f.db.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual(quota);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_deletion_targets WHERE kind='blob' AND target_id=?")
      .get(old.id),
  ).toEqual({ n: 1 });
  expect(f.receipts).toContain("unknown");
});

test("fencing change during real output PUT prevents late blob promotion and queues cleanup", async () => {
  const f = await setup();
  await f.execution.initialize();
  f.bucket.setPutHook(async () => {
    f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.jobId);
  });
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_blobs WHERE kind='derivative' AND state='stored'")
      .get(),
  ).toEqual({ n: 0 });
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_blobs WHERE kind='derivative' AND state='deleting'")
      .get(),
  ).toEqual({ n: 1 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_job_checkpoints").get()).toEqual({ n: 0 });
});
