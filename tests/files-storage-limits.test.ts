import { expect, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import {
  FILE_STORAGE_CLEANUP_QUERIES,
  FILE_STORAGE_WORK,
  fileStorageRequestCore,
  withFileStorageCleanup,
} from "../src/server/modules/files/limits";
import { fixture } from "./helpers/file-processing-fixture";

test("binary-part D1 meter counts all statement surfaces and batch members before dispatch", async () => {
  const f = await fixture(),
    core = fileStorageRequestCore(f.core, false);
  await core.statement("SELECT 1").first();
  await core.statement("SELECT 1").raw();
  await core.statement("SELECT 1").run();
  await core.statement("SELECT 1").all();
  await core.binding.batch(
    Array.from({ length: FILE_STORAGE_WORK.queries - FILE_STORAGE_CLEANUP_QUERIES - 4 }, () =>
      core.statement("SELECT 1"),
    ),
  );
  const before = f.db.queryCount;
  await expect(core.statement("SELECT 1").all()).rejects.toThrow("PROCESSING_UNAVAILABLE");
  await expect(core.binding.batch([core.statement("SELECT 1")])).rejects.toThrow(
    "PROCESSING_UNAVAILABLE",
  );
  expect(f.db.queryCount).toBe(before);
  await withFileStorageCleanup(core, async () => {
    await core.statement("SELECT 1").all();
    await core.binding.batch(Array.from({ length: 5 }, () => core.statement("SELECT 1")));
    await expect(core.statement("SELECT 1").all()).rejects.toThrow("PROCESSING_UNAVAILABLE");
  });
  expect(f.db.queryCount).toBe(before + FILE_STORAGE_CLEANUP_QUERIES);
  await expect(core.statement("SELECT 1").all()).rejects.toThrow("PROCESSING_UNAVAILABLE");
  await expect(
    withFileStorageCleanup(core, async () => core.statement("SELECT 1").all()),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect(f.db.queryCount).toBe(before + FILE_STORAGE_CLEANUP_QUERIES);
});

test.each(["missing", "read", "write", "negative"])(
  "binary-part D1 meter stops further SQL after %s metadata",
  async (failure) => {
    const f = await fixture();
    const meta =
      failure === "missing"
        ? undefined
        : {
            rows_read:
              failure === "read" ? FILE_STORAGE_WORK.rowsRead + 1 : failure === "negative" ? -1 : 1,
            rows_written: failure === "write" ? FILE_STORAGE_WORK.rowsWritten + 1 : 0,
          };
    let calls = 0;
    const statement = {
      bind: () => statement,
      all: async () => {
        calls++;
        return { success: true, results: [{ value: 1 }], meta };
      },
    };
    const binding = {
      prepare: () => statement,
      batch: async () => {
        calls++;
        return [{ success: true, results: [], meta }];
      },
    } as unknown as D1Database;
    const core = fileStorageRequestCore(createV2Core(binding, f.core.cipher));
    await expect(core.statement("SELECT 1").first()).rejects.toThrow("PROCESSING_UNAVAILABLE");
    expect(calls).toBe(1);
    await expect(core.statement("SELECT 1").all()).rejects.toThrow("PROCESSING_UNAVAILABLE");
    await expect(core.binding.batch([core.statement("SELECT 1")])).rejects.toThrow(
      "PROCESSING_UNAVAILABLE",
    );
    expect(calls).toBe(1);
  },
);

test("D1 batch receipts accumulate each member instead of accepting only its first receipt", async () => {
  const f = await fixture();
  let calls = 0;
  const binding = {
    prepare: () => ({
      bind() {
        return this;
      },
    }),
    batch: async () => {
      calls++;
      return [1, 2].map(() => ({
        results: [],
        success: true,
        meta: { rows_read: FILE_STORAGE_WORK.rowsRead, rows_written: 0 },
      }));
    },
  } as unknown as D1Database;
  const core = fileStorageRequestCore(createV2Core(binding, f.core.cipher));
  await expect(
    core.binding.batch([core.statement("SELECT 1"), core.statement("SELECT 1")]),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  await expect(core.binding.batch([core.statement("SELECT 1")])).rejects.toThrow(
    "PROCESSING_UNAVAILABLE",
  );
  expect(calls).toBe(1);
});
