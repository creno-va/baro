import { afterEach, expect, test } from "bun:test";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
async function fixture() {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  const items = [f.workspace];
  for (let index = 1; index < 5; index++)
    items.push(
      await createWorkspaceService(f.core, {
        clock: () => new Date(Date.parse(f.now) + index * 86400000).toISOString(),
      }).create(f.owner.userId, crypto.randomUUID(), {
        narrative: `합성 사건 ${index}의 날짜와 연락 내역을 확인하여 상담 자료를 정리합니다.`,
        subjectContext: "individual",
        jurisdiction: "KR",
        turnstileToken: "synthetic",
      }),
    );
  return { ...f, items };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("preview reads overlap at most four cases and preserve order despite reversed completion", async () => {
  const f = await fixture();
  const firstPageStarted = Promise.withResolvers<void>();
  const gates = new Map(f.items.map((item) => [item.id, Promise.withResolvers<void>()]));
  const finished = new Map(f.items.map((item) => [item.id, Promise.withResolvers<void>()]));
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  const started: string[] = [];
  const completed: string[] = [];
  let active = 0;
  let maximum = 0;
  f.core.cipher.decrypt = async (envelope, context) => {
    if (context.table !== "v2_intakes") return decrypt(envelope, context);
    started.push(context.rowId);
    maximum = Math.max(maximum, ++active);
    if (started.length === 4) firstPageStarted.resolve();
    await gates.get(context.rowId)?.promise;
    const value = await decrypt(envelope, context);
    completed.push(context.rowId);
    active--;
    finished.get(context.rowId)?.resolve();
    return value;
  };
  const pending = f.service.previews(f.owner.userId, f.items);
  await firstPageStarted.promise;
  expect(started).toEqual(f.items.slice(0, 4).map((item) => item.id));
  for (const item of f.items.slice(0, 4).reverse()) {
    gates.get(item.id)?.resolve();
    await finished.get(item.id)?.promise;
  }
  for (const gate of gates.values()) gate.resolve();
  const result = await pending;
  expect(maximum).toBe(4);
  expect(completed.slice(0, 4)).toEqual(
    f.items
      .slice(0, 4)
      .reverse()
      .map((item) => item.id),
  );
  expect(result.map((item) => item.id)).toEqual(f.items.map((item) => item.id));
  expect(result.every((item) => item.title.length > 0 && !item.hasSummary)).toBe(true);
});

test("parallel previews still exclude foreign cases and cases deleted during decryption", async () => {
  const f = await fixture();
  const foreign = await seedTestSession(f.db, { consent: true });
  const foreignCase = await f.service.create(foreign.userId, crypto.randomUUID(), {
    narrative: "다른 소유자의 합성 사건 내용은 미리보기에 노출되지 않아야 합니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
  const deleted = f.items[1];
  if (!deleted) throw new Error("Missing synthetic case");
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  f.core.cipher.decrypt = async (envelope, context) => {
    if (context.table === "v2_intakes" && context.rowId === deleted.id)
      f.db.sqlite
        .query(
          "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
        )
        .run(deleted.id, f.now);
    return decrypt(envelope, context);
  };
  const result = await f.service.previews(f.owner.userId, [...f.items, foreignCase]);
  expect(result.map((item) => item.id)).toEqual(
    f.items.filter((item) => item.id !== deleted.id).map((item) => item.id),
  );
});

test("a failed preview rejects the response instead of returning an incomplete successful list", async () => {
  const f = await fixture();
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let calls = 0;
  f.core.cipher.decrypt = async (envelope, context) => {
    if (context.table === "v2_intakes") {
      calls++;
      if (context.rowId === f.items[1]?.id) throw new Error("Synthetic decryption failure");
    }
    return decrypt(envelope, context);
  };
  await expect(f.service.previews(f.owner.userId, f.items)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(calls).toBe(4);
});
