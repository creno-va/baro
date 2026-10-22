import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import type { FileReviewView, FileView } from "@baro/client-core";
import { createFilesModel } from "../apps/mobile/src/features/files/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { bindPrivateFileLifecycle } from "../apps/mobile/src/platform/files/lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const ready = (
  owner = "a",
  needsConsent = false,
  role: "customer" | "lawyer" = "customer",
): SessionState => ({
  phase: needsConsent ? "consent" : "ready",
  session: { user: { id: owner, name: `합성 ${owner}`, accountType: role }, needsConsent },
  role,
  busy: false,
  consent: null,
  error: null,
});
function fixture() {
  let state = ready(),
    backend = state,
    refreshes = 0,
    clears = 0;
  const listeners = new Set<() => void>(),
    released: string[] = [],
    discarded: number[] = [],
    calls: string[] = [];
  const source = Object.freeze({ name: "합성 비공개 선택.txt", size: 3, type: "text/plain" });
  const download = { size: 3, mimeType: "application/octet-stream", sha256: "a".repeat(64) };
  const files = new Map<string, FileView[]>(
    ["a", "b"].map((id) => [
      id,
      [
        {
          id: `file_${id}`,
          name: `비공개 ${id}.txt`,
          sizeBytes: 3,
          mimeType: "text/plain",
          status: "ready",
          coverage: "합성 범위",
          extractedText: "",
        },
      ],
    ]),
  );
  let review: FileReviewView = {
    file: { id: "file_a", revision: 1, name: "합성 자료", status: "ready" },
    workspaceRevision: 2,
    coverage: { category: "image", status: "complete", observation: "processed" },
    observations: [
      {
        ordinal: 0,
        original: {
          id: "o_a",
          text: "교정 전 원문",
          position: { kind: "image", region: null },
          certainty: "observed",
          userEdited: false,
          included: true,
        },
        value: {
          id: "o_a",
          text: "교정 전 원문",
          position: { kind: "image", region: null },
          certainty: "observed",
          userEdited: false,
          included: true,
        },
      },
    ],
    nextAfterOrdinal: null,
    pendingReview: null,
    recovery: null,
  };
  const set = (next: SessionState, updateBackend = true) => {
    state = next;
    if (updateBackend) backend = next;
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
  type Client = ReturnType<Parameters<typeof createFilesModel>[0]["createClient"]>;
  let pick = async () => source as typeof source | null;
  let upload: (ack: (id: string) => void) => Promise<FileView> = async (ack) => {
    ack("uploaded_a");
    return { ...(files.get("a")?.[0] as FileView), id: "uploaded_a", status: "waiting" as const };
  };
  let afterDelete = () => {};
  const createClient: Parameters<typeof createFilesModel>[0]["createClient"] = (
    _signal,
    owner,
    ack,
  ) =>
    ({
      async list() {
        calls.push(`list:${owner}`);
        return [...(files.get(owner) ?? [])];
      },
      async upload() {
        calls.push(`upload:${owner}`);
        return upload(ack);
      },
      async retry() {
        calls.push(`retry:${owner}`);
        return files.get(owner)?.[0] as FileView;
      },
      async review() {
        calls.push(`review:${owner}`);
        return review;
      },
      async saveReview(_id, _fileId, body, revision) {
        calls.push(`save:${body.expectedRevision}:${revision}`);
        review = {
          ...review,
          file: { ...review.file, revision: 2 },
          observations: review.observations.map((row) => ({
            ...row,
            value: {
              ...row.value,
              text: body.edits[0]?.text ?? "",
              included: body.edits[0]?.included ?? false,
              userEdited: true,
              certainty: "uncertain",
            },
          })),
        };
        return {
          reviewId: "review_a",
          fileId: "file_a",
          revision: 2,
          workspaceRevision: 3,
          status: "ready",
          completed: 1,
          total: 1,
        };
      },
      async continueReview() {
        calls.push("continue");
        review = { ...review, pendingReview: null };
        return {
          reviewId: "review_a",
          fileId: "file_a",
          revision: 2,
          workspaceRevision: 3,
          status: "ready",
          completed: 1,
          total: 1,
        };
      },
      async discardReview() {
        calls.push("discard-review");
        review = { ...review, pendingReview: null };
      },
      async remove(_id, fileId) {
        calls.push(`remove:${owner}`);
        files.set(
          owner,
          (files.get(owner) ?? []).filter((file) => file.id !== fileId),
        );
        afterDelete();
        return files.get(owner) ?? [];
      },
      async original() {
        calls.push(`original:${owner}`);
        return download;
      },
    }) satisfies Client;
  const dependencies: Parameters<typeof createFilesModel>[0] = {
    caseId: "case_a",
    session,
    createClient,
    pick: () => pick(),
    release: async (value) => {
      released.push(value.name);
    },
    discard: async () => {
      discarded.push(1);
    },
    present: async (_value, _mode, _file, ensure) => {
      ensure();
      calls.push("present");
    },
    clear: async () => {
      clears++;
    },
    schedule: () => () => {},
  };
  const model = createFilesModel(dependencies),
    stop = model.start();
  return {
    model,
    stop,
    source,
    files,
    calls,
    released,
    discarded,
    dependencies,
    session,
    set,
    setPick: (value: typeof pick) => {
      pick = value;
    },
    setUpload: (value: typeof upload) => {
      upload = value;
    },
    setReview: (value: FileReviewView) => {
      review = value;
    },
    review: () => review,
    afterDelete: (value: () => void) => {
      afterDelete = value;
    },
    stats: () => ({ refreshes, clears }),
  };
}
test("a selected OS file revalidates the owner before publication; accepted upload is not retried after projection failure", async () => {
  const f = fixture();
  await tick();
  await f.model.select();
  expect(f.model.getSnapshot().source).toBe(f.source);
  expect(f.stats().refreshes).toBe(1);
  f.setUpload(async (ack) => {
    ack("uploaded_a");
    throw new ApiError("UNAVAILABLE", "합성 조회 유실");
  });
  await f.model.upload();
  expect(f.model.getSnapshot()).toMatchObject({
    source: null,
    pendingUpload: false,
    busy: null,
    error: "합성 조회 유실",
  });
  expect(f.released).toContain(f.source.name);
  await f.model.upload();
  expect(f.calls.filter((call) => call.startsWith("upload"))).toHaveLength(1);
  f.stop();
});
test("picker return after a signed owner switch is cleaned rather than displayed to the new owner", async () => {
  const f = fixture(),
    hold = deferred<typeof f.source>();
  await tick();
  f.setPick(() => hold.promise);
  const picking = f.model.select();
  f.set(ready("b"));
  hold.resolve(f.source);
  await picking;
  await tick();
  expect(f.model.getSnapshot().source).toBeNull();
  expect(f.model.getSnapshot().files[0]?.name).toBe("비공개 b.txt");
  expect(f.released).toContain(f.source.name);
  f.stop();
});
test("system picker background hides private identity and restores only after a fresh same-owner session", async () => {
  const f = fixture(),
    hold = deferred<typeof f.source>();
  await tick();
  f.setPick(() => hold.promise);
  const picking = f.model.select();
  f.set({ ...ready(), phase: "checking", session: null }, false);
  expect(f.model.getSnapshot()).toMatchObject({ gate: "checking", source: null, files: [] });
  f.set(ready());
  hold.resolve(f.source);
  await picking;
  expect(f.model.getSnapshot()).toMatchObject({ gate: "ready", source: f.source, busy: null });
  f.stop();
});
test("background retires an old upload response, retains its same-owner source for reconciliation and route exit discards it", async () => {
  const f = fixture(),
    hold = deferred<void>();
  await tick();
  await f.model.select();
  f.setUpload(async () => {
    await hold.promise;
    return { ...(f.files.get("a")?.[0] as FileView), id: "old_upload" };
  });
  const upload = f.model.upload();
  f.set({ ...ready(), phase: "checking", session: null }, false);
  f.set(ready());
  await tick();
  hold.resolve();
  await upload;
  expect(f.model.getSnapshot().source).toBe(f.source);
  expect(f.model.getSnapshot().files.some((row) => row.id === "old_upload")).toBe(false);
  f.stop();
  await tick();
  expect(f.model.getSnapshot()).toMatchObject({ source: null, files: [] });
  expect(f.released).toContain(f.source.name);
  expect(f.stats().clears).toBe(1);
});
test("expired-upload conflict preserves selection across fresh-owner revalidation and requires explicit restart", async () => {
  const f = fixture();
  await tick();
  await f.model.select();
  f.setUpload(async () => {
    throw new ApiError("NOT_FOUND", "합성 만료");
  });
  await f.model.upload();
  await tick();
  expect(f.model.getSnapshot()).toMatchObject({
    source: f.source,
    uploadConflict: true,
    pendingUpload: true,
    gate: "ready",
  });
  const before = f.stats().refreshes;
  await f.model.select();
  expect(f.stats().refreshes).toBe(before);
  expect(f.model.getSnapshot().source).toBe(f.source);
  f.stop();
});
test("a cancelled late picker cannot refresh or revive a subsequent same-owner login", async () => {
  const f = fixture(),
    hold = deferred<typeof f.source>();
  await tick();
  f.setPick(() => hold.promise);
  const picking = f.model.select();
  f.set({ ...ready(), phase: "anonymous", session: null });
  f.set(ready());
  const before = f.stats().refreshes;
  hold.resolve(f.source);
  await picking;
  expect(f.stats().refreshes).toBe(before);
  expect(f.model.getSnapshot().source).toBeNull();
  expect(f.released).toContain(f.source.name);
  f.stop();
});
test("consent-required owners retain read/download/delete but cannot upload, process or edit observations", async () => {
  const f = fixture();
  f.set(ready("a", true));
  await tick();
  await f.model.select();
  await f.model.retry("file_a");
  await f.model.review("file_a");
  f.model.edit("o_a");
  expect(f.calls.some((call) => call.startsWith("upload") || call.startsWith("retry"))).toBe(false);
  expect(f.model.getSnapshot().edit).toBeNull();
  await f.model.original("file_a");
  await f.model.present("share");
  expect(f.calls).toContain("original:a");
  expect(f.calls).toContain("present");
  f.model.askDelete("file_a");
  f.model.confirm("DELETE");
  await f.model.remove();
  expect(f.calls).toContain("remove:a");
  f.stop();
});
test("single-observation correction preserves source/original, submits the original revisions and clears acknowledged input", async () => {
  const f = fixture();
  await tick();
  await f.model.review("file_a");
  f.model.edit("o_a");
  f.model.changeEdit({ text: "사용자 교정", included: false });
  await f.model.saveEdit();
  expect(f.calls).toContain("save:1:2");
  expect(f.model.getSnapshot().edit).toBeNull();
  expect(f.review().observations[0]).toMatchObject({
    original: { text: "교정 전 원문" },
    value: { text: "사용자 교정", included: false, certainty: "uncertain", userEdited: true },
  });
  f.stop();
});
test("pending server review can be resumed and a lost delete ACK is confirmed by the signed absence of that exact file", async () => {
  const f = fixture();
  await tick();
  f.setReview({
    ...f.review(),
    pendingReview: {
      reviewId: "review_a",
      fileId: "file_a",
      revision: 2,
      workspaceRevision: 3,
      status: "saving",
      completed: 1,
      total: 2,
    },
  });
  await f.model.review("file_a");
  await f.model.pendingReview(false);
  expect(f.calls).toContain("continue");
  expect(f.model.getSnapshot().review?.pendingReview).toBeNull();
  f.model.askDelete("file_a");
  f.model.confirm("delete");
  await f.model.remove();
  expect(f.calls).not.toContain("remove:a");
  f.model.confirm("DELETE");
  f.afterDelete(() => {
    throw new ApiError("UNAVAILABLE", "합성 삭제 ACK 유실");
  });
  await f.model.remove();
  expect(f.model.getSnapshot()).toMatchObject({
    files: [],
    deleteTarget: null,
    review: null,
    busy: null,
  });
  f.stop();
});
test("private lifecycle clears on startup, logout, owner/role/consent change, and keeps native handoff files through background checking", async () => {
  const f = fixture();
  let clears = 0;
  const stop = bindPrivateFileLifecycle(f.session, async () => {
    clears++;
  });
  expect(clears).toBe(1);
  f.set({ ...ready(), phase: "checking", session: null }, false);
  f.set(ready());
  expect(clears).toBe(1);
  f.set(ready("a", true));
  f.set(ready("a", true, "lawyer"));
  f.set(ready("b"));
  expect(clears).toBe(4);
  f.set({ ...ready(), phase: "anonymous", session: null });
  f.set(ready("b"));
  expect(clears).toBe(6);
  stop();
  f.stop();
});
test("a native handoff retired by backgrounding is cleaned on fresh return and cannot republish its old private handle", async () => {
  const f = fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  await tick();
  await f.model.original("file_a");
  f.dependencies.present = async (_value, _mode, _file, ensure) => {
    ensure();
    entered.resolve();
    await release.promise;
    ensure();
  };
  const show = f.model.present("open");
  await entered.promise;
  f.set({ ...ready(), phase: "checking", session: null }, false);
  expect(f.discarded).toHaveLength(0);
  f.set(ready());
  await tick();
  expect(f.discarded).toHaveLength(1);
  release.resolve();
  await show;
  expect(f.model.getSnapshot().download).toBeNull();
  f.stop();
});
test("observation pages replace the current rows, support back navigation and reject a mixed-revision page", async () => {
  const f = fixture();
  await tick();
  const first = { ...f.review(), nextAfterOrdinal: 0 };
  f.setReview(first);
  await f.model.review("file_a");
  const next: FileReviewView = {
    ...first,
    nextAfterOrdinal: null,
    observations: first.observations.map((row) => ({
      ...row,
      ordinal: 1,
      value: { ...row.value, id: "o_b", text: "다음 페이지" },
    })),
  };
  f.setReview(next);
  await f.model.review("file_a", true);
  expect(f.model.getSnapshot().review?.observations).toHaveLength(1);
  expect(f.model.getSnapshot().review?.observations[0]?.value.id).toBe("o_b");
  expect(f.model.getSnapshot().reviewHistory).toEqual([-1]);
  f.setReview(first);
  await f.model.review("file_a", false, true);
  expect(f.model.getSnapshot().review?.observations[0]?.value.id).toBe("o_a");
  f.setReview({ ...next, file: { ...next.file, revision: 2 } });
  await f.model.review("file_a", true);
  expect(f.model.getSnapshot().reviewConflict).toBe(true);
  expect(f.model.getSnapshot().review?.observations[0]?.value.id).toBe("o_a");
  f.stop();
});
test("a conflicted review receipt is not a save ACK and editing another row cannot silently discard the draft", async () => {
  const f = fixture(),
    original = f.dependencies.createClient;
  f.dependencies.createClient = (...args) => ({
    ...original(...args),
    saveReview: async () => ({
      reviewId: "review_a",
      fileId: "file_a",
      revision: 1,
      workspaceRevision: 2,
      status: "conflict",
      completed: 0,
      total: 1,
    }),
  });
  f.set({ ...ready(), phase: "checking", session: null }, false);
  f.set(ready());
  await tick();
  await f.model.review("file_a");
  f.model.edit("o_a");
  f.model.changeEdit({ text: "보존할 교정" });
  f.model.edit("o_a");
  expect(f.model.getSnapshot().edit?.text).toBe("보존할 교정");
  await f.model.saveEdit();
  expect(f.model.getSnapshot()).toMatchObject({
    reviewConflict: true,
    edit: { text: "보존할 교정" },
  });
  expect(f.model.getSnapshot().notice?.includes("저장이 접수")).not.toBe(true);
  f.model.cancelEdit();
  expect(f.model.getSnapshot().edit).toBeNull();
  f.stop();
});
