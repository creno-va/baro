import { expect, test } from "bun:test";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";

const key = `baro-cases-request:cases.create:owner_a:${"a".repeat(64)}`,
  value = "5e889dcb-14bf-46ab-bc0a-e1d06ec2c608";
const fingerprint = async (input: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))).toString(
    "hex",
  );

test("native upload recovery admits only strict opaque revision/receipt metadata and rejects tokens or source contents", async () => {
  const f = fixture(),
    key = `baro-upload-operation:${"d".repeat(64)}`;
  const record = {
    version: 1,
    reservationKey: value,
    expectedRevision: 1,
    fileId: "opaque_file",
    complete: { key: value, expectedRevision: 2, requestHash: "a".repeat(64) },
  };
  await f.storage.setItem(key, JSON.stringify(record));
  expect(JSON.parse((await f.storage.getItem(key)) ?? "{}")).toEqual(record);
  for (const extra of [
    { uploadSession: "SYNTHETIC_PRIVATE" },
    { name: "합성 파일 이름" },
    { manifest: {} },
    { facts: "합성 원문" },
  ])
    await expect(
      f.storage.setItem(key, JSON.stringify({ ...record, ...extra })),
    ).rejects.toBeDefined();
  await expect(
    f.storage.setItem(key, JSON.stringify({ ...record, fileId: undefined })),
  ).rejects.toBeDefined();
  expect([...f.records.values()].join("").includes("SYNTHETIC_PRIVATE")).toBe(false);
});
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

test("native workspace recovery stores only UUID request keys and opaque job IDs", async () => {
  const f = fixture(),
    request = `baro-workspace-request:${"b".repeat(64)}`,
    job = "baro-workspace-job:case_a";
  await f.storage.setItem(request, value);
  await f.storage.setItem(job, "job_a");
  expect(await f.storage.getItem(job)).toBe("job_a");
  await expect(
    f.storage.setItem(request, JSON.stringify({ text: "비공개 입력" })),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(f.storage.setItem(job, "비공개 입력")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.records.size).toBe(2);
});

test("native report recovery admits only UUID request receipts under hashed identities", async () => {
  const f = fixture(),
    request = `baro-reports-request:${"c".repeat(64)}`;
  await f.storage.setItem(request, value);
  expect(await f.storage.getItem(request)).toBe(value);
  for (const unsafe of [
    "SYNTHETIC_PRIVATE_CONTENT",
    JSON.stringify({ content: "합성 검토 본문" }),
    "file:///private/cache/report.pdf",
  ])
    await expect(f.storage.setItem(request, unsafe)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect([...f.records.values()]).toEqual([value]);
});
