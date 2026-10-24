import { afterEach, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import {
  createV2PaidRuntimeRepository,
  paidHoldRequestSchema,
} from "../src/server/db/v2-paid-runtime";
import { createProcessingBudgetService } from "../src/server/modules/budget/processing-ledger";
import {
  boundedProcessingResources,
  createFileProcessingRuntime,
} from "../src/server/modules/budget/processing-runtime";
import { digest } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { createFileProcessingAdmission } from "../src/server/runtime/file-admission";
import { countD1Calls } from "./helpers/d1-call-count";
import { fixture } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

const phaseLogSpies: ReturnType<typeof spyOn<typeof console, "info">>[] = [];
afterEach(() => {
  for (const spy of phaseLogSpies.splice(0)) spy.mockRestore();
});

/** Canonical admission/ledger/runtime with SQLite, AES and explicit offline
 * R2/native adapters. This never claims a real Container/provider success. */
async function setup(pageCount = 1) {
  const f = await fixture();
  const meter = countD1Calls(f.db.binding);
  const authorization = { reads: 0 };
  const hotReads = {
    transport: 0,
    artifactTarget: 0,
    pendingArtifact: 0,
    checkpoint: 0,
    checkpointRevision: 0,
  };
  meter.before((statements) => {
    for (const sql of statements) {
      if (
        sql.startsWith("SELECT state,dispatch_token,transport") &&
        sql.includes("FROM v2_execution_admissions")
      )
        hotReads.transport++;
      if (sql.startsWith("SELECT j.target_id,j.target_revision,j.operation_id FROM v2_jobs"))
        hotReads.artifactTarget++;
      if (sql.startsWith("SELECT b.encrypted_payload,b.created_at FROM v2_blobs"))
        hotReads.pendingArtifact++;
      if (sql.startsWith("SELECT id FROM v2_job_checkpoints WHERE")) hotReads.checkpoint++;
      if (sql.startsWith("SELECT coalesce(max(revision),0)+1 AS revision FROM v2_job_checkpoints"))
        hotReads.checkpointRevision++;
    }
    authorization.reads += statements.filter((sql) =>
      sql.startsWith("SELECT j.lease_token,j.fencing,j.lease_until,j.status,w.revision"),
    ).length;
  });
  const core = createV2Core(meter.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const original = new TextEncoder().encode("synthetic extracted text");
  const calls = { probe: 0, process: 0, stop: 0 };
  const probe = { category: "document", format: "pdf", byteLength: original.length, pageCount };
  const env = {
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    DB: meter.binding,
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: f.bucket.port,
    FILE_PROCESSING: {},
    AI_GATEWAY_ID: "synthetic",
    AI: {
      run: async () => {
        throw new Error("Synthetic text must not invoke AI");
      },
    },
    FILE_PROCESSOR: {
      idFromName: (id: string) => id,
      get: () => ({
        prepareCapacity: async () => true,
        stopProcessing: async () => {
          calls.stop++;
        },
        fetch: async (request: Request) => {
          expect(new Uint8Array(await request.arrayBuffer())).toEqual(original);
          if (new URL(request.url).pathname === "/probe") {
            calls.probe++;
            return Response.json({ version: 1, probe });
          }
          calls.process++;
          const contentHash = await digest(original);
          const unit = Number(request.headers.get("x-baro-unit"));
          const manifest = {
            version: 1,
            unit,
            totalUnits: pageCount,
            frameOffset: 0,
            decodedFrameCount: 0,
            probe,
            coverage: {
              category: "document",
              status: "complete",
              pageCount,
              pages: [{ page: unit + 1, status: "processed" }],
            },
            artifacts: [
              {
                index: 0,
                kind: "extracted_text",
                position: { kind: "document", page: unit + 1, paragraph: null, table: null },
                byteLength: original.length,
                contentHash,
              },
            ],
            outputBytes: original.length,
          };
          return new Response(
            `${[
              { type: "manifest", value: manifest },
              { type: "artifact", index: 0, data: btoa(String.fromCharCode(...original)) },
              { type: "complete" },
            ]
              .map((record) => JSON.stringify(record))
              .join("\n")}\n`,
          );
        },
      }),
    },
  } as unknown as Env;
  const service = (part = false) => {
    const requestCore = part ? fileStorageRequestCore(core, false) : core;
    return createFilesService(requestCore, {
      environment: "preview",
      bucket: f.bucket.port,
      paidStorage: createFileStorageBudget(requestCore, "preview", f.actor.ownerId),
      ...createFileProcessingAdmission(requestCore, env),
    });
  };
  const session = await service().reserve(
    f.actor.ownerId,
    f.workspaceId,
    f.rev(),
    crypto.randomUUID(),
    {
      name: "synthetic.pdf",
      byteLength: original.length,
      mediaType: "application/pdf",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    },
  );
  const part = await service(true).putPart(
    f.actor.ownerId,
    f.workspaceId,
    session.fileId,
    session.uploadSession,
    0,
    new Response(original).body,
  );
  const complete = await service().complete(f.actor.ownerId, f.workspaceId, session.fileId, {
    expectedRevision: f.rev(),
    uploadSession: session.uploadSession,
    manifest: { byteLength: original.length, contentHash: await digest(original), parts: [part] },
  });
  expect(complete.processingQueued).toBe(true);
  const job = f.db.sqlite
    .query("SELECT current_job_id AS id,revision FROM v2_files WHERE id=?")
    .get(session.fileId) as { id: string; revision: number };
  const params = {
    ownerId: f.actor.ownerId,
    workspaceId: f.workspaceId,
    fileId: session.fileId,
    fileRevision: job.revision,
    jobId: job.id,
  };
  const execution = await createFileProcessingRuntime(env, params, `${job.id}-1`, () => {});
  return {
    ...f,
    core,
    env,
    calls,
    session,
    params,
    execution,
    service,
    original,
    meter,
    authorization,
    hotReads,
  };
}

for (const pageCount of [1, 2])
  test(`canonical observation-only ${pageCount}-page extraction stores bounded ciphertext and publishes actual text`, async () => {
    const phaseLogs: Record<string, unknown>[] = [];
    const originalInfo = console.info.bind(console);
    phaseLogSpies.push(
      spyOn(console, "info").mockImplementation((value) => {
        const entry = JSON.parse(value);
        if (entry.event === "preview_file_phase_awaits") phaseLogs.push(entry);
        else originalInfo(value);
      }),
    );
    const f = await setup(pageCount);
    const initialHotReads = { ...f.hotReads };
    const stages: { stage: string; calls: number; statements: number; authorizations: number }[] =
      [];
    const measure = async <T>(stage: string, action: () => Promise<T>) => {
      const before = { ...f.meter.work, authorizations: f.authorization.reads };
      const value = await action();
      stages.push({
        stage,
        calls: f.meter.work.calls - before.calls,
        statements: f.meter.work.statements - before.statements,
        authorizations: f.authorization.reads - before.authorizations,
      });
      return value;
    };
    const signal = new AbortController().signal;
    expect((await measure("initialize", () => f.execution.initialize())).totalUnits).toBe(
      pageCount,
    );
    expect((await measure("extract", () => f.execution.extractUnit(0, signal))).artifactCount).toBe(
      1,
    );
    expect(f.calls).toEqual({ probe: 1, process: 1, stop: 2 });
    // Resume with the real immutable job and stored checkpoints, without another native dispatch.
    const execution = await createFileProcessingRuntime(
      f.env,
      f.params,
      `${f.params.jobId}-1`,
      () => {},
    );
    for (let unit = 0; unit < pageCount; unit++) {
      if (unit) await measure("extract", () => execution.extractUnit(unit, signal));
      await measure("interpret", () => execution.interpretArtifact(unit, 0, signal));
      await measure("prepare_unit", () => execution.prepareUnit(unit, signal));
    }
    const publication = await measure("prepare_publication", () =>
      execution.preparePublication(pageCount, signal),
    );
    for (let part = 0; part < publication.partCount; part++)
      await measure("stage_coverage", () => execution.stageCoveragePart(part, signal));
    for (let unit = 0; unit < pageCount; unit++) {
      expect(
        (await measure("prepare_unit_resume", () => execution.prepareUnit(unit, signal)))
          .artifactCount,
      ).toBe(1); // Workflow result-count phase
      const pages = await measure("result_pages", () => execution.resultPages(unit, 0));
      for (let page = 0; page < pages.pageCount; page++)
        await measure("stage_result", () => execution.stageResultPage(unit, 0, page, signal));
    }
    expect(f.calls.process).toBe(pageCount);
    expect((await measure("publish", () => execution.publish(signal))).status).toBe("ready");
    // Measured with this exact canonical fixture before the same-snapshot JOIN:
    // 1 page: 1330 calls / 1561 SQL / 308 authorization boundaries.
    // 2 pages: 2380 calls / 2773 SQL / 555 authorization boundaries.
    // After current consent JOIN: 715/946 and 1271/1664, unchanged 308/555 guards.
    // Same-snapshot artifact/checkpoint reads remove another 11/19 calls/SQL.
    // Atomic transport observations remove another 21/38 calls/SQL.
    // Preparation snapshot removes 6/10 calls; atomic blob/reservation commit
    // removes another 12/20 calls, retaining all 308/555 authorization boundaries.
    // Isolating the optional maintenance month write adds one call per original
    // GET; policy and month remain separate SQL with all other work unchanged.
    // Atomic dispatch removes 21/38 calls and 63/114 SQL without removing the
    // fresh post-dispatch read or any authorization boundary.
    // Counts are local method calls, not network time or native rows read.
    // Native capacity admission and its post-wait fence add two fresh
    // authorization reads per extracted unit, without removing earlier guards.
    expect(stages.reduce((sum, stage) => sum + stage.calls, 0)).toBe(pageCount === 1 ? 647 : 1152);
    expect(stages.reduce((sum, stage) => sum + stage.statements, 0)).toBe(
      pageCount === 1 ? 823 : 1447,
    );
    expect(stages.reduce((sum, stage) => sum + stage.authorizations, 0)).toBe(
      pageCount === 1 ? 310 : 559,
    );
    // The exact existing SQLite/AES/R2 runtime keeps all calls and guards. Phase
    // observation counts method awaits only, including their ledger/fence work.
    const measuredStages = stages.filter((stage) =>
      ["prepare_publication", "stage_result"].includes(stage.stage),
    );
    expect(phaseLogs).toHaveLength(measuredStages.length);
    for (const [index, stage] of measuredStages.entries()) {
      const entry = phaseLogs[index];
      expect(entry).toMatchObject({
        phase: stage.stage,
        outcome: "success",
        d1Calls: stage.calls,
        d1Failed: 0,
        d1TimedCalls: stage.calls,
        r2Calls: stage.stage === "prepare_publication" ? 2 * pageCount + 2 : 3,
        r2Failed: 0,
      });
      expect(entry?.d1AwaitMs).toBeNumber();
      expect(entry?.r2AwaitMs).toBeNumber();
      expect(entry?.overallMs).toBeNumber();
    }
    if (process.env.BARO_FILE_PROCESSING_WORK === "true")
      console.info(
        JSON.stringify({
          event: "synthetic_file_processing_work",
          pageCount,
          stages,
          hotReads: Object.fromEntries(
            Object.entries(f.hotReads).map(([name, count]) => [
              name,
              count - initialHotReads[name as keyof typeof initialHotReads],
            ]),
          ),
        }),
      );
    const output = await createV2FilesRepository(f.core).read(
      { ownerId: f.actor.ownerId, now: new Date().toISOString() },
      f.session.fileId,
    );
    expect(output?.observations.map((row) => row.text)).toEqual(
      Array.from({ length: pageCount }, () => new TextDecoder().decode(f.original)),
    );
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
    const physical = f.db.sqlite
      .query(
        "SELECT b.object_key,b.cipher_bytes,b.cipher_hash,p.maximum_cipher_bytes,p.expected_cipher_bytes,p.writer_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='derivative' AND b.state='stored'",
      )
      .all() as {
      object_key: string;
      cipher_bytes: number;
      cipher_hash: string;
      maximum_cipher_bytes: number;
      expected_cipher_bytes: number;
      writer_state: string;
    }[];
    expect(physical.length).toBeGreaterThan(1);
    for (const row of physical) {
      const bytes = f.bucket.objects.get(row.object_key);
      if (!bytes) throw new Error("Synthetic ciphertext absent");
      expect(row).toMatchObject({
        cipher_bytes: bytes.length,
        maximum_cipher_bytes: bytes.length,
        expected_cipher_bytes: bytes.length,
        writer_state: "stopped",
      });
      expect(await digest(bytes)).toBe(row.cipher_hash);
    }
    const original = await f.service().content(f.actor.ownerId, f.workspaceId, f.session.fileId);
    expect(new Uint8Array(await new Response(original.body).arrayBuffer())).toEqual(f.original);
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

for (const boundary of ["checkpoint", "preparation"] as const)
  for (const changed of ["consent", "account", "file", "lease-expiry", "target-revision"] as const)
    test(`combined ${boundary} snapshot cannot commit after late ${changed}`, async () => {
      const f = await setup();
      await f.execution.initialize();
      let injected = false;
      f.meter.after((statements) => {
        if (
          injected ||
          !statements.some((sql) =>
            sql.startsWith(
              boundary === "checkpoint"
                ? "SELECT (SELECT id FROM v2_job_checkpoints"
                : "SELECT j.operation_id,EXISTS(SELECT 1 FROM v2_storage_reservations",
            ),
          )
        )
          return;
        injected = true;
        if (changed === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        if (changed === "account" || changed === "file")
          f.db.sqlite
            .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
            .run(
              changed,
              changed === "account" ? f.actor.ownerId : f.session.fileId,
              new Date().toISOString(),
            );
        if (changed === "lease-expiry")
          f.db.sqlite
            .query("UPDATE v2_jobs SET lease_until='2020-01-01T00:00:00.000Z' WHERE id=?")
            .run(f.params.jobId);
        if (changed === "target-revision")
          f.db.sqlite
            .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
            .run(f.session.fileId);
      });
      await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
        code: "STALE_REVISION",
      });
      expect(injected).toBe(true);
      expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_job_checkpoints").get()).toEqual({
        n: 0,
      });
    });

for (const mutation of [
  "none",
  "consent",
  "terms",
  "privacy",
  "ai-notice",
  "auto-consent",
  "auto-version",
  "owner",
  "account",
  "workspace",
  "file",
  "revision",
  "lease-expiry",
  "runtime",
  "job-state",
  "file-job",
] as const)
  test(`each current file authorization reads one fresh snapshot: ${mutation}`, async () => {
    const f = await setup();
    await f.execution.initialize();
    const first = await f.execution.currentLease();
    const mutate = async () => {
      if (mutation === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      if (mutation === "terms")
        f.db.sqlite
          .query("UPDATE user_consents SET terms_version='previous' WHERE user_id=?")
          .run(f.actor.ownerId);
      if (mutation === "privacy")
        f.db.sqlite
          .query("UPDATE user_consents SET privacy_version='previous' WHERE user_id=?")
          .run(f.actor.ownerId);
      if (mutation === "ai-notice")
        f.db.sqlite
          .query("UPDATE user_consents SET ai_notice_version='previous' WHERE user_id=?")
          .run(f.actor.ownerId);
      if (mutation === "auto-consent")
        f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.session.fileId);
      if (mutation === "auto-version")
        f.db.sqlite
          .query("UPDATE v2_consents SET version='previous' WHERE file_id=?")
          .run(f.session.fileId);
      if (mutation === "owner") {
        const peer = await seedTestSession(f.db, { consent: true });
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(peer.userId, f.workspaceId);
      }
      if (mutation === "account" || mutation === "workspace" || mutation === "file")
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
          .run(
            mutation,
            mutation === "account"
              ? f.actor.ownerId
              : mutation === "workspace"
                ? f.workspaceId
                : f.session.fileId,
            new Date().toISOString(),
          );
      if (mutation === "revision")
        f.db.sqlite
          .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
          .run(f.session.fileId);
      if (mutation === "lease-expiry")
        f.db.sqlite
          .query("UPDATE v2_jobs SET lease_until='2020-01-01T00:00:00.000Z' WHERE id=?")
          .run(f.params.jobId);
      if (mutation === "runtime")
        f.db.sqlite
          .query("UPDATE v2_jobs SET runtime_instance_id='different-runtime' WHERE id=?")
          .run(f.params.jobId);
      if (mutation === "job-state")
        f.db.sqlite.query("UPDATE v2_jobs SET status='cancelled' WHERE id=?").run(f.params.jobId);
      if (mutation === "file-job")
        f.db.sqlite
          .query("UPDATE v2_files SET current_job_id=NULL WHERE id=?")
          .run(f.session.fileId);
    };
    await mutate();
    f.meter.reset();
    if (mutation === "none") expect(await f.execution.currentLease()).toEqual(first);
    else await expect(f.execution.currentLease()).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.meter.work).toEqual({ calls: 1, statements: 1 });
    expect(f.calls.process).toBe(0);
  });

test("consent revoked immediately after one job snapshot is checked again before native IO", async () => {
  const f = await setup();
  await f.execution.initialize();
  let revoked = false;
  f.meter.after((statements) => {
    if (
      !revoked &&
      statements.some((sql) =>
        sql.startsWith("SELECT j.lease_token,j.fencing,j.lease_until,j.status,w.revision"),
      )
    ) {
      revoked = true;
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    }
  });
  await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(revoked).toBe(true);
  expect(f.calls.process).toBe(0);
  expect(f.bucket.calls.put).toBe(1);
});

for (const failure of ["unknown", "wrong_receipt"] as const)
  test(`customer derivative ${failure} preserves writer capacity and forbids duplicate native dispatch`, async () => {
    const f = await setup();
    await f.execution.initialize();
    const quota = f.db.sqlite.query("SELECT * FROM v2_quota_reservations").all();
    if (failure === "unknown") f.bucket.setPutAmbiguous(true);
    else f.bucket.setWrongReceipt(true);
    await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    const row = f.db.sqlite
      .query(
        "SELECT b.id,b.state,p.state AS physical_state,p.writer_state,p.maximum_cipher_bytes FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='derivative'",
      )
      .get();
    expect(row).toMatchObject({
      state: "deleting",
      physical_state: "held",
      writer_state: "running",
    });
    const puts = f.bucket.calls.put;
    const execution = await createFileProcessingRuntime(
      f.env,
      f.params,
      `${f.params.jobId}-1`,
      () => {},
    );
    await expect(execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
      code: "BUDGET_UNAVAILABLE",
    });
    expect(f.calls.process).toBe(1);
    expect(f.bucket.calls.put).toBe(puts);
    expect(f.db.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual(quota);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_blobs WHERE kind='derivative' AND state='stored'")
        .get(),
    ).toEqual({ n: 0 });
  });

test("same derivative GET phase cannot redispatch an unknown response after restart", async () => {
  const f = await setup();
  const signal = new AbortController().signal;
  await f.execution.initialize();
  await f.execution.extractUnit(0, signal);
  f.bucket.setGetHook(async () => {
    throw new Error("Synthetic GET unknown");
  });
  await expect(f.execution.interpretArtifact(0, 0, signal)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const gets = f.bucket.calls.get;
  f.bucket.setGetHook(async () => {});
  const execution = await createFileProcessingRuntime(
    f.env,
    f.params,
    `${f.params.jobId}-1`,
    () => {},
  );
  await expect(execution.interpretArtifact(0, 0, signal)).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect(f.bucket.calls.get).toBe(gets);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_execution_admissions WHERE service='requests' AND transport='unknown'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

for (const mutation of ["consent", "owner", "account", "file", "revision", "lease"] as const)
  test(`customer derivative response cannot publish after ${mutation} changes`, async () => {
    const f = await setup();
    const peer = mutation === "owner" ? await seedTestSession(f.db, { consent: true }) : null;
    await f.execution.initialize();
    f.bucket.setPutHook(async () => {
      if (mutation === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      if (mutation === "owner" && peer)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(peer.userId, f.workspaceId);
      if (mutation === "account" || mutation === "file")
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
          .run(
            mutation,
            mutation === "file" ? f.session.fileId : f.actor.ownerId,
            new Date().toISOString(),
          );
      if (mutation === "revision")
        f.db.sqlite
          .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
          .run(f.session.fileId);
      if (mutation === "lease")
        f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.params.jobId);
    });
    await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(
      f.db.sqlite
        .query(
          "SELECT b.state,p.state AS physical_state,p.writer_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='derivative'",
        )
        .get(),
    ).toEqual({ state: "deleting", physical_state: "held", writer_state: "stopped" });
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob'").get(),
    ).toEqual({ n: 1 });
  });

for (const lostResponse of [false, true])
  test(`writer-stop database failure preserves derivative obligation (committed=${lostResponse})`, async () => {
    const f = await setup();
    await f.execution.initialize();
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    f.db.binding.prepare = (sql: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
        const bind = statement.bind.bind(statement),
          first = statement.first.bind(statement);
        statement.bind = (...values: unknown[]) => wrap(bind(...values));
        if (sql.startsWith("UPDATE v2_physical_blob_bindings SET writer_state='stopped'")) {
          statement.first = (async (column?: string) => {
            if (lostResponse) await (column === undefined ? first() : first(column));
            throw new Error("Synthetic writer receipt unavailable");
          }) as D1PreparedStatement["first"];
        }
        return statement;
      };
      return wrap(prepare(sql));
    };
    await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(
      f.db.sqlite
        .query(
          "SELECT b.state,p.state AS physical_state,p.writer_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind='derivative'",
        )
        .get(),
    ).toEqual({
      state: "deleting",
      physical_state: "held",
      writer_state: lostResponse ? "stopped" : "running",
    });
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob'").get(),
    ).toEqual({ n: 1 });
    expect(f.bucket.calls.put).toBe(2);
  });

test("exhausted physical ciphertext capacity rejects derivative before R2 PUT", async () => {
  const f = await setup();
  await f.execution.initialize();
  f.db.sqlite
    .query(
      "UPDATE v2_physical_storage_capacity SET capacity_bytes=held_bytes WHERE environment='preview'",
    )
    .run();
  await expect(f.execution.extractUnit(0, new AbortController().signal)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  expect(f.bucket.calls.put).toBe(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE kind='derivative'").get(),
  ).toEqual({ n: 0 });
});

async function legacyGet(f: Awaited<ReturnType<typeof setup>>) {
  const checkpoint = f.db.sqlite
    .query(
      "SELECT id,revision,encrypted_payload FROM v2_job_checkpoints WHERE job_id=? ORDER BY revision DESC LIMIT 1",
    )
    .get(f.params.jobId) as { id: string; revision: number; encrypted_payload: string };
  const receipt = await f.core.decrypt(
    "v2_job_checkpoints",
    checkpoint.id,
    f.actor.ownerId,
    checkpoint.revision,
    checkpoint.encrypted_payload,
    z.object({ opaqueIds: z.array(z.string()) }),
  );
  const blob = f.db.sqlite
    .query("SELECT id,object_key,cipher_hash,cipher_bytes FROM v2_blobs WHERE id=?")
    .get(receipt.opaqueIds[0] ?? "") as {
    id: string;
    object_key: string;
    cipher_hash: string;
    cipher_bytes: number;
  };
  const row = f.db.sqlite
    .query(
      "SELECT payload_json FROM v2_execution_admissions WHERE job_id=? AND service='container' ORDER BY created_at LIMIT 1",
    )
    .get(f.params.jobId) as { payload_json: string };
  const initial = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
  const budget = createProcessingBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    bounds: boundedProcessingResources,
    binding: async (now) => ({
      operationId: initial.plan.operationId,
      operationRevision: initial.plan.operationRevision,
      requestHash: initial.plan.requestHash,
      jobId: f.params.jobId,
      targetKind: "file",
      targetId: f.params.fileId,
      targetRevision: f.params.fileRevision,
      pricingProofId: null,
      fundingProofId: null,
      allocationProofId: null,
      invocationId: `${f.params.jobId}-1`,
      maximumAttempts: 1,
      deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
    }),
  });
  const input = {
    service: "requests" as const,
    action: "r2_get" as const,
    identity: `get:${blob.id}:${blob.cipher_hash}`,
    byteLength: blob.cipher_bytes,
    durationSeconds: null,
  };
  const lease = await f.execution.currentLease();
  const access = {
    signal: new AbortController().signal,
    authorize: async () => {
      await f.execution.currentLease();
      return true;
    },
  };
  return { budget, input, lease, access, blob };
}

for (const state of ["prepared", "dispatched", "unknown", "not_sent", "response"] as const)
  test(`legacy unscoped GET ${state} preserves its exact admission during scoped upgrade`, async () => {
    const f = await setup();
    await f.execution.initialize();
    await f.execution.extractUnit(0, new AbortController().signal);
    const old = await legacyGet(f);
    if (state === "prepared") {
      const admission = await old.budget.prepareInitial(old.input);
      if (!admission) throw new Error("Synthetic legacy admission missing");
      expect(
        await createV2PaidRuntimeRepository(f.core, "preview").reserveAttempt(
          admission.actor,
          old.lease,
          admission.paid,
        ),
      ).toBe(true);
    } else {
      const costs = old.budget.costs(old.lease);
      const permit = await costs.before(old.input, old.access);
      if (!permit) throw new Error("Synthetic legacy dispatch missing");
      if (state !== "dispatched") await costs.after(permit, { transport: state });
    }
    const records = f.db.sqlite
      .query("SELECT * FROM v2_execution_admissions WHERE service='requests'")
      .all();
    const gets = f.bucket.calls.get;
    if (state === "response") {
      await f.execution.interpretArtifact(0, 0, new AbortController().signal);
      expect(f.bucket.calls.get).toBe(gets + 2);
    } else {
      await expect(
        f.execution.interpretArtifact(0, 0, new AbortController().signal),
      ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
      expect(f.bucket.calls.get).toBe(gets);
      expect(
        f.db.sqlite.query("SELECT * FROM v2_execution_admissions WHERE service='requests'").all(),
      ).toEqual(records);
    }
  });

test("old GET claiming after new lookup still wins the same immutable dispatch CAS", async () => {
  const f = await setup();
  await f.execution.initialize();
  await f.execution.extractUnit(0, new AbortController().signal);
  const old = await legacyGet(f),
    costs = old.budget.costs(old.lease);
  const prepare = f.db.binding.prepare.bind(f.db.binding);
  let injected = false,
    oldDispatches = 0;
  f.db.binding.prepare = (sql: string) => {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const bind = statement.bind.bind(statement),
        first = statement.first.bind(statement);
      statement.bind = (...values: unknown[]) => wrap(bind(...values));
      if (
        sql.startsWith("SELECT 1 AS confirmed WHERE EXISTS(SELECT 1 FROM v2_execution_admissions")
      ) {
        statement.first = (async (column?: string) => {
          const result = await (column === undefined ? first() : first(column));
          if (!injected) {
            injected = true;
            expect(result).toBeNull();
            const permit = await costs.before(old.input, old.access);
            if (!permit) throw new Error("Synthetic legacy competing dispatch missing");
            oldDispatches++;
            const object = await f.bucket.port.get(old.blob.object_key);
            await object?.body.cancel();
            await costs.after(permit, { transport: "unknown" });
          }
          return result;
        }) as D1PreparedStatement["first"];
      }
      return statement;
    };
    return wrap(prepare(sql));
  };
  const gets = f.bucket.calls.get;
  await expect(
    f.execution.interpretArtifact(0, 0, new AbortController().signal),
  ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(oldDispatches).toBe(1);
  expect(f.bucket.calls.get).toBe(gets + 1);
});

test("a later scoped GET with unknown response cannot reuse the confirmed legacy response to dispatch again", async () => {
  const f = await setup();
  const signal = new AbortController().signal;
  await f.execution.initialize();
  await f.execution.extractUnit(0, signal);
  await f.execution.interpretArtifact(0, 0, signal); // First legacy manifest GET is confirmed.
  f.bucket.setGetHook(async () => {
    throw new Error("Synthetic later GET unknown");
  });
  await expect(f.execution.prepareUnit(0, signal)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  const gets = f.bucket.calls.get;
  f.bucket.setGetHook(async () => {});
  const execution = await createFileProcessingRuntime(
    f.env,
    f.params,
    `${f.params.jobId}-1`,
    () => {},
  );
  await expect(execution.prepareUnit(0, signal)).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect(f.bucket.calls.get).toBe(gets);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_execution_admissions WHERE service='requests' AND transport='unknown'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
