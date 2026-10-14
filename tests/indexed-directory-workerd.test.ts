import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createV2Core } from "../src/server/db/v2-core";
import { createIndexedDirectory } from "../src/server/db/v2-directory-index";
import {
  directoryProjectionStatements,
  selfDirectoryProjection,
} from "../src/server/db/v2-directory-projection";
import { emptySelfProfile } from "../src/server/modules/lawyers/self-profile-contract";
import { measureD1Work } from "./helpers/d1-work";
import { DIRECTORY_NOW, directoryOptions, directorySeedSql } from "./helpers/directory-index";

test("native D1 directory uses indexed bounded reads/writes at 100 and 10000 profiles; 0012 failure rolls back DDL and marker", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic directory")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["SMALL", "LARGE", "UPGRADE"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const names = (await readdir("drizzle")).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
    const statements = async (name: string) =>
      (await Bun.file(`drizzle/${name}`).text())
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
    const upgrade = await mf.getD1Database("UPGRADE");
    for (const name of names.filter((n) => n < "0012"))
      await upgrade.batch((await statements(name)).map((sql) => upgrade.prepare(sql)));
    const migration = await statements("0012_directory_index.sql");
    await expect(
      upgrade.batch([
        ...migration.map((sql) => upgrade.prepare(sql)),
        upgrade.prepare("INSERT INTO v2_directory_epoch(id,revision) VALUES(2,0)"),
      ]),
    ).rejects.toThrow();
    expect(
      (
        await upgrade
          .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'v2_directory_%'")
          .all()
      ).results,
    ).toEqual(expect.arrayContaining([]));
    expect(
      await upgrade
        .prepare("SELECT name FROM sqlite_master WHERE name='v2_directory_entries'")
        .first(),
    ).toBeNull();
    expect(
      await upgrade
        .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
        .first("value"),
    ).toBe("0011_runtime_refresh");
    await upgrade.batch(migration.map((sql) => upgrade.prepare(sql)));
    expect(
      await upgrade
        .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
        .first("value"),
    ).toBe("0012_directory_index");
    const measurements = [];
    for (const [name, count] of [
      ["SMALL", 100],
      ["LARGE", 10000],
    ] as const) {
      const db = await mf.getD1Database(name);
      for (const migration of names)
        await db.batch((await statements(migration)).map((sql) => db.prepare(sql)));
      for (const sql of directorySeedSql(count)) await db.prepare(sql).run();
      const measured = measureD1Work(db);
      const core = createV2Core(measured.binding, {
        async encrypt(): Promise<string> {
          throw new Error("private cipher read");
        },
        async decrypt(): Promise<string> {
          throw new Error("private cipher read");
        },
      });
      const index = createIndexedDirectory(core, directoryOptions);
      const page = await index.page({
        name: "변호사",
        region: "seoul",
        legalField: "civil",
        limit: 20,
      });
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
      const read = { ...measured.work };
      expect(read.rowsWritten).toBe(0);
      expect(read.rowsRead).toBeLessThan(5000);
      const plan = (
        await db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT profile_id,sort_key FROM v2_directory_terms WHERE token=? AND sort_key>=? ORDER BY sort_key,profile_id LIMIT 101",
          )
          .bind("b:변호", "8000000000000000")
          .all<{ detail: string }>()
      ).results
        .map((r: { detail: string }) => r.detail)
        .join("\n");
      expect(plan).toMatch(/SEARCH .*INDEX|SEARCH .*PRIMARY KEY/);
      expect(plan).not.toMatch(/SCAN |TEMP B-TREE/);
      measured.reset();
      const profile = {
        ...emptySelfProfile("profile-00001"),
        name: "수정 변호사",
        officeName: "Updated office",
        introduction: "합성 공개 소개",
        region: "seoul" as const,
        practiceAreas: ["civil" as const],
        published: true,
      };
      const projection = await selfDirectoryProjection(
        core,
        "owner-00001",
        "snapshot-profile-00001",
        profile,
        DIRECTORY_NOW,
      );
      const claim = "synthetic-directory-write";
      await core.changed([
        core.statement(
          "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) VALUES(?,'owner-00001','profile-00001',1)",
          [claim],
        ),
        ...directoryProjectionStatements(core, projection, claim),
        core.finish(claim),
      ]);
      const write = { ...measured.work };
      expect(write.rowsRead).toBeLessThan(1000);
      expect(write.rowsWritten).toBeLessThan(300);
      measurements.push({ profiles: count, read, write });
    }
    const [small, large] = measurements;
    expect(large?.read.rowsRead).toBeLessThanOrEqual((small?.read.rowsRead ?? 0) + 150);
    expect(large?.write.rowsWritten).toBe(small?.write.rowsWritten);
    console.info("Synthetic native directory D1 measurements", JSON.stringify(measurements));
  } finally {
    await mf.dispose();
  }
}, 120000);
