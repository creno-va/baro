import { expect, test } from "bun:test";
import { createTestDatabase } from "../tests/helpers/d1";
import { seedTestSession } from "../tests/helpers/session";
import { prepareReplay } from "./deletion-journal";

test("prepared replay is repeatable on isolated restore and rejects plaintext/invalid targets", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db);
    const job = {
      id: crypto.randomUUID(),
      target_type: "account",
      target_id: owner.userId,
      deleted_at: new Date().toISOString(),
      workflow_instance_ids: [],
      expires_at: new Date(Date.now() + 35 * 86400000).toISOString(),
    };
    const sql = prepareReplay([job]);
    db.sqlite.exec(sql);
    db.sqlite.exec(sql);
    expect(db.sqlite.query("SELECT count(*) AS n FROM user").get()).toEqual({ n: 0 });
    expect(db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 1 });
    expect(() => prepareReplay([{ ...job, plaintext: "shadow copy" }])).toThrow();
    expect(() => prepareReplay([{ ...job, target_id: "invalid ' target" }])).toThrow();
  } finally {
    db.close();
  }
});
