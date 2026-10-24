import { expect, test } from "bun:test";
import { createPendingAuthStore } from "../apps/mobile/src/platform/auth/attempt";
import {
  createDeletionAttemptStore,
  type PendingDeletionAttempt,
} from "../apps/mobile/src/platform/auth/deletion-attempt";

const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  other = "8ab4833d-b89b-4555-95f7-33f03ea46d6b";
const input: PendingDeletionAttempt = {
  state: "pending",
  attemptId: id,
  ownerId: "synthetic-a",
  verifier: "a".repeat(43),
  ownerTag: "a".repeat(64),
  provider: "apple",
  createdAt: 0,
};
const outcome = {
  contractVersion: 2 as const,
  status: "accepted" as const,
  ownerTag: input.ownerTag,
  appleRevocation: "unconfirmed" as const,
};
function fixture() {
  const disk = new Map<string, string>([
    ["case_operations", "SYNTHETIC_UNSETTLED"],
    ["auth_cookie", "SYNTHETIC_COOKIE"],
  ]);
  const storage = {
    getItemAsync: async (key: string) => disk.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      disk.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      disk.delete(key);
    },
  };
  return { disk, storage, store: createDeletionAttemptStore({ key: "delete_proof", storage }) };
}

test("a cold start and ordinary login cancellation preserve old deletion uncertainty and unrelated recovery/cookies", async () => {
  const f = fixture();
  await f.store.put(input);
  const normal = createPendingAuthStore({
    key: "auth_attempt",
    now: () => 1000,
    storage: f.storage,
  });
  await normal.put({
    attemptId: id,
    verifier: "b".repeat(43),
    createdAt: 1000,
    accountType: "customer",
    provider: "google",
    purpose: "login",
  });
  await normal.clear(id);
  const cold = createDeletionAttemptStore({ key: "delete_proof", storage: f.storage });
  expect(await cold.list()).toEqual([input]); // createdAt=0 is deliberately never a local expiry/delete instruction.
  expect(f.disk.get("case_operations")).toBe("SYNTHETIC_UNSETTLED");
  expect(f.disk.get("auth_cookie")).toBe("SYNTHETIC_COOKIE");
  await expect(cold.acknowledge(id)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(cold.put({ ...input, attemptId: other })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await cold.list()).toEqual([input]);
});

test("new owner proof can coexist without replacing an unresolved old owner or accepting its result", async () => {
  const f = fixture(),
    second = { ...input, attemptId: other, ownerId: "synthetic-b", ownerTag: "b".repeat(64) };
  await f.store.put(input);
  await f.store.put(second);
  await expect(f.store.accept(other, outcome)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.store.list()).toEqual([input, second]);
  await f.store.accept(id, outcome);
  expect((await f.store.list())[1]).toEqual(second);
});

test("only an accepted receipt removes its verifier; a late cancellation cannot downgrade acceptance or clear another owner's proof", async () => {
  const f = fixture();
  await f.store.put(input);
  const accepted = await f.store.accept(id, outcome);
  expect(accepted).toEqual({
    state: "accepted",
    attemptId: id,
    ownerId: input.ownerId,
    outcome,
    cleanup: "pending",
  });
  expect(f.disk.get("delete_proof")).not.toContain('"verifier"');
  expect(await f.store.cancel(id)).toEqual(accepted);
  await expect(f.store.acknowledge(id)).rejects.toMatchObject({ code: "CONFLICT" });
  await f.store.markCleanup(id, "complete");
  await f.store.markCleanup(id, "failed");
  expect((await f.store.list())[0]).toMatchObject({ state: "accepted", cleanup: "complete" });
  await f.store.acknowledge(id);
  expect(await f.store.list()).toEqual([]);
  expect(f.disk.get("case_operations")).toBe("SYNTHETIC_UNSETTLED");
});

test("a tokenless initial unconfirmed receipt can become confirmed; stale observations cannot erase already observed revocation", async () => {
  const f = fixture();
  await f.store.put(input);
  await f.store.accept(id, outcome);
  await f.store.markCleanup(id, "skipped");
  await f.store.accept(id, { ...outcome, appleRevocation: "confirmed" });
  expect(await f.store.accept(id, outcome)).toMatchObject({
    outcome: { appleRevocation: "confirmed" },
    cleanup: "skipped",
  });
  await expect(
    f.store.accept(id, { ...outcome, appleRevocation: "not_linked" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.store.acknowledge(id);
  expect(await f.store.list()).toEqual([]);
});

test("a confirmed cancellation is final and only explicit acknowledgement removes it", async () => {
  const f = fixture();
  await f.store.put(input);
  expect(await f.store.cancel(id)).toEqual({
    state: "cancelled",
    attemptId: id,
    ownerId: input.ownerId,
  });
  await expect(f.store.accept(id, outcome)).rejects.toMatchObject({ code: "CONFLICT" });
  await f.store.acknowledge(id);
  expect(await f.store.list()).toEqual([]);
});

test("corruption, unsupported version and extra private fields are preserved and surfaced safely rather than discarded", async () => {
  for (const value of [
    "SYNTHETIC_PRIVATE_CORRUPTION",
    JSON.stringify({ version: 3, records: [input] }),
    JSON.stringify({ version: 2, records: [{ ...input, token: "SYNTHETIC_PRIVATE_TOKEN" }] }),
  ]) {
    const f = fixture();
    f.disk.set("delete_proof", value);
    await expect(f.store.list()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(f.store.put(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.disk.get("delete_proof")).toBe(value);
  }
});

test("silent/partial persistence never acknowledges a pending write; serialization retains both owners", async () => {
  const f = fixture(),
    silent = createDeletionAttemptStore({
      key: "delete_proof",
      storage: { ...f.storage, setItemAsync: async () => {} },
    });
  await expect(silent.put(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await Promise.all([
    f.store.put(input),
    f.store.put({ ...input, attemptId: other, ownerId: "synthetic-b" }),
  ]);
  expect((await f.store.list()).map((r) => r.attemptId)).toEqual([id, other]);
  const locked = createDeletionAttemptStore({
    key: "delete_proof",
    storage: {
      ...f.storage,
      setItemAsync: async () => {
        throw new Error("SYNTHETIC_LOCKED");
      },
    },
  });
  await expect(locked.accept(id, outcome)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await f.store.list())[0]).toEqual(input);
});

test("bounded storage capacity never evicts an older unresolved proof", async () => {
  const f = fixture();
  for (let index = 1; index <= 4; index++)
    await f.store.put({
      ...input,
      attemptId: `15a64c18-fd51-4f83-8205-${String(index).padStart(12, "0")}`,
      ownerId: `synthetic-${index}`,
    });
  const before = f.disk.get("delete_proof");
  await expect(f.store.put(input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.disk.get("delete_proof")).toBe(before);
  expect((await f.store.list()).length).toBe(4);
});
