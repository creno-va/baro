import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createTestDatabase } from "./helpers/d1";

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
      { value: "0003_domain_foundation" },
    );
  } finally {
    database.close();
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
