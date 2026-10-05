import { afterEach, expect, test } from "bun:test";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
test("actual D1 integer metadata preserves exact maximum and rejects fractional/negative/unsafe counters atomically", async () => {
  const db = await createTestDatabase();
  databases.push(db);
  const session = await seedTestSession(db, {
    now: Date.parse("2026-10-06T00:00:00.000Z"),
    consent: true,
  });
  db.sqlite
    .query("INSERT INTO v2_daily_usage(owner_id,day) VALUES(?,'2026-10-06')")
    .run(session.userId);
  db.sqlite
    .query("UPDATE v2_daily_usage SET cases_used=? WHERE owner_id=?")
    .run(Number.MAX_SAFE_INTEGER, session.userId);
  expect(
    db.sqlite.query("SELECT cases_used FROM v2_daily_usage WHERE owner_id=?").get(session.userId),
  ).toEqual({ cases_used: Number.MAX_SAFE_INTEGER });
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 0.5, -1]) {
    expect(() =>
      db.sqlite
        .query("UPDATE v2_daily_usage SET cases_used=? WHERE owner_id=?")
        .run(value, session.userId),
    ).toThrow();
    expect(
      db.sqlite.query("SELECT cases_used FROM v2_daily_usage WHERE owner_id=?").get(session.userId),
    ).toEqual({ cases_used: Number.MAX_SAFE_INTEGER });
  }
  expect(() =>
    db.sqlite
      .query("INSERT INTO v2_daily_usage(owner_id,day,cases_reserved) VALUES(?,'2026-10-07',?)")
      .run(session.userId, Number.MAX_SAFE_INTEGER + 1),
  ).toThrow();
  expect(
    db.sqlite.query("SELECT count(*) AS n FROM v2_daily_usage WHERE day='2026-10-07'").get(),
  ).toEqual({ n: 0 });
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
