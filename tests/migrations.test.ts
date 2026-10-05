import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createTestDatabase } from "./helpers/d1";

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
      { value: "0005_deletion_cleanup" },
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
