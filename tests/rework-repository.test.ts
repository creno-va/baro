import { expect, test } from "bun:test";
import { z } from "zod";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const schema = z.strictObject({ text: z.string() });
test("0022 upgrades without rewriting account consent, auth or existing cost observations", async () => {
  const db = await createTestDatabase({ throughMigration: "0021_drop_consent_age" });
  try {
    await seedTestSession(db, { consent: true });
    const tables = [
      "user",
      "session",
      "user_consents",
      "v2_cost_attempts",
      "v2_workspaces",
      "v2_operations",
    ];
    const before = tables.map((table) => db.sqlite.query(`SELECT * FROM ${table}`).all());
    const migration = await Bun.file("drizzle/0022_conversation_rework.sql").text();
    db.sqlite.transaction(() => db.sqlite.exec(migration))();
    expect(tables.map((table) => db.sqlite.query(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.sqlite.query("SELECT count(*) count FROM v2_rework_records").get()).toEqual({
      count: 0,
    });
    expect(
      db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
    ).toEqual({ value: "0022_conversation_rework" });
  } finally {
    db.sqlite.close();
  }
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  const g = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: f.workspace.workspaceRevision,
    now: f.now,
  };
  return { ...f, g, records: createV2ReworkRepository(f.core, { clock: () => f.now }) };
}
test("encrypted multi-part rework records preserve immutable versions and current CAS", async () => {
  const f = await fixture();
  try {
    const value = { text: "합성 자료와 사용자 확인 내용을 보존합니다. ".repeat(10000) };
    const first = await f.records.write(f.g, {
      kind: "analysis",
      expectedVersion: 0,
      value,
      schema,
    });
    expect(first?.revision).toBe(1);
    expect(await f.records.head(f.g, f.workspace.id, "analysis", f.workspace.id)).toMatchObject({
      id: first?.id,
      revision: 1,
      workspaceRevision: f.g.expectedRevision,
    });
    expect(
      (await f.records.read(f.g, f.workspace.id, "analysis", f.workspace.id, schema))?.value,
    ).toEqual(value);
    const rows = f.db.sqlite.query("SELECT encrypted_payload FROM v2_rework_parts").all();
    expect(rows.length).toBeGreaterThan(4);
    expect(JSON.stringify(rows)).not.toContain("합성 자료");
    expect(
      await f.records.write(f.g, {
        kind: "analysis",
        expectedVersion: 0,
        value: { text: "경합한 이전 버전" },
        schema,
      }),
    ).toBeNull();
    const second = await f.records.write(f.g, {
      kind: "analysis",
      expectedVersion: 1,
      value: { text: "다음 분석" },
      schema,
    });
    expect(second?.revision).toBe(2);
    expect(await f.records.head(f.g, f.workspace.id, "analysis", f.workspace.id)).toMatchObject({
      id: second?.id,
      revision: 2,
    });
    expect(
      (await f.records.read(f.g, f.workspace.id, "analysis", f.workspace.id, schema, first?.id))
        ?.value,
    ).toEqual(value);
    expect(
      (await f.records.read(f.g, f.workspace.id, "analysis", f.workspace.id, schema))?.id,
    ).toBe(second?.id);
  } finally {
    f.db.sqlite.close();
  }
});
test("concurrent snapshots cannot both publish the same expected version", async () => {
  const f = await fixture();
  try {
    const values = await Promise.all(
      ["첫째", "둘째"].map((text) =>
        f.records.write(f.g, { kind: "context", expectedVersion: 0, value: { text }, schema }),
      ),
    );
    expect(values.filter(Boolean)).toHaveLength(1);
    expect(
      f.db.sqlite
        .query("SELECT count(*) count FROM v2_rework_records WHERE state='published'")
        .get(),
    ).toEqual({ count: 1 });
  } finally {
    f.db.sqlite.close();
  }
});
test("source authority and consent are checked in the final publication transaction", async () => {
  const f = await fixture();
  try {
    await f.records.write(f.g, {
      kind: "analysis",
      expectedVersion: 0,
      value: { text: "이전 분석" },
      schema,
    });
    const result = await f.records.write(f.g, {
      kind: "analysis",
      expectedVersion: 1,
      value: { text: "게시되면 안 되는 분석" },
      schema,
      authority: () => {
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
        return { sql: "1", values: [] };
      },
    });
    expect(result).toBeNull();
    // Prior reads remain available after consent revocation, without approving new writes.
    expect(
      (await f.records.read(f.g, f.workspace.id, "analysis", f.workspace.id, schema))?.value.text,
    ).toBe("이전 분석");
    expect(
      await f.records.write(f.g, {
        kind: "context",
        expectedVersion: 0,
        value: { text: "새 요청" },
        schema,
      }),
    ).toBeNull();
  } finally {
    f.db.sqlite.close();
  }
});
test("a rejected source proof leaves only an unpublished encrypted stage", async () => {
  const f = await fixture();
  try {
    expect(
      await f.records.write(f.g, {
        kind: "analysis",
        expectedVersion: 0,
        value: { text: "검증 불가 근거" },
        schema,
        authority: { sql: "0", values: [] },
      }),
    ).toBeNull();
    expect(
      await f.records.read(f.g, f.workspace.id, "analysis", f.workspace.id, schema),
    ).toBeNull();
    expect(f.db.sqlite.query("SELECT state FROM v2_rework_records").get()).toEqual({
      state: "staging",
    });
  } finally {
    f.db.sqlite.close();
  }
});
test("wrong owner, changed workspace revision and deleted cases cannot read or publish", async () => {
  const f = await fixture();
  try {
    await f.records.write(f.g, {
      kind: "context",
      expectedVersion: 0,
      value: { text: "원래 맥락" },
      schema,
    });
    expect(
      await f.records.read(
        { ...f.g, ownerId: "other_owner" },
        f.workspace.id,
        "context",
        f.workspace.id,
        schema,
      ),
    ).toBeNull();
    f.db.sqlite
      .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
      .run(f.workspace.id);
    expect(
      await f.records.write(f.g, {
        kind: "context",
        expectedVersion: 1,
        value: { text: "오래된 변경" },
        schema,
      }),
    ).toBeNull();
    f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspace.id);
    expect(await f.records.read(f.g, f.workspace.id, "context", f.workspace.id, schema)).toBeNull();
    expect(f.db.sqlite.query("SELECT count(*) count FROM v2_rework_parts").get()).toEqual({
      count: 0,
    });
  } finally {
    f.db.sqlite.close();
  }
});
test("part substitution, corruption and missing fragments fail integrity checks", async () => {
  const f = await fixture();
  try {
    const saved = await f.records.write(f.g, {
      kind: "reconciliation",
      expectedVersion: 0,
      value: { text: "요약 변경 제안" },
      schema,
    });
    const part = f.db.sqlite
      .query("SELECT id,encrypted_payload FROM v2_rework_parts WHERE record_id=?")
      .get(saved?.id ?? "") as { id: string; encrypted_payload: string };
    expect(() =>
      f.db.sqlite
        .query("UPDATE v2_rework_parts SET encrypted_payload=? WHERE id=?")
        .run(`${part.encrypted_payload.slice(0, -2)}xx`, part.id),
    ).toThrow();
    // Inject damaged backup bytes after explicitly removing only the synthetic integrity trigger.
    f.db.sqlite.exec("DROP TRIGGER v2_rework_part_immutable");
    f.db.sqlite
      .query("UPDATE v2_rework_parts SET encrypted_payload=? WHERE id=?")
      .run(`${part.encrypted_payload.slice(0, -2)}xx`, part.id);
    await expect(
      f.records.read(f.g, f.workspace.id, "reconciliation", f.workspace.id, schema),
    ).rejects.toThrow();
    f.db.sqlite.query("DELETE FROM v2_rework_parts WHERE id=?").run(part.id);
    await expect(
      f.records.read(f.g, f.workspace.id, "reconciliation", f.workspace.id, schema),
    ).rejects.toMatchObject({ code: "SNAPSHOT_INVALID" });
  } finally {
    f.db.sqlite.close();
  }
});
test("publication and caller receipt share one atomic claim and optional workspace bump", async () => {
  const f = await fixture();
  try {
    const saved = await f.records.write(f.g, {
      kind: "context",
      expectedVersion: 0,
      value: { text: "명시적 입장 변경" },
      schema,
      bumpWorkspace: true,
      statements: (claimId) => [
        f.core.statement(
          "INSERT INTO app_metadata(key,value,updated_at) SELECT 'synthetic-rework-receipt','committed',? WHERE EXISTS(SELECT 1 FROM v2_mutation_claims WHERE id=?)",
          [f.now, claimId],
        ),
      ],
    });
    expect(saved?.workspaceRevision).toBe(f.g.expectedRevision + 1);
    expect(
      (await f.records.read(f.g, f.workspace.id, "context", f.workspace.id, schema))
        ?.workspaceRevision,
    ).toBe(saved?.workspaceRevision);
    expect(
      f.db.sqlite
        .query("SELECT value FROM app_metadata WHERE key='synthetic-rework-receipt'")
        .get(),
    ).toEqual({ value: "committed" });
  } finally {
    f.db.sqlite.close();
  }
});
test("a job lease expiring during fragmented storage cannot publish", async () => {
  const f = await fixture();
  try {
    const jobId = crypto.randomUUID();
    expect(
      await f.jobs.admitWorkspace(
        f.g,
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
        jobId,
        "intake_questions",
      ),
    ).toBe(true);
    const actor = { ownerId: f.owner.userId, now: f.now };
    const acquired = await f.jobs.acquire(
      actor,
      jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.now) + 300000).toISOString(),
    );
    expect(acquired).not.toBeNull();
    if (!acquired) throw new Error("Synthetic lease missing");
    let reads = 0;
    const repository = createV2ReworkRepository(f.core, {
      clock: () => (++reads >= 3 ? new Date(Date.parse(f.now) + 300001).toISOString() : f.now),
    });
    expect(
      await repository.write(
        { ...f.g, expectedRevision: f.g.expectedRevision + 1 },
        {
          kind: "task",
          expectedVersion: 0,
          value: { text: "늦은 요약 작업" },
          schema,
          lease: acquired.lease,
        },
      ),
    ).toBeNull();
    expect(await repository.read(actor, f.workspace.id, "task", f.workspace.id, schema)).toBeNull();
  } finally {
    f.db.sqlite.close();
  }
});
