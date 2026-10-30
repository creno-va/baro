import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { emptySelfProfile } from "../src/contracts/v2/self-profile";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { createTestDatabase } from "./helpers/d1";
import { seedLegacySelfProfile } from "./helpers/legacy-self-profile";
import { seedTestSession } from "./helpers/session";

test("public-on-save upgrade preserves encrypted drafts, linked assets and reviewed history", async () => {
  const db = await createTestDatabase({ throughMigration: "0018_external_lookup_admission" });
  try {
    const cipher = await createCaseDataCipher({
      CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    });
    const core = createV2Core(db.binding, cipher);
    const service = createSelfProfileService(core);
    const owners = await Promise.all(
      [true, false, true].map(() => seedTestSession(db, { consent: true })),
    );
    for (const [index, owner] of owners.entries()) {
      db.sqlite
        .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
        .run(`account-type:${owner.userId}`);
      const profile = await service.getMine(owner.userId);
      await seedLegacySelfProfile(core, owner.userId, {
        ...profile,
        name: "합성 변호사",
        introduction: "합성 소개",
        officeName: "합성 사무실",
        address: "합성 주소",
        region: "seoul",
        practiceAreas: ["civil"],
        email: "synthetic@example.invalid",
        published: index !== 1,
      });
      db.sqlite
        .query(
          "INSERT INTO v2_assets(id,owner_id,profile_id,revision,purpose,state,encrypted_payload,created_at) VALUES(?,?,?,1,'portfolio','reserved','opaque-asset','2026-10-14')",
        )
        .run(`asset-${index}`, owner.userId, profile.id);
      db.sqlite
        .query(
          "INSERT INTO v2_profile_revisions(id,profile_id,revision,status,encrypted_payload,created_at) VALUES(?,?,1,'draft','opaque-reviewed-history','2026-10-14')",
        )
        .run(`review-${index}`, profile.id);
      if (index === 2)
        db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('profile',?,'2026-10-15')")
          .run(profile.id);
    }
    const tables = [
      "v2_private_snapshots",
      "v2_private_parts",
      "v2_consents",
      "v2_assets",
      "v2_profile_revisions",
    ];
    const before = tables.map((table) => db.sqlite.query(`SELECT * FROM ${table}`).all());
    const migration = await Bun.file("drizzle/0019_self_profile_listing.sql").text();
    db.sqlite.transaction(() => db.sqlite.exec(migration))();
    expect(tables.map((table) => db.sqlite.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    for (const [index, owner] of owners.entries())
      expect(
        db.sqlite
          .query("SELECT self_listing_state FROM v2_profiles WHERE owner_id=?")
          .get(owner.userId),
      ).toEqual({ self_listing_state: index === 0 ? "listed" : "unlisted" });
    expect(() => db.sqlite.exec("UPDATE v2_profiles SET self_listing_state='private'")).toThrow();
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const legacy = await service.getMine(owners[1]!.userId);
    expect(legacy.published).toBe(false);
    await expect(service.get(legacy.id)).rejects.toThrow();
    const saved = await service.saveMine(owners[1]!.userId, legacy);
    expect(saved.published).toBe(true);
    expect(await service.get(saved.id)).toEqual(saved);
    expect(
      db.sqlite.query("SELECT self_listing_state FROM v2_profiles WHERE id=?").get(saved.id),
    ).toEqual({ self_listing_state: "listed" });
    const empty = await seedTestSession(db, { consent: true });
    db.sqlite
      .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
      .run(`account-type:${empty.userId}`);
    const blank = await service.getMine(empty.userId);
    await expect(service.saveMine(empty.userId, emptySelfProfile(blank.id))).rejects.toThrow();
    expect(
      db.sqlite.query("SELECT self_listing_state FROM v2_profiles WHERE id=?").get(blank.id),
    ).toEqual({ self_listing_state: "unlisted" });
  } finally {
    db.close();
  }
});

test("cleanup upgrade preserves opaque journals and auth/domain data with safe scheduling defaults", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0000_foundation",
      "0001_auth_and_consent",
      "0002_oauth_session_security",
      "0003_domain_foundation",
      "0004_case_feedback",
    ])
      sqlite.exec(await Bun.file(`drizzle/${name}.sql`).text());
    sqlite.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','Synthetic','synthetic@example.test',1,2)",
    );
    sqlite.exec(
      "INSERT INTO deletion_jobs VALUES('j','account','opaque','2026-10-05T00:00:00Z','[\"opaque-1\"]','deleted','pending',2,'2026-11-09T00:00:00Z')",
    );
    const before = sqlite.query("SELECT * FROM user").all();
    const journal = sqlite.query("SELECT * FROM deletion_jobs").get();
    sqlite.exec(await Bun.file("drizzle/0005_deletion_cleanup.sql").text());
    expect(sqlite.query("SELECT * FROM user").all()).toEqual(before);
    expect(sqlite.query("SELECT * FROM deletion_jobs WHERE id='j'").get()).toEqual({
      ...(journal as object),
      cleanup_cursor: 0,
      next_attempt_at: "1970-01-01T00:00:00.000Z",
    });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("fresh migrations enforce auth FK, cascade and consent age constraints", async () => {
  const database = await createTestDatabase();
  try {
    const { sqlite } = database;
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','Synthetic','synthetic@example.test',1,1)",
    );
    expect(() =>
      sqlite.exec("INSERT INTO user_consents VALUES('u','v','v','v',0,'2026-10-05')"),
    ).toThrow();
    expect(() =>
      sqlite.exec("INSERT INTO user_consents VALUES('missing','v','v','v',1,'2026-10-05')"),
    ).toThrow();
    sqlite.exec("INSERT INTO user_consents VALUES('u','v','v','v',1,'2026-10-05')");
    sqlite.exec("DELETE FROM user WHERE id='u'");
    expect(sqlite.query("SELECT * FROM user_consents").all()).toEqual([]);
    expect(sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get()).toEqual(
      { value: "0019_self_profile_listing" },
    );
  } finally {
    database.close();
  }
});

test("feedback upgrade preserves domain/auth rows, restricts boolean and cascades primary deletion", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    for (const file of [
      "0000_foundation",
      "0001_auth_and_consent",
      "0002_oauth_session_security",
      "0003_domain_foundation",
    ])
      sqlite.exec(await Bun.file(`drizzle/${file}.sql`).text());
    sqlite.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','Synthetic','synthetic@example.test',1,2)",
    );
    sqlite.exec(
      "INSERT INTO cases(id,user_id,status,encrypted_input,current_analysis_id,created_at,updated_at) VALUES('c','u','screening','synthetic-ciphertext','a','2026-10-05T00:00:00Z','2026-10-05T00:00:00Z')",
    );
    sqlite.exec(
      "INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,status,created_at,updated_at) VALUES('a','c','a-1',1,'queued','2026-10-05T00:00:00Z','2026-10-05T00:00:00Z')",
    );
    sqlite.exec("INSERT INTO daily_usage VALUES('u','2026-10-05',1,'2026-10-05T00:00:00Z')");
    const tables = [
      "user",
      "cases",
      "analyses",
      "daily_usage",
      "idempotency_records",
      "dispatch_outbox",
      "citations",
      "legal_source_cache",
      "deletion_jobs",
      "session",
      "account",
      "user_consents",
      "verification",
    ];
    const before = tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all());
    sqlite.exec(await Bun.file("drizzle/0004_case_feedback.sql").text());
    expect(tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(() =>
      sqlite.exec("INSERT INTO case_feedback VALUES('c','a',2,'2026-10-05T00:00:00Z')"),
    ).toThrow();
    expect(() =>
      sqlite.exec("INSERT INTO case_feedback VALUES('missing','a',1,'2026-10-05T00:00:00Z')"),
    ).toThrow();
    sqlite.exec("INSERT INTO case_feedback VALUES('c','a',1,'2026-10-05T00:00:00Z')");
    sqlite.exec("DELETE FROM cases WHERE id='c'");
    expect(sqlite.query("SELECT * FROM case_feedback").all()).toEqual([]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("auth migration preserves an existing foundation database", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(await Bun.file("drizzle/0000_foundation.sql").text());
    sqlite.exec("INSERT INTO app_metadata(key,value) VALUES('synthetic-sentinel','preserved')");
    sqlite.exec(await Bun.file("drizzle/0001_auth_and_consent.sql").text());
    expect(
      sqlite.query("SELECT value FROM app_metadata WHERE key='synthetic-sentinel'").get(),
    ).toEqual({ value: "preserved" });
  } finally {
    sqlite.close();
  }
});

test("auth security upgrade preserves existing data and requires real reauthentication", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(await Bun.file("drizzle/0000_foundation.sql").text());
    sqlite.exec(await Bun.file("drizzle/0001_auth_and_consent.sql").text());
    sqlite.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','Synthetic','synthetic@example.test',1,1)",
    );
    sqlite.exec(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES('s','u','synthetic-token',9999999999999,1,1)",
    );
    sqlite.exec(
      "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('a','synthetic-account','google','u',1,1)",
    );
    sqlite.exec(await Bun.file("drizzle/0002_oauth_session_security.sql").text());
    expect(sqlite.query("SELECT user_id,token,oauth_authenticated_at FROM session").get()).toEqual({
      user_id: "u",
      token: "synthetic-token",
      oauth_authenticated_at: null,
    });
    expect(sqlite.query("SELECT user_id,account_id FROM account").get()).toEqual({
      user_id: "u",
      account_id: "synthetic-account",
    });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("domain upgrade preserves every auth row and adds only the domain tables", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0000_foundation",
      "0001_auth_and_consent",
      "0002_oauth_session_security",
    ]) {
      sqlite.exec(await Bun.file(`drizzle/${name}.sql`).text());
    }
    sqlite.exec(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('u','Synthetic','synthetic@example.test',1,1,2)",
    );
    sqlite.exec(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at,oauth_authenticated_at) VALUES('s','u','synthetic-session',9999999999999,1,2,2)",
    );
    sqlite.exec(
      "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('a','synthetic-account','google','u',1,2)",
    );
    sqlite.exec(
      "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES('v','synthetic-state','synthetic-value',9999999999999,1,2)",
    );
    sqlite.exec("INSERT INTO user_consents VALUES('u','v1','v1','v1',1,'2026-10-05T00:00:00Z')");
    sqlite.exec("INSERT INTO app_metadata(key,value) VALUES('synthetic-sentinel','preserved')");
    const tables = ["user", "session", "account", "verification", "user_consents"];
    const before = tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all());
    sqlite.exec(await Bun.file("drizzle/0003_domain_foundation.sql").text());
    expect(tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(
      sqlite.query("SELECT value FROM app_metadata WHERE key='synthetic-sentinel'").get(),
    ).toEqual({ value: "preserved" });
    expect(sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get()).toEqual(
      { value: "0003_domain_foundation" },
    );
    for (const table of [
      "cases",
      "analyses",
      "citations",
      "daily_usage",
      "legal_source_cache",
      "idempotency_records",
      "dispatch_outbox",
      "deletion_jobs",
    ]) {
      expect(sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});
