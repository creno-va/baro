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
      { value: "0002_oauth_session_security" },
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
