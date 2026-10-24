import { expect, test } from "bun:test";
import { createSessionScope } from "@baro/client-core";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createNativeDeletionCleanup } from "../apps/mobile/src/platform/account/deletion-cleanup";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import type { DeletionAttemptRecord } from "../apps/mobile/src/platform/auth/deletion-attempt";

const id = "15a64c18-fd51-4f83-8205-4c917a245e6b";
const receipt: Extract<DeletionAttemptRecord, { state: "accepted" }> = {
  state: "accepted",
  attemptId: id,
  ownerId: "a",
  outcome: {
    contractVersion: 2,
    status: "accepted",
    ownerTag: "a".repeat(64),
    appleRevocation: "unconfirmed",
  },
  cleanup: "pending",
};
const session = (owner: string): Pick<SessionState, "phase" | "session"> => ({
  phase: "ready",
  session: { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const disk = new Map<string, string>([["operations", "SYNTHETIC_UNSETTLED"]]),
    scope = createSessionScope();
  let writes = 0,
    reads = 0,
    files = 0,
    cancels = 0,
    locked = false,
    failFiles = false;
  let state = session("a"),
    barrier: Promise<void> | undefined;
  const credentials = createNativeCredentials({
    scope,
    namespace: "auth",
    storage: {
      getItemAsync: async (key) => {
        reads++;
        return disk.get(key) ?? null;
      },
      setItemAsync: async (key, value) => {
        writes++;
        if (locked) throw new Error("SYNTHETIC_LOCKED");
        disk.set(key, value);
      },
    },
    manageStorage: (storage) => storage,
    codec: {
      header: (raw) => (raw ? ((JSON.parse(raw) as { cookie?: string }).cookie ?? "") : ""),
      merge: (cookie) => JSON.stringify({ cookie }),
    },
  });
  await credentials.capture().accept("SYNTHETIC_A");
  const create = () =>
    createNativeDeletionCleanup({
      scope,
      credentials,
      session: () => state,
      resetPrivateFiles: async () => {
        files++;
        await barrier;
        if (failFiles) throw new Error("SYNTHETIC_FILES_FAILED");
      },
      cancelLogin: () => {
        cancels++;
        return credentials.reset();
      },
    });
  return {
    disk,
    scope,
    credentials,
    create,
    stats: () => ({ writes, reads, files, cancels }),
    state: (value: typeof state) => {
      state = value;
    },
    lock: (value: boolean) => {
      locked = value;
    },
    failFiles: (value: boolean) => {
      failFiles = value;
    },
    delayFiles() {
      const gate = deferred();
      barrier = gate.promise;
      return gate;
    },
  };
}

test("background scope changes do not replace the cookie writer; a warm accepted deletion clears only its own credentials", async () => {
  const f = await fixture(),
    cleanup = f.create(),
    revision = f.credentials.revision();
  cleanup.bind(id, "a");
  f.scope.invalidate();
  f.state({ phase: "checking", session: null });
  expect(f.credentials.isRevisionCurrent(revision)).toBe(true);
  expect(await cleanup.cleanup(receipt)).toBe("complete");
  expect(await f.credentials.capture().cookie()).toBe("");
  expect(f.stats()).toMatchObject({ files: 1, cancels: 1 });
  expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
});

test("a known new owner skips old cleanup without even reading the replacement cookie or touching files", async () => {
  const f = await fixture(),
    cleanup = f.create();
  cleanup.bind(id, "a");
  await f.credentials.reset();
  await f.credentials.capture().accept("SYNTHETIC_B");
  f.state(session("b"));
  const before = f.stats(),
    disk = [...f.disk];
  expect(await cleanup.cleanup(receipt)).toBe("skipped");
  expect(f.stats()).toEqual(before);
  expect([...f.disk]).toEqual(disk);
});

test("a new login during async file cleanup cannot be reset or rebound by the old deletion", async () => {
  const f = await fixture(),
    cleanup = f.create();
  cleanup.bind(id, "a");
  const gate = f.delayFiles(),
    pending = cleanup.cleanup(receipt);
  await Promise.resolve();
  f.scope.invalidate();
  await f.credentials.reset();
  await f.credentials.capture().accept("SYNTHETIC_B");
  f.state({ phase: "checking", session: null });
  const before = f.stats();
  gate.resolve();
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(cleanup.cleanup(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats()).toEqual(before);
  expect(f.stats().cancels).toBe(0);
  expect(await f.credentials.capture().cookie()).toBe("SYNTHETIC_B");
  f.state(session("b"));
  expect(await cleanup.cleanup(receipt)).toBe("skipped");
});

test("own failed reset can recover after unlock without assuming that a replacement reset was ours", async () => {
  const f = await fixture(),
    cleanup = f.create();
  cleanup.bind(id, "a");
  f.lock(true);
  await expect(cleanup.cleanup(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.lock(false);
  expect(await cleanup.cleanup(receipt)).toBe("complete");
  expect(await f.credentials.capture().cookie()).toBe("");
  expect(f.stats().cancels).toBe(2);
});

test("file cleanup failure after own successful reset remains retryable and never erases operation recovery", async () => {
  const f = await fixture(),
    cleanup = f.create();
  cleanup.bind(id, "a");
  f.failFiles(true);
  await expect(cleanup.cleanup(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.failFiles(false);
  expect(await cleanup.cleanup(receipt)).toBe("complete");
  expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
  expect(f.stats().cancels).toBe(2);
});

test("cold/unknown ownership and changed same-owner cookies cannot authorize cleanup", async () => {
  const f = await fixture(),
    cold = f.create(),
    before = f.stats();
  await expect(cold.cleanup(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats()).toEqual(before);
  const warm = f.create();
  warm.bind(id, "a");
  const revision = f.credentials.revision();
  await f.credentials.capture().accept(null);
  expect(f.credentials.revision()).toBe(revision);
  await f.credentials.capture().accept("SYNTHETIC_NEW_A_SESSION");
  const changed = f.stats();
  await expect(warm.cleanup(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats()).toEqual(changed);
  expect(await f.credentials.capture().cookie()).toBe("SYNTHETIC_NEW_A_SESSION");
});

test("explicit cold cleanup requires a verified anonymous session and clears only while that state remains current", async () => {
  const f = await fixture(),
    cold = f.create(),
    before = f.stats();
  await expect(cold.clearAnonymous(receipt)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats()).toEqual(before);
  f.state({ phase: "anonymous", session: { user: null, needsConsent: false } });
  await cold.clearAnonymous(receipt);
  expect(await f.credentials.capture().cookie()).toBe("");
  expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
});

test("a new login overtaking explicit anonymous cleanup is preserved without reading its jar", async () => {
  const f = await fixture(),
    cold = f.create();
  f.state({ phase: "anonymous", session: { user: null, needsConsent: false } });
  const gate = f.delayFiles(),
    pending = cold.clearAnonymous(receipt);
  await Promise.resolve();
  f.state({ phase: "authorizing", session: null });
  await f.credentials.reset();
  await f.credentials.capture().accept("SYNTHETIC_B");
  const before = f.stats();
  gate.resolve();
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats()).toEqual(before);
  expect(f.stats().cancels).toBe(0);
  expect(await f.credentials.capture().cookie()).toBe("SYNTHETIC_B");
});
