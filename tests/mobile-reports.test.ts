import { expect, test } from "bun:test";
import { ApiError, type ReportSave } from "@baro/api-client";
import type { FileView, ReportView } from "@baro/client-core";
import {
  createReportsModel,
  type ReportsPorts,
  reportDirty,
  reportDownloadAllowed,
} from "../apps/mobile/src/features/reports/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createReportHttp, ReportFailure } from "../apps/mobile/src/platform/reports/http";

const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const ready = (owner = "a", needsConsent = false): SessionState => ({
  phase: needsConsent ? "consent" : "ready",
  session: { user: { id: owner, name: "합성 계정", accountType: "customer" }, needsConsent },
  role: "customer",
  consent: null,
  busy: false,
  error: null,
});
function fixture() {
  let state = ready(),
    backend = state,
    refreshes = 0,
    clears = 0;
  const listeners = new Set<() => void>(),
    discarded: unknown[] = [],
    calls: { kind: string; input?: unknown; revision?: number | null | undefined }[] = [];
  const reports = new Map<string, ReportView>(
    ["a", "b"].map((id) => [
      id,
      {
        id: `report_${id}`,
        caseId: "case_a",
        revision: 1,
        title: `합성 ${id}`,
        content: `비공개 ${id} 본문`,
        maskIdentifiers: false,
        excludedFileIds: [],
        includedPhotoIds: [],
        photoCandidates: [{ id: `file_${id}`, name: `사진 ${id}`, revision: 2 }],
        stale: false,
        pdfAvailable: false,
        updatedAt: "2026-10-23T00:00:00.000Z",
      },
    ]),
  );
  const files = (owner: string): FileView[] => [
    {
      id: `file_${owner}`,
      name: `사진 ${owner}`,
      mimeType: "image/png",
      sizeBytes: 3,
      status: "ready",
      coverage: "합성 범위",
      extractedText: "",
    },
  ];
  let failure = "",
    downloads = 0;
  const value = (mimeType = "application/pdf") =>
    Object.freeze({ size: 3, mimeType, sha256: (++downloads).toString().padStart(64, "0") });
  let download = async (kind: string) =>
    value(kind === "html" ? "text/html" : kind === "pdf" ? "application/pdf" : "application/zip");
  let present = async (_check: () => void) => {};
  const set = (next: SessionState, fresh = true) => {
    state = next;
    if (fresh) backend = next;
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
      refreshes++;
      set({ ...state, phase: "checking", session: null }, false);
      await Promise.resolve();
      set(backend, false);
    },
  };
  const model = createReportsModel({
    caseId: "case_a",
    session,
    createClient: (_signal, owner): ReportsPorts => ({
      reports: {
        async get() {
          calls.push({ kind: `get:${owner}` });
          if (failure === "initial") throw new ReportFailure("EXPORT_LIMIT_EXCEEDED");
          if (failure === "missing") throw new ApiError("NOT_FOUND", "합성 없음");
          return structuredClone(reports.get(owner) as ReportView);
        },
        async save(_id, input, revision) {
          calls.push({ kind: "save", input: structuredClone(input), revision });
          if (failure === "conflict") throw new ReportFailure("STALE_REVISION");
          if (failure === "unknown") throw new ApiError("UNAVAILABLE", "합성 응답 유실");
          const current = reports.get(owner) as ReportView;
          const next = {
            ...current,
            ...input,
            includedPhotoIds: input.includedPhotoIds ?? [],
            revision: current.revision + 1,
            content:
              JSON.stringify(input.excludedFileIds) === JSON.stringify(current.excludedFileIds)
                ? input.content
                : "출처에서 다시 구성한 본문",
          };
          reports.set(owner, next);
          return structuredClone(next);
        },
        async generate(_id, excluded, revision) {
          calls.push({ kind: "generate", input: excluded, revision });
          const next = {
            ...(reports.get(owner) as ReportView),
            content: "새 초안",
            excludedFileIds: excluded ?? [],
            maskIdentifiers: false,
            includedPhotoIds: [],
            revision: revision === null ? 1 : (revision ?? 0) + 1,
          };
          reports.set(owner, next);
          failure = "";
          return next;
        },
        pdf: async () => download("pdf"),
        html: async () => download("html"),
        savedZip: async () => download("savedZip"),
        zip: async (_id, selected) => {
          calls.push({ kind: "zip", input: selected });
          return download("zip");
        },
      },
      listFiles: async () => files(owner),
      original: async () => value("image/png"),
    }),
    discard: async (handle) => {
      discarded.push(handle);
    },
    present: async (_value, _mode, _input, check) => {
      await present(check);
      check();
    },
    clear: async () => {
      clears++;
    },
  });
  return {
    model,
    reports,
    calls,
    discarded,
    set,
    session,
    value,
    failure: (mode: string) => {
      failure = mode;
    },
    refreshes: () => refreshes,
    clears: () => clears,
    download: (fn: typeof download) => {
      download = fn;
    },
    present: (fn: typeof present) => {
      present = fn;
    },
  };
}
test("native reports hide private draft on checking/owner changes and keep consent read-only stored exports", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  f.model.change({ content: "미저장 비공개 편집" });
  expect(reportDirty(f.model.getSnapshot())).toBe(true);
  f.set({ ...ready(), phase: "checking", session: null });
  expect(f.model.getSnapshot().report).toBeNull();
  expect(f.model.getSnapshot().draft).toBeNull();
  f.set(ready("b", true));
  await tick();
  expect(f.model.getSnapshot().draft?.content).toBe("비공개 b 본문");
  f.model.change({ content: "수정하면 안 됨" });
  expect(f.model.getSnapshot().draft?.content).toBe("비공개 b 본문");
  f.model.reviewed(true);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "html")).toBe(true);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "pdf")).toBe(false);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "zip")).toBe(false);
  stop();
  expect(f.clears()).toBe(1);
});
test("photo/mask/exclusion choices and split save retain each original displayed revision", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  f.model.photo("file_a");
  expect(f.model.getSnapshot().draft?.includedPhotoIds).toEqual(["file_a"]);
  f.model.change({ maskIdentifiers: true });
  expect(f.model.getSnapshot().draft?.includedPhotoIds).toEqual(["file_a"]);
  f.model.change({ content: "편집한 본문" });
  f.model.exclude("file_a");
  expect(f.model.getSnapshot().draft?.includedPhotoIds).toEqual([]);
  await f.model.save();
  const saves = () => f.calls.filter((call) => call.kind === "save");
  expect((saves()[0]?.input as ReportSave | undefined)?.excludedFileIds).toEqual([]);
  expect(saves()[0]?.revision).toBe(1);
  expect(f.model.getSnapshot().report?.content).toBe("편집한 본문");
  expect(f.model.getSnapshot().draft?.excludedFileIds).toEqual(["file_a"]);
  expect(reportDirty(f.model.getSnapshot())).toBe(true);
  await f.model.save();
  expect(saves()[1]?.revision).toBe(2);
  expect(f.model.getSnapshot().report?.content).toBe("출처에서 다시 구성한 본문");
  expect(reportDirty(f.model.getSnapshot())).toBe(false);
  expect(f.model.getSnapshot().reviewed).toBe(false);
  stop();
});
test("unknown save retains draft/revision for explicit retry; conflict and confirmed reload preserve user intent", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  f.model.change({ content: "응답 유실 입력" });
  f.failure("unknown");
  await f.model.save();
  expect(f.model.getSnapshot().draft?.content).toBe("응답 유실 입력");
  f.failure("");
  await f.model.save();
  expect(f.calls.filter((call) => call.kind === "save").map((call) => call.revision)).toEqual([
    1, 1,
  ]);
  f.model.change({ content: "충돌 입력" });
  f.failure("conflict");
  await f.model.save();
  expect(f.model.getSnapshot().conflict).toBe(true);
  expect(f.model.getSnapshot().draft?.content).toBe("충돌 입력");
  const count = f.calls.length;
  await f.model.refresh();
  expect(f.calls.length).toBe(count);
  expect(f.model.getSnapshot().confirm).toBe("reload");
  f.model.cancelConfirm();
  expect(f.model.getSnapshot().draft?.content).toBe("충돌 입력");
  await f.model.refresh();
  f.failure("");
  await f.model.confirmReload();
  expect(f.model.getSnapshot().draft?.content).toBe("응답 유실 입력");
  expect(f.model.getSnapshot().conflict).toBe(false);
  stop();
});
test("new drafts require explicit confirmation and initial excluded generation carries null absence CAS", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  await f.model.generate();
  expect(f.calls.some((call) => call.kind === "generate")).toBe(false);
  f.model.change({ content: "교체 전 입력" });
  f.model.askGenerate();
  await f.model.generate();
  expect(f.calls.find((call) => call.kind === "generate")?.revision).toBe(1);
  stop();
  const g = fixture();
  g.failure("initial");
  const end = g.model.start();
  await tick();
  expect(g.model.getSnapshot().initialLimit).toBe(true);
  await g.model.generateInitial();
  expect(g.calls.some((call) => call.kind === "generate")).toBe(false);
  g.model.excludeInitial("file_a");
  await g.model.generateInitial();
  expect(g.calls.find((call) => call.kind === "generate")).toMatchObject({
    input: ["file_a"],
    revision: null,
  });
  expect(g.model.getSnapshot().report?.revision).toBe(1);
  end();
});
test("exports require saved review and unmasked original acknowledgement, which selection changes revoke", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  await f.model.download("pdf");
  expect(f.model.getSnapshot().download).toBeNull();
  f.model.reviewed(true);
  await f.model.download("pdf");
  expect(f.model.getSnapshot().report?.pdfAvailable).toBe(true);
  f.model.originalSelection("file_a");
  expect(reportDownloadAllowed(f.model.getSnapshot(), "zip")).toBe(false);
  f.model.acknowledgeOriginals(true);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "zip")).toBe(true);
  f.model.originalSelection("file_a");
  expect(f.model.getSnapshot().originalsAcknowledged).toBe(false);
  f.model.originalSelection("file_a");
  f.model.acknowledgeOriginals(true);
  await f.model.download("zip");
  expect(f.calls.find((call) => call.kind === "zip")?.input).toEqual(["file_a"]);
  f.model.change({ maskIdentifiers: true });
  expect(f.model.getSnapshot().reviewed).toBe(false);
  expect(f.model.getSnapshot().download).toBeNull();
  expect(reportDownloadAllowed(f.model.getSnapshot(), "html")).toBe(false);
  stop();
});
test("a late download is discarded across an owner change; native preflight cannot hand off old files", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  let finish!: (value: ReturnType<typeof f.value>) => void;
  f.download(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.model.reviewed(true);
  const pending = f.model.download("pdf"),
    handle = f.value();
  f.set(ready("b"));
  finish(handle);
  await pending;
  await tick();
  expect(f.discarded).toContain(handle);
  expect(f.model.getSnapshot().download).toBeNull();
  f.download(async () => f.value());
  f.model.reviewed(true);
  await f.model.download("pdf");
  let release!: () => void,
    handed = 0;
  f.present(async (check) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    check();
    handed++;
  });
  const handoff = f.model.present("share");
  f.set(ready("a"));
  release();
  await handoff;
  expect(handed).toBe(0);
  expect(f.model.getSnapshot().download).toBeNull();
  stop();
});
test("not-found fresh verification is bounded and provider storage diagnostics never reach native messages", async () => {
  const f = fixture();
  f.failure("missing");
  const stop = f.model.start();
  await tick();
  await tick();
  expect(f.refreshes()).toBe(1);
  expect(f.model.getSnapshot().report).toBeNull();
  stop();
  const request = createReportHttp(async () =>
    Response.json(
      { error: { code: "EXPORT_LIMIT_EXCEEDED", message: "SYNTHETIC_PRIVATE_SQL_STACK" } },
      { status: 413 },
    ),
  );
  await expect(request("/api/v2/cases/case_a/reports")).rejects.toMatchObject({
    reason: "EXPORT_LIMIT_EXCEEDED",
  });
  try {
    await request("/api/v2/cases/case_a/reports");
  } catch (error) {
    expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_SQL_STACK");
  }
});

test("native photo handoff hides then restores same-owner edits after a fresh saved-version read; changed versions conflict and logout discards", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  f.model.photo("file_a");
  f.model.change({ content: "미저장 사진 검토 본문" });
  f.present(async () => {
    f.set({ ...ready(), phase: "checking", session: null });
    expect(f.model.getSnapshot().draft).toBeNull();
    f.set(ready());
    expect(f.model.getSnapshot().draft).toBeNull();
    await tick();
  });
  await f.model.openPhoto("file_a");
  await tick();
  expect(f.model.getSnapshot().draft?.content).toBe("미저장 사진 검토 본문");
  expect(f.model.getSnapshot().draft?.includedPhotoIds).toEqual(["file_a"]);
  expect(f.model.getSnapshot().reviewed).toBe(false);
  f.set({ ...ready(), phase: "checking", session: null });
  const previous = f.reports.get("a");
  if (!previous) throw new Error("MISSING_SYNTHETIC_REPORT");
  f.reports.set("a", { ...previous, revision: 2, content: "다른 화면의 새 저장" });
  f.set(ready());
  await tick();
  expect(f.model.getSnapshot().draft?.content).toBe("미저장 사진 검토 본문");
  expect(f.model.getSnapshot().report?.revision).toBe(1);
  expect(f.model.getSnapshot().conflict).toBe(true);
  f.set({ ...ready(), phase: "anonymous", session: null });
  f.set(ready());
  await tick();
  expect(f.model.getSnapshot().draft?.content).toBe("다른 화면의 새 저장");
  expect(f.model.getSnapshot().draft?.includedPhotoIds).toEqual([]);
  stop();
});

test("technical export exhaustion stops binary retries until a new saved review version; saved HTML remains readable", async () => {
  const f = fixture(),
    stop = f.model.start();
  await tick();
  f.model.reviewed(true);
  f.download(async () => {
    throw new ReportFailure("EXPORT_RETRY_EXHAUSTED");
  });
  await f.model.download("pdf");
  expect(f.model.getSnapshot().exportExhausted).toBe(true);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "pdf")).toBe(false);
  expect(reportDownloadAllowed(f.model.getSnapshot(), "html")).toBe(true);
  await f.model.save();
  expect(f.model.getSnapshot().report?.revision).toBe(2);
  expect(f.model.getSnapshot().exportExhausted).toBe(false);
  stop();
});
