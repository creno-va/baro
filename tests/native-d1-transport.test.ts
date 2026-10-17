import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { nativeD1Transport, nativeD1TransportWorker } from "./helpers/native-d1-transport";

test("async native D1 transport preserves real binding values, metadata, constraints and atomic rollback", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: nativeD1TransportWorker,
      host: "127.0.0.1",
      compatibilityDate: "2026-10-01",
      d1Databases: ["DIRECT", "TRANSPORT"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const direct = (await mf.getD1Database("DIRECT")) as unknown as D1Database;
    const transported = nativeD1Transport(mf, "TRANSPORT");
    const databases = [direct, transported];
    const bytes = new Uint8Array([99, 1, 2, 3, 88]);
    for (const value of [null, "합성 값", 17, 1.25, bytes.buffer, bytes.subarray(1, 4), [4, 5]]) {
      const results = await Promise.all(
        databases.map((db) => db.prepare("SELECT ? value").bind(value).all()),
      );
      expect(results[1]?.results).toEqual(results[0]?.results);
      for (const result of results) {
        expect(result?.success).toBe(true);
        expect(result?.meta.rows_read).toBeGreaterThanOrEqual(0);
        expect(result?.meta.duration).toBeGreaterThanOrEqual(0);
      }
    }
    for (const value of [undefined, true, {}, new Date(0), 1n, Number.NaN, Infinity]) {
      const results = await Promise.allSettled(
        databases.map(async (db) => db.prepare("SELECT ? value").bind(value).all()),
      );
      // Native D1 is the oracle, including numeric inputs it may normalize.
      expect(results[1]?.status).toBe(results[0]?.status);
      if (results[0]?.status === "fulfilled" && results[1]?.status === "fulfilled")
        expect(results[1].value.results).toEqual(results[0].value.results);
    }
    for (const db of databases) {
      await db.batch([
        db.prepare("CREATE TABLE item(id INTEGER PRIMARY KEY, value TEXT UNIQUE NOT NULL)"),
        db.prepare("CREATE TABLE audit(item_id INTEGER NOT NULL REFERENCES item(id))"),
        db.prepare(
          "CREATE TRIGGER record_item AFTER INSERT ON item BEGIN INSERT INTO audit VALUES(new.id); END",
        ),
      ]);
      const result = await db
        .prepare("INSERT INTO item VALUES(?,?) RETURNING id,value")
        .bind(1, "one")
        .all();
      expect(result.results).toEqual([{ id: 1, value: "one" }]);
      expect(result.meta.changes).toBe(2);
      expect(result.meta.rows_written).toBeGreaterThanOrEqual(2);
      await expect(
        db.batch([
          db.prepare("INSERT INTO item VALUES(2,'two')"),
          db.prepare("INSERT INTO item VALUES(3,'one')"),
        ]),
      ).rejects.toThrow();
      expect(await db.prepare("SELECT count(*) n FROM item").first<number>("n")).toBe(1);
      expect(await db.prepare("SELECT count(*) n FROM audit").first<number>("n")).toBe(1);
      expect(await db.prepare("SELECT value FROM item WHERE id=9").first()).toBeNull();
      expect(await db.prepare("SELECT id,value FROM item").raw({ columnNames: true })).toEqual([
        ["id", "value"],
        [1, "one"],
      ]);
      const statement = db.prepare("SELECT ? value");
      const first = statement.bind("first");
      const second = first.bind("second");
      expect(await first.first<string>("value")).toBe("first");
      expect(await second.first<string>("value")).toBe("second");
      expect(
        (await db.prepare("UPDATE item SET value='changed' WHERE id=1").run()).meta.changes,
      ).toBe(1);
      expect(await db.prepare("SELECT value FROM item WHERE id=1").first<string>("value")).toBe(
        "changed",
      );
    }
    const failures = await Promise.all(
      databases.map(async (db) => {
        try {
          await db.prepare("INSERT INTO item VALUES(2,'changed')").run();
          throw new Error("Native constraint was not enforced");
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return {
            name: error.name,
            message: error.message,
            cause: error.cause instanceof Error ? error.cause.message : null,
          };
        }
      }),
    );
    expect(failures[1]).toEqual(failures[0]);
    expect(failures[0]?.message).toContain("D1_ERROR");
  } finally {
    await mf.dispose();
  }
}, 10000);
