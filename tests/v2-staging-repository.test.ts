import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core, fragmentText, readSnapshot, utf8Bytes } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const now = "2026-10-06T00:00:00.000Z";
  const owner = await seedTestSession(db, { now: Date.parse(now), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
  });
  let maxQueries = 0;
  let maxParameters = 0;
  const binding = {
    prepare(sql: string) {
      const prepared = db.binding.prepare(sql);
      return {
        ...prepared,
        bind(...values: unknown[]) {
          maxParameters = Math.max(maxParameters, values.length);
          return prepared.bind(...values);
        },
      };
    },
    batch(statements: D1PreparedStatement[]) {
      maxQueries = Math.max(maxQueries, statements.length);
      return db.binding.batch(statements);
    },
  } as D1Database;
  const actor = { ownerId: owner.userId, now };
  const workspaces = createV2WorkspaceRepository(binding, cipher);
  const id = crypto.randomUUID();
  await workspaces.create(
    actor,
    id,
    {
      narrative: "합성 사건의 완전한 유니코드 저장 및 경합 검증입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    },
    { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
  );
  const core = createV2Core(binding, cipher);
  return {
    db,
    cipher,
    core,
    actor,
    workspaces,
    staging: createV2StagingRepository(core),
    g: { ...actor, workspaceId: id, expectedRevision: 1 },
    bounds: () => ({ maxQueries, maxParameters }),
  };
}
test("bounded encrypted staging survives an interrupted writer, verifies replay and publishes only complete ordered data", async () => {
  const f = await fixture();
  const id = crypto.randomUUID();
  const payload = {
    text: "🙂가".repeat(40000),
    items: Array.from({ length: 300 }, (_, i) => ({ id: `fact-${i}`, text: "내용" })),
  };
  const text = JSON.stringify(payload);
  const fragments = fragmentText(text);
  expect(fragments.every((p) => utf8Bytes(p) <= 65536)).toBe(true);
  expect(fragments.join("")).toBe(text);
  const input = {
    id,
    purpose: "summary" as const,
    targetId: f.g.workspaceId,
    revision: 1,
    partCount: fragments.length,
    byteLength: utf8Bytes(text),
  };
  expect(await f.staging.begin(f.g, input)).toBe(true);
  expect(await f.staging.append(f.g, id, 1, fragments[1] ?? "")).toBe(false);
  expect(await f.staging.append(f.g, id, 0, fragments[0] ?? "")).toBe(true);
  expect(await f.staging.begin(f.g, input)).toBe(true);
  expect(await f.staging.append(f.g, id, 0, fragments[0] ?? "")).toBe(true);
  expect(await f.staging.append(f.g, id, 0, "different")).toBe(false);
  expect(await f.staging.assembleSmall(f.actor, id, z.unknown())).toBeNull();
  expect(
    await f.staging.seal(f.g, id, {
      schemaVersion: "2",
      purpose: "summary",
      targetId: f.g.workspaceId,
      revision: 1,
    }),
  ).toBe(false);
  for (let i = 1; i < fragments.length; i++)
    expect(await f.staging.append(f.g, id, i, fragments[i] ?? "")).toBe(true);
  expect(
    await f.staging.seal(f.g, id, {
      schemaVersion: "2",
      purpose: "summary",
      targetId: f.g.workspaceId,
      revision: 1,
    }),
  ).toBe(true);
  expect(await f.staging.publish(f.g, id)).toBe(true);
  expect(await f.staging.assembleSmall(f.actor, id, z.unknown())).toEqual(payload);
  expect(
    await readSnapshot(f.core, f.actor, id, "summary", f.g.workspaceId, 1, z.unknown()),
  ).toEqual(payload);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(f.bounds().maxQueries).toBeLessThanOrEqual(40);
  expect(f.bounds().maxParameters).toBeLessThanOrEqual(100);
  const rows = f.db.sqlite.query("SELECT encrypted_payload FROM v2_private_parts").all();
  expect(JSON.stringify(rows)).not.toContain("내용");
  expect(JSON.stringify(rows)).not.toContain("🙂");
});
test("revision, owner and deletion guards reject replay and stop plaintext delivery after asynchronous decryption", async () => {
  const f = await fixture();
  const id = crypto.randomUUID();
  const input = {
    id,
    purpose: "summary" as const,
    targetId: f.g.workspaceId,
    revision: 1,
    partCount: 2,
    byteLength: 4,
  };
  expect(await f.staging.begin(f.g, input)).toBe(true);
  expect(await f.staging.append(f.g, id, 0, '"a')).toBe(true);
  expect(await f.staging.begin({ ...f.g, ownerId: "foreign" }, input)).toBe(false);
  expect(await f.staging.append({ ...f.g, ownerId: "foreign" }, id, 0, '"a')).toBe(false);
  expect(await f.workspaces.changeState(f.g, "archive")).toBe(true);
  expect(await f.staging.begin(f.g, input)).toBe(false);
  expect(await f.staging.append(f.g, id, 0, '"a')).toBe(false);
  expect(await f.staging.append({ ...f.g, expectedRevision: 2 }, id, 1, 'b"')).toBe(false);
  expect(await createV2DeletionRepository(f.core).workspace({ ...f.g, expectedRevision: 2 })).toBe(
    true,
  );
  expect(f.db.sqlite.query("SELECT * FROM v2_private_parts").all()).toEqual([]);
  expect(await f.staging.begin({ ...f.g, expectedRevision: 2 }, input)).toBe(false);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("maximum 100MiB Unicode snapshot streams in bounded steps without full rehydration or dropped parts", async () => {
  const f = await fixture();
  const id = crypto.randomUUID();
  const middle = "🙂".repeat(16384);
  const first = `"${"🙂".repeat(16383)}aaa`;
  const last = `${"🙂".repeat(16383)}aaa"`;
  const parts = 1600;
  const bytes = 104857600;
  expect(utf8Bytes(first)).toBe(65536);
  expect(utf8Bytes(last)).toBe(65536);
  expect(
    await f.staging.begin(f.g, {
      id,
      purpose: "summary",
      targetId: f.g.workspaceId,
      revision: 1,
      partCount: parts,
      byteLength: bytes,
    }),
  ).toBe(true);
  for (let i = 0; i < parts; i++)
    expect(
      await f.staging.append(f.g, id, i, i === 0 ? first : i === parts - 1 ? last : middle),
    ).toBe(true);
  expect(
    await f.staging.seal(f.g, id, {
      schemaVersion: "2",
      purpose: "summary",
      targetId: f.g.workspaceId,
      revision: 1,
    }),
  ).toBe(true);
  expect(await f.staging.publish(f.g, id)).toBe(true);
  await expect(f.staging.assembleSmall(f.actor, id, z.unknown())).rejects.toThrow(
    "SNAPSHOT_STREAM_REQUIRED",
  );
  let observed = 0;
  let count = 0;
  let complete = false;
  for await (const part of f.staging.fragments(f.actor, id)) {
    expect(part.index).toBe(count);
    expect(part.text).toBe(count === 0 ? first : count === parts - 1 ? last : middle);
    observed += utf8Bytes(part.text);
    count++;
    complete = part.complete;
  }
  expect(count).toBe(parts);
  expect(observed).toBe(bytes);
  expect(complete).toBe(true);
  expect(f.bounds().maxQueries).toBeLessThanOrEqual(40);
  expect(f.bounds().maxParameters).toBeLessThanOrEqual(100);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
}, 120000);
test("fragmentation rejects malformed Unicode instead of replacing source data", () => {
  expect(() => fragmentText("\ud800")).toThrow("SNAPSHOT_INVALID");
  expect(() => fragmentText("🙂", 3)).toThrow("REPOSITORY_INPUT_INVALID");
  expect(fragmentText("가🙂", 4)).toEqual(["가", "🙂"]);
});
