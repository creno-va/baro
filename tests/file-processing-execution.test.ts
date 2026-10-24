import { expect, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createProcessorLifecycle } from "../src/server/modules/file-processing/container-lifecycle";
import { createFileProcessingExecution } from "../src/server/modules/file-processing/execution";
import { nativeJobId } from "../src/server/modules/file-processing/native-identity";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { digest } from "../src/server/modules/files/binary";
import { createMediaGateway } from "../src/server/modules/llm-gateway/transcription";
import { countD1Calls } from "./helpers/d1-call-count";
import { fixture, uploaded } from "./helpers/file-processing-fixture";

const signal = () => new AbortController().signal;
async function setup(
  options: {
    before?: () => void;
    after?: () => void;
    corrupt?: boolean;
    wrapDatabase?: (database: D1Database) => D1Database;
  } = {},
) {
  const f = await fixture({
    probe: async (input) => {
      await new Response(input.open()).arrayBuffer();
      return {
        category: "document",
        format: "txt",
        byteLength: input.byteLength,
        pageCount: 2,
      };
    },
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const original = new TextEncoder().encode("first synthetic page\fsecond synthetic page");
  const u = await uploaded(f, original),
    jobId = nativeJobId("file"),
    operationId = crypto.randomUUID();
  // Explicit fixture inventory for its already-written synthetic original.
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,writer_state,inventory_hash,created_at) SELECT id,'preview',?,object_key,cipher_bytes,'held','stopped',?,? FROM v2_blobs WHERE kind='original'",
    )
    .run(f.actor.ownerId, "d".repeat(64), f.actor.now);
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
  expect(
    await jobs.acquire(
      f.actor,
      jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.actor.now) + 300000).toISOString(),
    ),
  ).not.toBeNull();
  f.core = createV2Core(options.wrapDatabase?.(f.db.binding) ?? f.db.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
  });
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
      options.after?.();
    },
  };
  let running = false,
    starts = 0;
  const native = createProcessorLifecycle({
    isRevoked: async () => false,
    persistRevoked: async () => {},
    start: async () => {
      expect(running).toBe(false);
      running = true;
      starts++;
    },
    destroy: async () => {
      running = false;
    },
    fetch: async (request) => {
      expect(running).toBe(true);
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
        { headers: { "content-type": "application/x-ndjson" } },
      );
    },
  });
  const processor = createProcessorTransport({ costs, fetch: native.fetch, stop: native.stop });
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
  return {
    ...f,
    u,
    jobId,
    operationId,
    jobs,
    execution,
    receipts,
    nativeCalls: () => nativeCalls,
    nativeState: () => ({ running, starts }),
  };
}

async function publicationFixture(options: Parameters<typeof setup>[0] = {}) {
  const f = await setup(options);
  await f.execution.initialize();
  for (let unit = 0; unit < 2; unit++) {
    await f.execution.extractUnit(unit, signal());
    await f.execution.interpretArtifact(unit, 0, signal());
    await f.execution.prepareUnit(unit, signal());
  }
  const prepared = await f.execution.preparePublication(2, signal());
  return { ...f, prepared };
}

for (const mutation of [
  "intake",
  "summary",
  "workspace_job",
  "archive",
  "file_revision",
  "file_manifest",
  "file_consent",
  "policy_consent",
  "lease_fencing",
  "file_deleted",
] as const)
  test(`file publication context refresh refuses ${mutation} and retains staged evidence`, async () => {
    const f = await publicationFixture();
    const header = () =>
      f.db.sqlite
        .query(
          "SELECT workspace_revision,encrypted_payload,written_parts FROM v2_private_snapshots WHERE purpose='file_coverage' AND target_id=?",
        )
        .get(f.u.session.fileId);
    const before = header();
    const other = await uploaded(f, new TextEncoder().encode("another synthetic source"));
    const query = (sql: string, ...values: (string | number)[]) =>
      f.db.sqlite.query(sql).run(...values);
    if (mutation === "intake")
      query("UPDATE v2_workspaces SET intake_revision=intake_revision+1 WHERE id=?", f.workspaceId);
    if (mutation === "summary")
      query(
        "UPDATE v2_workspaces SET confirmed_summary_revision=coalesce(confirmed_summary_revision,0)+1 WHERE id=?",
        f.workspaceId,
      );
    if (mutation === "workspace_job")
      query(
        "UPDATE v2_workspaces SET current_job_id=? WHERE id=?",
        crypto.randomUUID(),
        f.workspaceId,
      );
    if (mutation === "archive")
      query(
        "UPDATE v2_workspaces SET status='archived',archived_from='intake',current_job_id=NULL WHERE id=?",
        f.workspaceId,
      );
    if (mutation === "file_revision")
      query("UPDATE v2_files SET revision=revision+1 WHERE id=?", f.u.session.fileId);
    if (mutation === "file_manifest")
      query(
        "UPDATE v2_files SET manifest_snapshot_id=(SELECT manifest_snapshot_id FROM v2_files WHERE id=?) WHERE id=?",
        other.session.fileId,
        f.u.session.fileId,
      );
    if (mutation === "file_consent")
      query("DELETE FROM v2_consents WHERE file_id=?", f.u.session.fileId);
    if (mutation === "policy_consent")
      query("DELETE FROM user_consents WHERE user_id=?", f.actor.ownerId);
    if (mutation === "lease_fencing")
      query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?", f.jobId);
    if (mutation === "file_deleted")
      query(
        "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('file',?,?)",
        f.u.session.fileId,
        f.actor.now,
      );
    await expect(f.execution.stageCoveragePart(0, signal())).rejects.toMatchObject({
      code: mutation === "lease_fencing" ? "FILE_PROCESSING_FAILED" : "STALE_REVISION",
    });
    expect(header()).toEqual(before);
    expect(f.nativeCalls()).toBe(2);
  });

for (const mutation of ["file_consent", "lease_fencing", "file_manifest"] as const)
  test(`atomic refresh rejects ${mutation} revoked after its fresh guard`, async () => {
    let measured!: ReturnType<typeof countD1Calls>;
    const f = await publicationFixture({
      wrapDatabase: (database) => {
        measured = countD1Calls(database);
        return measured.binding;
      },
    });
    const other = await uploaded(f, new TextEncoder().encode("another synthetic source"));
    let changed = false;
    measured.before((statements) => {
      if (changed || !statements.some((sql) => sql.includes("s.workspace_revision BETWEEN")))
        return;
      changed = true;
      if (mutation === "file_consent")
        f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.u.session.fileId);
      else if (mutation === "lease_fencing")
        f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.jobId);
      else
        f.db.sqlite
          .query(
            "UPDATE v2_files SET manifest_snapshot_id=(SELECT manifest_snapshot_id FROM v2_files WHERE id=?) WHERE id=?",
          )
          .run(other.session.fileId, f.u.session.fileId);
    });
    await expect(f.execution.stageCoveragePart(0, signal())).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(changed).toBe(true);
    expect(f.nativeCalls()).toBe(2);
  });

for (const phase of ["results", "publication"] as const)
  for (const mutation of ["file_consent", "policy_consent", "file_manifest"] as const)
    test(`atomic ${phase} refuses late ${mutation} before any ready output`, async () => {
      let measured!: ReturnType<typeof countD1Calls>;
      const f = await publicationFixture({
        wrapDatabase: (database) => {
          measured = countD1Calls(database);
          return measured.binding;
        },
      });
      const other = await uploaded(f, new TextEncoder().encode("another synthetic source"));
      for (let part = 0; part < f.prepared.partCount; part++)
        await f.execution.stageCoveragePart(part, signal());
      if (phase === "publication") {
        for (let unit = 0; unit < 2; unit++) {
          const pages = await f.execution.resultPages(unit, 0);
          for (let page = 0; page < pages.pageCount; page++)
            await f.execution.stageResultPage(unit, 0, page, signal());
        }
      }
      let changed = false;
      measured.before((statements) => {
        if (
          changed ||
          !statements.some((sql) =>
            phase === "results"
              ? sql.startsWith("INSERT INTO v2_file_observations")
              : sql.startsWith("UPDATE v2_files SET revision=") && sql.includes("state='ready'"),
          )
        )
          return;
        changed = true;
        if (mutation === "file_consent")
          f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.u.session.fileId);
        else if (mutation === "policy_consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        else
          f.db.sqlite
            .query(
              "UPDATE v2_files SET manifest_snapshot_id=(SELECT manifest_snapshot_id FROM v2_files WHERE id=?) WHERE id=?",
            )
            .run(other.session.fileId, f.u.session.fileId);
      });
      await expect(
        phase === "results"
          ? f.execution.stageResultPage(0, 0, 0, signal())
          : f.execution.publish(signal()),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
      expect(changed).toBe(true);
      const row = f.db.sqlite
        .query("SELECT state FROM v2_files WHERE id=?")
        .get(f.u.session.fileId) as { state: string };
      expect(row.state).not.toBe("ready");
      expect(f.nativeCalls()).toBe(2);
    });

for (const phase of ["refresh", "coverage", "publication", "continuous"] as const)
  test(`bounded ${phase} CAS races preserve the source and never repeat interpretation`, async () => {
    let measured!: ReturnType<typeof countD1Calls>;
    const f = await publicationFixture({
      wrapDatabase: (database) => {
        measured = countD1Calls(database);
        return measured.binding;
      },
    });
    if (phase === "refresh")
      await uploaded(f, new TextEncoder().encode("another synthetic source"));
    let races = 0;
    const target =
      phase === "refresh"
        ? "s.workspace_revision BETWEEN"
        : phase === "publication"
          ? "(SELECT count(*) FROM v2_file_observations WHERE snapshot_id=?)"
          : "s.written_parts=? AND s.written_bytes=?";
    measured.before((statements) => {
      if (
        races >= (phase === "continuous" ? 3 : 1) ||
        !statements.some((sql) => sql.includes(target))
      )
        return;
      // The stable workspace metadata uses AAD revision1. File publication
      // advances only its operational revision, exactly as this race does.
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspaceId);
      races++;
    });
    if (phase === "continuous") {
      await expect(f.execution.stageCoveragePart(0, signal())).rejects.toMatchObject({
        code: "STALE_REVISION",
      });
    } else {
      for (let part = 0; part < f.prepared.partCount; part++)
        await f.execution.stageCoveragePart(part, signal());
      for (let unit = 0; unit < 2; unit++) {
        const pages = await f.execution.resultPages(unit, 0);
        for (let page = 0; page < pages.pageCount; page++)
          await f.execution.stageResultPage(unit, 0, page, signal());
      }
      expect((await f.execution.publish(signal())).status).toBe("ready");
    }
    expect(races).toBe(phase === "continuous" ? 3 : 1);
    expect(f.nativeCalls()).toBe(2);
  });

for (const phase of ["preparation_replay", "coverage", "results", "publication"] as const)
  test(`another file upload during ${phase} cannot discard an already interpreted source`, async () => {
    const f = await setup();
    await f.execution.initialize();
    for (let unit = 0; unit < 2; unit++) {
      await f.execution.extractUnit(unit, signal());
      await f.execution.interpretArtifact(unit, 0, signal());
      await f.execution.prepareUnit(unit, signal());
    }
    const prepared = await f.execution.preparePublication(2, signal());
    const concurrentUpload = () =>
      uploaded(f, new TextEncoder().encode("another synthetic source"));
    if (phase === "preparation_replay") {
      await concurrentUpload();
      expect(await f.execution.preparePublication(2, signal())).toEqual(prepared);
    }
    if (phase === "coverage") await concurrentUpload();
    for (let part = 0; part < prepared.partCount; part++)
      await f.execution.stageCoveragePart(part, signal());
    if (phase === "results") await concurrentUpload();
    for (let unit = 0; unit < 2; unit++) {
      const pages = await f.execution.resultPages(unit, 0);
      for (let page = 0; page < pages.pageCount; page++)
        await f.execution.stageResultPage(unit, 0, page, signal());
    }
    if (phase === "publication") await concurrentUpload();
    expect((await f.execution.publish(signal())).status).toBe("ready");
    const result = await createV2FilesRepository(f.core).read(f.actor, f.u.session.fileId);
    expect(result?.observations.map((value) => value.text)).toEqual([
      "first synthetic page",
      "second synthetic page",
    ]);
    expect(f.nativeCalls()).toBe(2);
  });

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
  expect(f.nativeState()).toEqual({ running: false, starts: 2 });
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

test("derivative receipt recording failure cannot skip its cleanup journal", async () => {
  let receipts = 0;
  const f = await setup({
    after: () => {
      if (++receipts >= 2) throw new Error("Synthetic receipt failure");
    },
  });
  await f.execution.initialize();
  await expect(f.execution.extractUnit(0, signal())).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  expect(
    f.db.sqlite
      .query(
        "SELECT b.state,p.writer_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='derivative'",
      )
      .get(),
  ).toEqual({ state: "deleting", writer_state: "stopped" });
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob'").get(),
  ).toEqual({ n: 1 });
});
