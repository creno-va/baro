import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createFilesModel, type FilesState } from "../apps/mobile/src/features/files/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createPrivateDownloads } from "../apps/mobile/src/platform/files/download";
import { bindPrivateFileLifecycle } from "../apps/mobile/src/platform/files/lifecycle";
import { seedTestSession } from "./helpers/session";
import { uploadRecoveryHttpFixture } from "./helpers/upload-recovery-http";

async function fixture() {
  const f = await uploadRecoveryHttpFixture(),
    disk = new Map<number, Uint8Array>();
  let fileNumber = 0,
    shared = 0,
    releases = 0,
    refreshes = 0,
    backendOwner = f.owner.userId;
  const ready = (): SessionState => ({
    phase: "ready",
    session: {
      user: { id: backendOwner, name: "합성 계정", accountType: "customer" },
      needsConsent: false,
    },
    role: "customer",
    consent: null,
    error: null,
    busy: false,
  });
  let state = ready();
  const listeners = new Set<() => void>();
  const set = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async () => {
      refreshes++;
      set({ ...state, phase: "checking", session: null });
      await Promise.resolve();
      set(ready());
    },
  };
  const cache = createPrivateDownloads({
    initialize() {},
    create() {
      const id = ++fileNumber;
      disk.set(id, new Uint8Array());
      return {
        size: () => disk.get(id)?.byteLength ?? -1,
        async write(bytes) {
          const current = disk.get(id) ?? new Uint8Array(),
            next = new Uint8Array(current.length + bytes.length);
          next.set(current);
          next.set(bytes, current.length);
          disk.set(id, next);
        },
        finish() {},
        open() {
          let offset = 0;
          return {
            get size() {
              return disk.get(id)?.byteLength ?? null;
            },
            get offset() {
              return offset;
            },
            set offset(value) {
              offset = value ?? 0;
            },
            async readBytes(count) {
              const value = disk.get(id)?.slice(offset, offset + count) ?? new Uint8Array();
              offset += value.byteLength;
              return value;
            },
            close() {},
          };
        },
        async text() {
          return new TextDecoder().decode(disk.get(id));
        },
        remove() {
          disk.delete(id);
        },
        async present(_mode, _input, ensure) {
          ensure();
          shared++;
        },
      };
    },
  });
  const stopCache = bindPrivateFileLifecycle(session, () => cache.clear());
  const model = createFilesModel({
    caseId: f.workspace.id,
    session,
    createClient: (signal, ownerId, onAcknowledged) =>
      f.client(
        f.transport,
        true,
        async (response, abort) => (await cache.receive(response, abort, 1_000_000_000)).value,
        { signal, ownerId, onAcknowledged },
      ),
    pick: async () => f.source,
    release: async () => {
      releases++;
    },
    discard: (value) => cache.discard(value),
    present: (value, mode, file, ensure) =>
      cache.present(value, mode, { name: file.name, mimeType: file.mimeType }, ensure),
    clear: () => cache.clear(),
    schedule: () => () => {},
  });
  const stop = model.start();
  const until = (predicate: (value: FilesState) => boolean) =>
    new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("SYNTHETIC_MODEL_DID_NOT_SETTLE"));
      }, 2000);
      const inspect = () => {
        if (predicate(model.getSnapshot())) {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      };
      unsubscribe = model.subscribe(inspect);
      inspect();
    });
  await until((value) => value.gate === "ready" && !value.loading);
  return {
    ...f,
    model,
    cache,
    disk,
    until,
    stats: () => ({ shared, releases, refreshes }),
    switchCookie: (userId: string, cookie: string) => {
      backendOwner = userId;
      f.cookie(cookie);
    },
    stop: async () => {
      stop();
      stopCache();
      await cache.clear();
      f.db.close();
    },
  };
}
test("native files model selects/uploads, downloads exact original bytes, explicitly shares and deletes through actual signed Hono/SQL/AES", async () => {
  const f = await fixture();
  try {
    await f.model.select();
    await f.model.upload();
    const file = f.model.getSnapshot().files[0];
    expect(file).toBeDefined();
    if (!file) throw new Error("SYNTHETIC_FILE_REQUIRED");
    expect(f.model.getSnapshot()).toMatchObject({ source: null, pendingUpload: false, busy: null });
    expect(f.stats().releases).toBe(1);
    await f.model.original(file?.id ?? "missing");
    expect([...f.disk.values()][0]).toEqual(f.bytes);
    expect(f.model.getSnapshot().download?.value.sha256).toBe(
      createHash("sha256").update(f.bytes).digest("hex"),
    );
    expect(f.stats().shared).toBe(0);
    await f.model.present("share");
    expect(f.stats().shared).toBe(1);
    f.model.askDelete(file?.id ?? "missing");
    f.model.confirm("DELETE");
    await f.model.remove();
    expect(f.model.getSnapshot()).toMatchObject({ files: [], download: null, deleteTarget: null });
    expect(f.disk.size).toBe(0);
    expect(
      f.db.sqlite
        .query("SELECT target_kind FROM v2_tombstones WHERE target_kind='file' AND target_id=?")
        .get(file.id),
    ).toEqual({
      target_kind: "file",
    });
  } finally {
    await f.stop();
  }
});
test("an actual cookie owner switch clears private projection/cache and a foreign case does not trigger an automatic refresh loop", async () => {
  const f = await fixture();
  try {
    await f.model.select();
    await f.model.upload();
    const file = f.model.getSnapshot().files[0];
    await f.model.original(file?.id ?? "missing");
    expect(f.disk.size).toBe(1);
    const other = await seedTestSession(f.db, { consent: true });
    f.switchCookie(other.userId, other.cookie);
    await f.model.original(file?.id ?? "missing");
    await f.until(
      (value) =>
        value.gate === "ready" &&
        !value.loading &&
        value.files.length === 0 &&
        Boolean(value.error),
    );
    expect(f.model.getSnapshot().download).toBeNull();
    expect(f.disk.size).toBe(0);
    expect(f.stats().shared).toBe(0);
    expect(f.stats().refreshes).toBeLessThanOrEqual(3);
    expect(
      f.db.sqlite.query("SELECT id FROM v2_files WHERE workspace_id=?").all(f.workspace.id),
    ).toHaveLength(1);
  } finally {
    await f.stop();
  }
});
