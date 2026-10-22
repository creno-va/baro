import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createFileMetadataReader,
  createReportsClient,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import {
  createReportsModel,
  reportDownloadAllowed,
} from "../apps/mobile/src/features/reports/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createPrivateDownloads } from "../apps/mobile/src/platform/files/download";
import { bindPrivateFileLifecycle } from "../apps/mobile/src/platform/files/lifecycle";
import { checkReportResponse, createReportHttp } from "../apps/mobile/src/platform/reports/http";
import { reportHttpFixture } from "./helpers/report-http-fixture";

async function fixture() {
  const f = await reportHttpFixture(),
    scope = createSessionScope(),
    records = new Map<string, string>(),
    disk = new Map<number, Uint8Array>();
  let serial = 0,
    shared = 0,
    previewed = 0;
  const cache = createPrivateDownloads({
    initialize() {},
    create() {
      const id = ++serial;
      disk.set(id, new Uint8Array());
      return {
        size: () => disk.get(id)?.length ?? -1,
        async write(bytes) {
          const old = disk.get(id) ?? new Uint8Array(),
            next = new Uint8Array(old.length + bytes.length);
          next.set(old);
          next.set(bytes, old.length);
          disk.set(id, next);
        },
        finish() {},
        open() {
          let offset = 0;
          return {
            get size() {
              return disk.get(id)?.length ?? null;
            },
            get offset() {
              return offset;
            },
            set offset(value) {
              offset = value ?? 0;
            },
            async readBytes(count) {
              const bytes = disk.get(id)?.slice(offset, offset + count) ?? new Uint8Array();
              offset += bytes.length;
              return bytes;
            },
            close() {},
          };
        },
        text: async () => new TextDecoder().decode(disk.get(id)),
        remove() {
          disk.delete(id);
        },
        async present(mode, _input, ensure) {
          ensure();
          if (mode === "share") shared++;
          else previewed++;
        },
      };
    },
  });
  let state: SessionState = {
    phase: "ready",
    session: {
      user: { id: f.actor.ownerId, name: "합성", accountType: "customer" },
      needsConsent: false,
    },
    role: "customer",
    consent: null,
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const session = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      const previous = state;
      set({ ...state, phase: "checking", session: null });
      await Promise.resolve();
      set(previous);
    },
  };
  const stopCache = bindPrivateFileLifecycle(session, () => cache.clear());
  const model = createReportsModel({
    caseId: f.workspaceId,
    session,
    createClient: (signal, ownerId) => {
      const transport: WorkspaceTransport = async (path, init = {}) => {
        signal.throwIfAborted();
        const headers = new Headers(init.headers);
        headers.set("cookie", f.cookie);
        headers.set("origin", f.env.BETTER_AUTH_URL);
        headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(ownerId));
        const response = await f.app.request(path, { ...init, headers }, f.env);
        signal.throwIfAborted();
        return response;
      };
      const reports = createReportsClient({
        scope,
        signal,
        request: createReportHttp(transport),
        newKey: () => crypto.randomUUID(),
        recovery: {
          ownerId,
          fingerprint: async (value) => createHash("sha256").update(value).digest("hex"),
          storage: {
            getItem: (key) => records.get(key) ?? null,
            setItem: (key, value) => {
              records.set(key, value);
            },
            removeItem: (key) => {
              records.delete(key);
            },
          },
        },
        download: async (path, options) => {
          const response = await transport(path, {
            method: options.method ?? "GET",
            headers: { ...options.headers, "content-type": "application/json" },
            signal: options.signal,
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          });
          await checkReportResponse(response);
          return cache.receive(response, signal, 4_000_000_000);
        },
      });
      return {
        reports,
        listFiles: createFileMetadataReader(transport),
        original: async () => {
          throw new Error("NO_PHOTO_IN_DOCUMENT_FIXTURE");
        },
      };
    },
    discard: (value) => cache.discard(value),
    present: (value, mode, input, ensure) => cache.present(value, mode, input, ensure),
    clear: () => cache.clear(),
  });
  const stop = model.start();
  const settle = async () => {
    const deadline = Date.now() + 10000;
    while (model.getSnapshot().busy && Date.now() < deadline) await Bun.sleep(1);
    expect(model.getSnapshot().busy).toBeNull();
  };
  await settle();
  return {
    ...f,
    model,
    disk,
    set,
    state: () => state,
    settle,
    shared: () => shared,
    previewed: () => previewed,
    async close() {
      stop();
      stopCache();
      await cache.clear();
    },
  };
}
test("native report model reaches signed SQL save, masked HTML, PDF and raw selected/saved ZIP through verified private cache", async () => {
  const f = await fixture();
  try {
    expect(f.model.getSnapshot().report?.revision).toBe(1);
    f.model.change({ content: "합성 검토 전화 010-1234-5678", maskIdentifiers: true });
    await f.model.save();
    expect(f.model.getSnapshot().report?.revision).toBe(2);
    f.model.reviewed(true);
    await f.model.download("html");
    expect(f.model.getSnapshot().error).toBeNull();
    const html = [...f.disk.values()][0] as Uint8Array;
    expect(new TextDecoder().decode(html)).toContain('data-baro-report="1"');
    expect(new TextDecoder().decode(html)).not.toContain("010-1234-5678");
    expect(f.model.getSnapshot().download?.value.sha256).toBe(
      createHash("sha256").update(html).digest("hex"),
    );
    await f.model.present("share");
    expect(f.shared()).toBe(1);
    await f.model.download("pdf");
    expect(f.model.getSnapshot().error).toBeNull();
    const pdf = [...f.disk.values()][0] as Uint8Array;
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    await f.model.present("open");
    expect(f.previewed()).toBe(1);
    f.model.originalSelection(f.selectedFileId);
    f.model.acknowledgeOriginals(true);
    await f.model.download("zip");
    expect(f.model.getSnapshot().error).toBeNull();
    const zip = [...f.disk.values()][0] as Uint8Array;
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    expect(new TextDecoder().decode(zip)).toContain(f.original);
    await f.model.refresh();
    expect(f.model.getSnapshot().report?.savedZip?.fileCount).toBe(1);
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    f.set({
      ...f.state(),
      phase: "consent",
      session: {
        user: { id: f.actor.ownerId, name: "합성", accountType: "customer" },
        needsConsent: true,
      },
    });
    await f.settle();
    f.model.reviewed(true);
    expect(reportDownloadAllowed(f.model.getSnapshot(), "savedZip")).toBe(true);
    expect(reportDownloadAllowed(f.model.getSnapshot(), "pdf")).toBe(true);
    expect(reportDownloadAllowed(f.model.getSnapshot(), "zip")).toBe(false);
    await f.model.download("savedZip");
    expect(f.model.getSnapshot().error).toBeNull();
  } finally {
    await f.close();
  }
  expect(f.disk.size).toBe(0);
});
test("native report stale revision preserves local edits and cannot replace a peer's real saved report", async () => {
  const f = await fixture();
  try {
    const displayed = f.model.getSnapshot().report;
    if (!displayed) throw new Error("MISSING_SYNTHETIC_REPORT");
    f.model.change({ content: "합성 기기 편집" });
    const peer = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: displayed.revision,
      content: "합성 다른 화면의 저장",
      maskIdentifiers: false,
      excludedFileIds: [],
    });
    await f.model.save();
    expect(f.model.getSnapshot().conflict).toBe(true);
    expect(f.model.getSnapshot().draft?.content).toBe("합성 기기 편집");
    expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).id).toBe(peer.id);
    await f.model.refresh();
    expect(f.model.getSnapshot().confirm).toBe("reload");
    await f.model.confirmReload();
    expect(f.model.getSnapshot().report?.id).toBe(peer.id);
    f.set({ ...f.state(), phase: "anonymous", session: null });
    expect(f.model.getSnapshot().draft).toBeNull();
    expect(f.model.getSnapshot().files).toEqual([]);
  } finally {
    await f.close();
  }
});
