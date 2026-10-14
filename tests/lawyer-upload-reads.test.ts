import { expect, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import type { StorageCosts } from "../src/server/modules/budget/storage-ledger";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import {
  createLawyerStorageBudget,
  lawyerStorageRequestCore,
} from "../src/server/modules/lawyers/storage-runtime";
import { createAssetProcessingAdmission } from "../src/server/runtime/asset-admission";
import { fixture } from "./helpers/file-processing-fixture";

// Counts D1 method calls, not network time or native D1 rows read. SQLite/AES,
// storage admission, writer fences and Workflow admission are real; R2 is local.
function countCalls(database: D1Database) {
  const work = { calls: 0, statements: 0 };
  const sources = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; sql: string }
  >();
  let after: (sql: string[]) => void = () => {};
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const result = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      async all<T>() {
        work.calls++;
        work.statements++;
        const result = await statement.all<T>();
        after([sql]);
        return result;
      },
      async first<T>(column?: string) {
        work.calls++;
        work.statements++;
        const result =
          column === undefined ? await statement.first<T>() : await statement.first<T>(column);
        after([sql]);
        return result;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        work.calls++;
        work.statements++;
        const result = options?.columnNames
          ? await statement.raw<T>({ columnNames: true })
          : await statement.raw<T>();
        after([sql]);
        return result;
      },
      async run<T>() {
        work.calls++;
        work.statements++;
        const result = await statement.run<T>();
        after([sql]);
        return result;
      },
    } as D1PreparedStatement;
    sources.set(result, { statement, sql });
    return result;
  };
  return {
    work,
    reset: () => Object.assign(work, { calls: 0, statements: 0 }),
    after: (hook: typeof after) => {
      after = hook;
    },
    binding: {
      prepare: (sql: string) => wrap(database.prepare(sql), sql),
      async batch<T>(statements: D1PreparedStatement[]) {
        const inputs = statements.map((statement) => {
          const source = sources.get(statement);
          if (!source) throw Error("Synthetic statement missing");
          return source;
        });
        work.calls++;
        work.statements += inputs.length;
        const result = await database.batch<T>(inputs.map((input) => input.statement));
        after(inputs.map((input) => input.sql));
        return result;
      },
    } as D1Database,
  };
}

async function setup() {
  const f = await fixture();
  const measured = countCalls(f.db.binding);
  const base = createV2Core(measured.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
  });
  const profileId = crypto.randomUUID();
  expect(await createV2LawyersRepository(base).createProfile(f.actor, profileId)).toBe(true);
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
    )
    .run();
  const core = lawyerStorageRequestCore(base, false);
  const clock = () => f.actor.now;
  const cost = createLawyerStorageBudget(core, "preview", f.actor.ownerId, clock);
  let beforeDispatch = () => {};
  const costs: StorageCosts = {
    ...cost,
    beforeDispatch: async (...args) => {
      beforeDispatch();
      return cost.beforeDispatch(...args);
    },
  };
  const admission = createAssetProcessingAdmission(
    core,
    {
      APP_ENV: "preview",
      ASSET_PROCESSING: {},
      FILE_PROCESSOR: {},
    } as Env,
    {},
    clock,
  );
  const enqueueProcessing = admission.enqueueProcessing;
  if (!enqueueProcessing) throw Error("Synthetic Workflow admission missing");
  const bytes = new Uint8Array(
    await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer(),
  );
  let puts = 0;
  const service = createLawyerAssetsService(core, {
    environment: "preview",
    clock,
    paidStorage: () => costs,
    enqueueProcessing,
    fixedLengthStream: (length) => {
      let size = 0;
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          size += bytes.length;
          controller.enqueue(bytes);
        },
        flush() {
          if (size !== length) throw Error("Synthetic fixed length mismatch");
        },
      });
    },
    bucket: {
      async put(key: string, body: ReadableStream<Uint8Array>) {
        puts++;
        const value = new Uint8Array(await new Response(body).arrayBuffer());
        return { key, size: value.length };
      },
    } as never,
  });
  measured.reset();
  const reserved = await service.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    {
      purpose: "profile_photo",
      name: "synthetic.jpg",
      byteLength: bytes.length,
      mediaType: "image/jpeg",
    },
    "portfolio",
  );
  return {
    ...f,
    measured,
    reserved,
    service,
    puts: () => puts,
    beforeDispatch: (hook: typeof beforeDispatch) => {
      beforeDispatch = hook;
    },
    upload: (ownerId = f.actor.ownerId) =>
      service.upload(ownerId, reserved.assetId, 1, bytes.length, new Response(bytes).body),
  };
}

test("observation-only reserve/upload/admission counts D1 calls without cost metadata", async () => {
  const f = await setup();
  expect(f.measured.work).toEqual({ calls: 6, statements: 14 });
  expect(await f.upload()).toMatchObject({ revision: 2, processingQueued: true });
  // Baseline: 52 calls / 79 statements. Four duplicate read calls are removed.
  expect(f.measured.work).toEqual({ calls: 48, statements: 75 });
  expect(f.puts()).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "stopped",
  });
});

test("foreign owner and revoked consent cannot dispatch an original upload", async () => {
  const f = await setup();
  await expect(f.upload("foreign-owner")).rejects.toMatchObject({ code: "NOT_FOUND" });
  f.beforeDispatch(() => {
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  });
  await expect(f.upload()).rejects.toThrow();
  expect(f.puts()).toBe(0);
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM v2_execution_admissions WHERE state='dispatched'")
      .get(),
  ).toEqual({ n: 0 });
});

test("capacity lost after its preflight read is denied by atomic admission", async () => {
  const f = await setup();
  let changed = false;
  f.measured.after((sql) => {
    if (
      !changed &&
      sql.some((value) =>
        value.startsWith("SELECT 1 WHERE EXISTS(SELECT 1 FROM v2_physical_storage_capacity"),
      )
    ) {
      changed = true;
      f.db.sqlite
        .query(
          "UPDATE v2_physical_storage_capacity SET capacity_bytes=held_bytes WHERE environment='preview'",
        )
        .run();
    }
  });
  await expect(f.upload()).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.puts()).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_physical_blob_bindings").get()).toEqual({
    n: 0,
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_admissions").get()).toEqual({
    n: 0,
  });
});

test("expired deadline stops the prepared writer before external dispatch", async () => {
  const f = await setup();
  f.beforeDispatch(() => {
    f.actor.now = new Date(Date.parse(f.actor.now) + 300001).toISOString();
  });
  await expect(f.upload()).rejects.toThrow();
  expect(f.puts()).toBe(0);
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "stopped",
  });
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM v2_execution_admissions WHERE state='dispatched'")
      .get(),
  ).toEqual({ n: 0 });
});

for (const revoke of ["consent", "owner", "deadline"] as const) {
  test(`${revoke} revoked after dispatch CAS stops external IO`, async () => {
    const f = await setup();
    let changed = false;
    f.measured.after((sql) => {
      if (
        !changed &&
        sql.some((value) =>
          value.startsWith("UPDATE v2_execution_admissions SET state='dispatched'"),
        )
      ) {
        changed = true;
        if (revoke === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        else if (revoke === "owner")
          f.db.sqlite
            .query("INSERT INTO v2_tombstones VALUES('account',?,?)")
            .run(f.actor.ownerId, f.actor.now);
        else f.actor.now = new Date(Date.parse(f.actor.now) + 300001).toISOString();
      }
    });
    await expect(f.upload()).rejects.toThrow();
    expect(changed).toBe(true);
    expect(f.puts()).toBe(0);
    expect(
      f.db.sqlite.query("SELECT writer_state,state FROM v2_physical_blob_bindings").get(),
    ).toEqual({ writer_state: "stopped", state: "held" });
    expect(f.db.sqlite.query("SELECT state FROM v2_execution_admissions").get()).toEqual({
      state: "dispatched",
    });
  });
}
