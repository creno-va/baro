import { expect, test } from "bun:test";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";

const key = `baro-cases-request:cases.create:owner_a:${"a".repeat(64)}`,
  value = "5e889dcb-14bf-46ab-bc0a-e1d06ec2c608";
const fingerprint = async (input: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))).toString(
    "hex",
  );
function fixture() {
  const records = new Map<string, string>();
  let mode = "",
    pause: Promise<void> | undefined;
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (key) => {
        if (mode === "locked") throw new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC");
        return records.get(key) ?? null;
      },
      set: async (key, value) => {
        await pause;
        if (mode !== "silent") records.set(key, value);
      },
      remove: async (key) => {
        if (mode !== "retain") records.delete(key);
      },
    },
  });
  return {
    storage,
    records,
    mode: (value: string) => {
      mode = value;
    },
    pause: (value: Promise<void>) => {
      pause = value;
    },
  };
}
test("operation storage accepts only opaque keys and wire revision metadata, with hashed physical keys", async () => {
  const f = fixture();
  await f.storage.setItem(key, value);
  expect(await f.storage.getItem(key)).toBe(value);
  expect([...f.records.keys()][0]).toMatch(/^baro_preview_case_operations\.[a-f0-9]{64}$/);
  const wire = `baro-cases-wire:${value}`;
  await f.storage.setItem(
    wire,
    JSON.stringify({ owner: "owner_a", revision: 1, summaryRevision: 2 }),
  );
  await expect(
    f.storage.setItem(
      wire,
      JSON.stringify({ owner: "owner_a", revision: 1, narrative: "SYNTHETIC_PRIVATE_FACTS" }),
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(f.storage.setItem(key, "SYNTHETIC_PRIVATE_FACTS")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(f.storage.getItem("arbitrary-key")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await f.storage.removeItem(key);
  expect(await f.storage.getItem(key)).toBeNull();
  expect(f.records.size).toBe(1);
});
test("locked, silently lost and corrupt storage fail safely; failed removal retains the uncertain key", async () => {
  const f = fixture();
  f.mode("locked");
  await expect(f.storage.getItem(key)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.mode("silent");
  await expect(f.storage.setItem(key, value)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.mode("");
  await f.storage.setItem(key, value);
  f.mode("retain");
  await expect(f.storage.removeItem(key)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(await f.storage.getItem(key)).toBe(value);
  f.records.set([...f.records.keys()][0] ?? "", "corrupt");
  await expect(f.storage.getItem(key)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
test("new operations cannot overtake a pending storage write and a fresh adapter recovers its key", async () => {
  const f = fixture();
  let release!: () => void;
  f.pause(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const write = f.storage.setItem(key, value),
    read = f.storage.getItem(key);
  release();
  await write;
  expect(await read).toBe(value);
  const fresh = createCaseOperationStorage({
    namespace: "baro_preview_case_operations",
    fingerprint,
    storage: {
      get: async (name) => f.records.get(name) ?? null,
      set: async () => {},
      remove: async () => {},
    },
  });
  expect(await fresh.getItem(key)).toBe(value);
});
