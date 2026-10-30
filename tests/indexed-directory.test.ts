import { afterEach, expect, test } from "bun:test";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createIndexedDirectory } from "../src/server/db/v2-directory-index";
import { directoryTokens } from "../src/server/db/v2-directory-projection";
import { prepareV2RestoreReplay } from "../src/server/modules/deletion/restore";
import { createDirectoryMaintenance } from "../src/server/modules/lawyers/directory-maintenance";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { createTestDatabase } from "./helpers/d1";
import { countD1Calls } from "./helpers/d1-call-count";
import { DIRECTORY_NOW, directoryOptions, directorySeedSql } from "./helpers/directory-index";
import { publicationFixture } from "./helpers/lawyer-publication";
import { seedLegacySelfProfile } from "./helpers/legacy-self-profile";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const publicCipher = {
  async encrypt(): Promise<string> {
    throw new Error("private encryption");
  },
  async decrypt(): Promise<string> {
    throw new Error("private decryption");
  },
};
async function seeded(count = 100) {
  const db = await createTestDatabase();
  databases.push(db);
  for (const sql of directorySeedSql(count)) db.sqlite.exec(sql);
  const core = createV2Core(db.binding, publicCipher);
  return { db, core, index: createIndexedDirectory(core, directoryOptions) };
}
async function published() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
    .run(`account-type:${owner.userId}`);
  const env = {
    ...owner.env,
    CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
    APP_ENV: "preview",
  } as Env;
  const core = createV2Core(db.binding, await createCaseDataCipher(env));
  const service = createSelfProfileService(core, () => DIRECTORY_NOW);
  const blank = await service.getMine(owner.userId);
  const saved = await service.saveMine(owner.userId, {
    ...blank,
    name: "김한글 ＡＢＣ [A%_]",
    officeName: "Alpha Office 합성",
    introduction: "공개 소개",
    address: "private-address",
    region: "seoul",
    practiceAreas: ["civil"],
    email: "private-contact@example.invalid",
    portfolio: [
      { id: "private-detail", title: "공개 상세만", text: "not-list-content", url: null },
    ],
  });
  const value = await service.publishMine(owner.userId, true, saved.revision, saved.id);
  return {
    db,
    env,
    core,
    service,
    value,
    owner,
    index: createIndexedDirectory(createV2Core(db.binding, publicCipher), directoryOptions),
  };
}
test("Korean, Latin, NFKC and punctuation partial searches read only minimal public cards", async () => {
  const f = await published();
  for (const name of ["한글", "abc", "ABC", "office", "[A%_]", "합성"]) {
    const page = await f.index.page({ name, limit: 20 });
    expect(page.items.map((p) => p.id)).toEqual([f.value.id]);
    expect(JSON.stringify(page.items)).not.toMatch(
      /private-address|private-contact|not-list-content|portfolio/,
    );
  }
  expect((await f.index.page({ name: "%", limit: 20 })).items).toHaveLength(1);
  expect((await f.index.page({ name: "한글x", limit: 20 })).items).toEqual([]);
  expect((await f.index.page({ region: "busan", limit: 20 })).items).toEqual([]);
  expect((await f.index.page({ legalField: "labor", limit: 20 })).items).toEqual([]);
  expect(
    (await f.index.page({ region: "seoul", legalField: "civil", limit: 20 })).items,
  ).toHaveLength(1);
  const response = await createDirectoryApi({ clock: () => DIRECTORY_NOW }).request(
    "/directory",
    {},
    { ...f.env, CASE_DATA_KEY_V1: undefined },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body as object).sort()).toEqual([
    "expiresAt",
    "items",
    "nextCursor",
    "rotation",
  ]);
  expect(directoryTokens("김가", "AB")).toContain("b:김가");
});
test("daily pivot keysets visit all profiles once, without writes or materialized snapshots", async () => {
  const f = await seeded();
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await f.index.page({ limit: 7, ...(cursor ? { cursor } : {}) });
    seen.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toHaveLength(100);
  expect(new Set(seen).size).toBe(100);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_directory_snapshots").get()).toEqual({
    n: 0,
  });
  const tomorrow = createIndexedDirectory(f.core, {
    ...directoryOptions,
    clock: () => "2026-10-15T00:00:00.000Z",
  });
  expect((await tomorrow.page({ limit: 7 })).items.map((p) => p.id)).not.toEqual(seen.slice(0, 7));
});
test("bounded false-positive windows advance even when a page is empty", async () => {
  const f = await seeded(250);
  const first = await f.index.page({ name: "abc", limit: 20 });
  expect(first.items).toEqual([]);
  expect(first.nextCursor).not.toBeNull();
  const before = f.db.queryCount;
  const second = await f.index.page({ name: "abc", limit: 20, cursor: first.nextCursor ?? "" });
  expect(second.items).toEqual([]);
  expect(f.db.queryCount - before).toBeLessThanOrEqual(14);
});
test("cursor rejects condition changes, environment/release mixing, expiry, day changes and tampering", async () => {
  const f = await seeded();
  const first = await f.index.page({ limit: 1 });
  const cursor = first.nextCursor ?? "";
  expect(cursor.length).toBeGreaterThan(32);
  expect(cursor).not.toContain("profile-");
  await expect(f.index.page({ limit: 2, cursor })).rejects.toMatchObject({
    code: "CURSOR_EXPIRED",
  });
  await expect(f.index.page({ limit: 1, region: "seoul", cursor })).rejects.toMatchObject({
    code: "CURSOR_EXPIRED",
  });
  for (const scope of ["production:synthetic-release", "preview:other-release"]) {
    await expect(
      createIndexedDirectory(f.core, { ...directoryOptions, scope }).page({ limit: 1, cursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  }
  for (const now of ["2026-10-14T00:06:00.000Z", "2026-10-15T00:00:00.000Z"]) {
    await expect(
      createIndexedDirectory(f.core, { ...directoryOptions, clock: () => now }).page({
        limit: 1,
        cursor,
      }),
    ).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
  }
  await expect(
    f.index.page({ limit: 1, cursor: `${cursor.slice(0, -8)}aaaaaaaa` }),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
});
test("published edits update terms atomically; withdrawal removes all derived rows and invalidates old cursors", async () => {
  const f = await published();
  await f.service.saveMine(f.owner.userId, { ...f.value, name: "Changed Name" });
  expect((await f.index.page({ name: "한글", limit: 20 })).items).toEqual([]);
  expect((await f.index.page({ name: "changed", limit: 20 })).items).toHaveLength(1);
  const current = await f.service.getMine(f.owner.userId);
  await seedLegacySelfProfile(f.core, f.owner.userId, {
    ...current,
    published: false,
    revision: current.revision + 1,
  });
  for (const table of [
    "v2_directory_entries",
    "v2_directory_terms",
    "v2_directory_facets",
    "v2_directory_asset_refs",
  ]) {
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  }
});
test("withdrawal during cursor crypto is rejected by the final authorization fence", async () => {
  const f = await seeded();
  const prepare = f.db.binding.prepare;
  let intercepted = false;
  f.db.binding.prepare = (sql) => {
    if (!intercepted && sql.startsWith("SELECT epoch.revision AS epoch")) {
      intercepted = true;
      f.db.sqlite.exec(
        "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account','owner-00001','2026-10-14T00:00:00Z')",
      );
    }
    return prepare(sql);
  };
  await expect(f.index.page({ limit: 20 })).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
  expect(intercepted).toBe(true);
});
test("restore replay re-deletes projection even if a tombstone already exists", async () => {
  const f = await seeded();
  f.db.sqlite.exec(
    "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account','owner-00001','2026-10-14T00:00:00Z')",
  );
  // Simulate a stale restored projection after the deletion journal was restored.
  f.db.sqlite.exec(
    "INSERT INTO v2_directory_entries SELECT 'profile-00001','owner-00001','self','snapshot-profile-00001',1,'0000000000000001','stale','office','seoul',public_json,NULL,'[\"c:s\"]','[\"*|*\"]','[]',updated_at FROM v2_directory_entries LIMIT 1",
  );
  const replay = prepareV2RestoreReplay(
    {
      journals: [
        {
          id: "restore-dir",
          target_kind: "account",
          target_id: "owner-00001",
          created_at: DIRECTORY_NOW,
        },
      ],
      targets: [],
      reservations: [],
      blobs: [],
      bindings: [],
    },
    { trafficClosed: true, environment: "preview", now: DIRECTORY_NOW },
  );
  for (const sql of replay) f.db.sqlite.exec(sql);
  expect(
    f.db.sqlite
      .query("SELECT profile_id FROM v2_directory_entries WHERE owner_id='owner-00001'")
      .get(),
  ).toBeNull();
});
test("bounded backfill is idempotent, indexes existing public sources and never decrypts a private draft", async () => {
  const f = await published();
  f.db.sqlite.exec("DELETE FROM v2_directory_entries");
  const maintenance = createDirectoryMaintenance(f.core, () => DIRECTORY_NOW);
  expect((await maintenance.batch()).indexed).toBe(1);
  const before = f.db.sqlite.query("SELECT revision FROM v2_directory_epoch").get();
  await maintenance.batch();
  expect(f.db.sqlite.query("SELECT revision FROM v2_directory_epoch").get()).toEqual(before);
  await seedLegacySelfProfile(f.core, f.owner.userId, {
    ...f.value,
    published: false,
    revision: f.value.revision + 1,
  });
  const noPrivate = createDirectoryMaintenance(
    createV2Core(f.db.binding, publicCipher),
    () => DIRECTORY_NOW,
  );
  expect((await noPrivate.batch()).indexed).toBe(0);
});

test("verified public cards keep qualification status; a private self version suppresses the legacy publication", async () => {
  const f = await publicationFixture();
  databases.push(f.db);
  await f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  await f.service.finalize(f.owner.userId, f.profileId, 2);
  const index = createIndexedDirectory(createV2Core(f.db.binding, publicCipher), {
    ...directoryOptions,
    clock: () => "2026-10-06T00:00:00.000Z",
  });
  expect((await index.page({ limit: 20 })).items[0]?.verificationStatus).toBe("verified");
  const self = createSelfProfileService(f.core, () => "2026-10-06T00:00:00.000Z");
  const blank = await self.getMine(f.owner.userId);
  await seedLegacySelfProfile(f.core, f.owner.userId, { ...blank, name: "Private draft" });
  expect((await index.page({ limit: 20 })).items).toEqual([]);
  expect((await createDirectoryMaintenance(f.core).batch()).indexed).toBe(0);
});

test("empty facet-only pages keep both pivot ranges and final epoch fence without lead sampling", async () => {
  const db = await createTestDatabase();
  databases.push(db);
  const f = { db };
  const meter = countD1Calls(f.db.binding);
  const index = createIndexedDirectory(createV2Core(meter.binding, publicCipher), directoryOptions);
  const page = await index.page({ limit: 20 });
  expect(page.items).toEqual([]);
  expect(page.nextCursor).toBeNull();
  expect(meter.work).toEqual({ calls: 4, statements: 4 });
  meter.reset();
  await index.page({ region: "seoul", legalField: "civil", limit: 20 });
  expect(meter.work.calls).toBe(4);
});
