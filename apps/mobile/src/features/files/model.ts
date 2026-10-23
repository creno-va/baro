import { ApiError, type createFilesClient, errorMessage } from "@baro/api-client";
import type { FileReviewView, FileUploadProgress, FileView } from "@baro/client-core";
import { opaqueIdSchema } from "@baro/contracts/common";
import type { PrivateDownload } from "../../platform/files/download";
import type { NativeUploadSource } from "../../platform/files/upload-reader";
import type { SessionModel, SessionState } from "../session/model";

type Client = ReturnType<typeof createFilesClient<NativeUploadSource, PrivateDownload>>;
type Busy =
  | "select"
  | "upload"
  | "retry"
  | "review"
  | "save"
  | "delete"
  | "download"
  | "present"
  | null;
export interface FilesState {
  gate: "checking" | "login" | "role" | "error" | "ready";
  canWrite: boolean;
  files: FileView[];
  source: NativeUploadSource | null;
  progress: FileUploadProgress | null;
  pendingUpload: boolean;
  uploadConflict: boolean;
  review: FileReviewView | null;
  reviewAfter: number;
  reviewHistory: number[];
  edit: { id: string; text: string; included: boolean } | null;
  reviewConflict: boolean;
  deleteTarget: string | null;
  confirmation: string;
  download: { value: PrivateDownload; file: FileView } | null;
  busy: Busy;
  loading: boolean;
  error: string | null;
  notice: string | null;
}
const empty = (): FilesState => ({
  gate: "checking",
  canWrite: false,
  files: [],
  source: null,
  progress: null,
  pendingUpload: false,
  uploadConflict: false,
  review: null,
  reviewAfter: -1,
  reviewHistory: [],
  edit: null,
  reviewConflict: false,
  deleteTarget: null,
  confirmation: "",
  download: null,
  busy: null,
  loading: false,
  error: null,
  notice: null,
});
function access(state: SessionState) {
  const user = state.session?.user;
  if (user && ["ready", "consent"].includes(state.phase))
    return user.accountType === "customer"
      ? { gate: "ready" as const, owner: user.id, canWrite: !state.session?.needsConsent }
      : { gate: "role" as const };
  return {
    gate:
      state.phase === "anonymous"
        ? ("login" as const)
        : state.phase === "error"
          ? ("error" as const)
          : ("checking" as const),
  };
}
export function createFilesModel(dependencies: {
  caseId: string;
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient(signal: AbortSignal, owner: string, acknowledged: (fileId: string) => void): Client;
  pick(signal: AbortSignal): Promise<NativeUploadSource | null>;
  release(source: NativeUploadSource): Promise<void>;
  discard(value: PrivateDownload): Promise<void>;
  present(
    value: PrivateDownload,
    mode: "open" | "share",
    file: FileView,
    ensure: () => void,
  ): Promise<void>;
  clear(): Promise<void>;
  schedule?: (task: () => void, milliseconds: number) => () => void;
}) {
  const parsed = opaqueIdSchema.safeParse(dependencies.caseId);
  let state = empty(),
    owner: string | undefined,
    permission = false,
    active = false,
    version = 0;
  let controller: AbortController | undefined,
    picker: AbortController | undefined,
    client: Client | undefined,
    cancelPoll: (() => void) | undefined;
  let parked: { owner: string; canWrite: boolean; state: FilesState } | undefined;
  const subscribers = new Set<() => void>();
  const missingChecks = new Set<string>();
  const retiredDownloads = new Set<PrivateDownload>();
  const publish = (next: FilesState) => {
    state = next;
    for (const listener of subscribers) listener();
  };
  const current = (captured: number) =>
    active && version === captured && state.gate === "ready" && !controller?.signal.aborted;
  const release = (source: NativeUploadSource | null) => {
    if (source) void dependencies.release(source).catch(() => {});
  };
  const discard = (value: FilesState["download"]) => {
    if (value) void dependencies.discard(value.value).catch(() => {});
  };
  function retire() {
    version++;
    cancelPoll?.();
    cancelPoll = undefined;
    controller?.abort();
    client = undefined;
  }
  function retirePicker() {
    picker?.abort();
    picker = undefined;
  }
  function renew() {
    retire();
    controller = new AbortController();
    const captured = version;
    if (!owner) return;
    client = dependencies.createClient(controller.signal, owner, () => {
      if (!current(captured) || state.busy !== "upload") return;
      release(state.source);
      publish({
        ...state,
        source: null,
        pendingUpload: false,
        uploadConflict: false,
        notice: "파일 업로드가 접수됐어요. 서버 저장 상태를 확인하고 있어요.",
      });
    });
  }
  function poll() {
    cancelPoll?.();
    cancelPoll = undefined;
    if (
      !active ||
      state.gate !== "ready" ||
      state.busy ||
      state.loading ||
      !state.files.some((file) => file.status === "processing" || file.processing)
    )
      return;
    const schedule =
      dependencies.schedule ??
      ((task: () => void, ms: number) => {
        const timer = setTimeout(task, ms);
        return () => clearTimeout(timer);
      });
    cancelPoll = schedule(() => {
      void refresh();
    }, 3000);
  }
  function fail(captured: number, error: unknown) {
    if (!current(captured)) return;
    if (error instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code)) {
      void dependencies.session.refresh();
      return;
    }
    publish({ ...state, busy: null, loading: false, error: errorMessage(error) });
    if (error instanceof ApiError && error.code === "NOT_FOUND" && owner) {
      const identity = `${owner}:${permission}`;
      if (!missingChecks.has(identity)) {
        missingChecks.add(identity);
        void dependencies.session.refresh();
      }
    }
  }
  async function refresh() {
    if (!parsed.success || !active || state.gate !== "ready" || !client || state.loading) return;
    const captured = version,
      api = client;
    cancelPoll?.();
    publish({ ...state, loading: true, error: null });
    try {
      const files = await api.list(parsed.data, { metadataOnly: true });
      if (!current(captured)) return;
      missingChecks.clear();
      publish({ ...state, files, loading: false });
      poll();
    } catch (error) {
      fail(captured, error);
    }
  }
  function observe() {
    const session = dependencies.session.getSnapshot(),
      next = access(session);
    if (next.gate !== "ready") {
      if (state.download) retiredDownloads.add(state.download.value);
      if (
        state.gate === "ready" &&
        owner &&
        next.gate === "checking" &&
        session.phase !== "authorizing"
      )
        parked = {
          owner,
          canWrite: permission,
          state: {
            ...state,
            busy: null,
            loading: false,
            review: null,
            edit: null,
            reviewConflict: false,
            download: null,
          },
        };
      else if (next.gate !== "checking" || session.phase === "authorizing") {
        release(state.source ?? parked?.state.source ?? null);
        discard(state.download);
        parked = undefined;
        retirePicker();
        owner = undefined;
      }
      retire();
      publish({ ...empty(), gate: next.gate });
      return;
    }
    if (state.gate === "ready" && next.owner === owner && next.canWrite === permission) return;
    // A native handoff may keep reading while the app is backgrounded. Retire its
    // handle on return; the cache waits for the active presentation before unlinking.
    for (const value of retiredDownloads) void dependencies.discard(value).catch(() => {});
    retiredDownloads.clear();
    if (parked && (parked.owner !== next.owner || parked.canWrite !== next.canWrite)) {
      release(parked.state.source);
      parked = undefined;
      retirePicker();
    }
    if (owner && (owner !== next.owner || permission !== next.canWrite)) {
      release(state.source);
      discard(state.download);
      retirePicker();
    }
    owner = next.owner;
    permission = next.canWrite;
    const restored = parked?.state;
    parked = undefined;
    publish({
      ...(restored ?? empty()),
      gate: "ready",
      canWrite: permission,
      busy: picker ? "select" : null,
      loading: false,
    });
    renew();
    void refresh();
  }
  const available = (write = false) =>
    state.gate === "ready" && !state.busy && client && parsed.success && (!write || state.canWrite);
  async function waitForOwner(expected: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      const done = (error?: unknown) => {
        unsubscribe();
        signal.removeEventListener("abort", cancelled);
        error ? reject(error) : resolve();
      };
      const cancelled = () => done(new ApiError("UNAUTHENTICATED", "파일 선택이 취소됐어요."));
      const inspect = () => {
        if (signal.aborted || !active) return cancelled();
        const next = access(dependencies.session.getSnapshot());
        if (next.gate === "ready")
          return next.owner === expected && next.canWrite ? done() : cancelled();
        if (next.gate !== "checking" || dependencies.session.getSnapshot().phase === "authorizing")
          cancelled();
      };
      unsubscribe = dependencies.session.subscribe(inspect);
      signal.addEventListener("abort", cancelled, { once: true });
      inspect();
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    start() {
      active = true;
      const unsubscribe = dependencies.session.subscribe(observe);
      observe();
      return () => {
        active = false;
        unsubscribe();
        retirePicker();
        retire();
        release(state.source ?? parked?.state.source ?? null);
        discard(state.download);
        parked = undefined;
        retiredDownloads.clear();
        owner = undefined;
        publish(empty());
        void dependencies.clear().catch(() => {});
      };
    },
    refresh,
    async select() {
      if (!available(true) || !owner || state.pendingUpload) return;
      const expected = owner,
        selection = new AbortController();
      picker = selection;
      release(state.source);
      discard(state.download);
      publish({
        ...state,
        source: null,
        download: null,
        busy: "select",
        pendingUpload: false,
        uploadConflict: false,
        progress: null,
        error: null,
        notice: null,
      });
      let source: NativeUploadSource | null = null;
      try {
        source = await dependencies.pick(selection.signal);
        selection.signal.throwIfAborted();
        if (!active || picker !== selection) throw new Error("PICK_RETIRED");
        await dependencies.session.refresh();
        await waitForOwner(expected, selection.signal);
        if (picker !== selection || !active || owner !== expected) throw new Error("PICK_RETIRED");
        publish({ ...state, source, busy: null });
        source = null;
      } catch (error) {
        if (active && picker === selection && state.gate === "ready")
          publish({ ...state, busy: null, error: errorMessage(error) });
      } finally {
        release(source);
        if (picker === selection) {
          picker = undefined;
          if (state.gate === "ready" && state.busy === "select") publish({ ...state, busy: null });
        }
      }
    },
    async upload(resolveConflict = false) {
      if (!available(true) || !state.source || !client || !parsed.success) return;
      const api = client,
        captured = version,
        source = state.source;
      cancelPoll?.();
      publish({ ...state, busy: "upload", pendingUpload: true, error: null, notice: null });
      try {
        const result = await api.upload(
          parsed.data,
          source,
          (progress) => {
            if (current(captured)) publish({ ...state, progress });
          },
          { metadataOnly: true, ...(resolveConflict ? { resolveConflict: true } : {}) },
        );
        if (!current(captured)) return;
        release(state.source);
        publish({
          ...state,
          source: null,
          pendingUpload: false,
          uploadConflict: false,
          busy: null,
          progress: null,
          notice: "서버에 파일이 저장됐어요. 처리 상태를 확인해 주세요.",
          files: [...state.files.filter((file) => file.id !== result.id), result],
        });
        await refresh();
      } catch (error) {
        if (current(captured)) {
          publish({
            ...state,
            uploadConflict:
              error instanceof ApiError && ["CONFLICT", "NOT_FOUND"].includes(error.code),
          });
          fail(captured, error);
        }
      }
    },
    cancelSelection() {
      if (state.gate !== "ready") return;
      retirePicker();
      release(state.source);
      discard(state.download);
      renew();
      publish({
        ...state,
        source: null,
        progress: null,
        download: null,
        pendingUpload: false,
        uploadConflict: false,
        busy: null,
        error: null,
        notice:
          "기기 요청을 중단했어요. 접수된 서버 작업은 계속될 수 있어요. 업로드는 같은 파일을 다시 선택해 결과를 확인할 수 있어요.",
      });
      void refresh();
    },
    async retry(fileId: string) {
      if (!available(true) || !client || !parsed.success) return;
      const file = state.files.find((row) => row.id === fileId);
      if (!file || (!file.canRetry && !file.canStartProcessing)) return;
      const api = client,
        captured = version;
      publish({ ...state, busy: "retry", error: null });
      try {
        await api.retry(
          parsed.data,
          fileId,
          () => {
            if (current(captured)) publish({ ...state, notice: "자료 처리 요청이 접수됐어요." });
          },
          { metadataOnly: true },
        );
        if (current(captured)) {
          publish({ ...state, busy: null });
          await refresh();
        }
      } catch (error) {
        fail(captured, error);
        if (current(captured)) await refresh();
      }
    },
    async review(fileId: string, more = false, previousPage = false) {
      if (!available() || !client || !parsed.success) return;
      if (state.edit && !(state.reviewConflict && !more && !previousPage)) return;
      const api = client,
        captured = version,
        previous = state.review;
      if (more && (previous?.file.id !== fileId || previous.nextAfterOrdinal === null)) return;
      if (previousPage && (previous?.file.id !== fileId || !state.reviewHistory.length)) return;
      const after = previousPage
        ? (state.reviewHistory.at(-1) ?? -1)
        : more
          ? (previous?.nextAfterOrdinal ?? -1)
          : -1;
      const history = previousPage
        ? state.reviewHistory.slice(0, -1)
        : more
          ? [...state.reviewHistory, state.reviewAfter]
          : [];
      publish({ ...state, busy: "review", error: null });
      try {
        const review = await api.review(parsed.data, fileId, after);
        if (!current(captured)) return;
        if (
          (more || previousPage) &&
          previous &&
          (review.file.revision !== previous.file.revision ||
            review.workspaceRevision !== previous.workspaceRevision)
        )
          throw new ApiError(
            "CONFLICT",
            "검토 중 자료가 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
          );
        publish({
          ...state,
          review,
          reviewAfter: after,
          reviewHistory: history,
          edit: null,
          reviewConflict: false,
          busy: null,
        });
      } catch (error) {
        if (current(captured))
          publish({
            ...state,
            reviewConflict: error instanceof ApiError && error.code === "CONFLICT",
          });
        fail(captured, error);
      }
    },
    edit(id: string) {
      if (!available(true) || state.edit || state.review?.pendingReview || state.reviewConflict)
        return;
      const row = state.review?.observations.find((row) => row.value.id === id);
      if (row)
        publish({ ...state, edit: { id, text: row.value.text, included: row.value.included } });
    },
    changeEdit(change: Partial<{ text: string; included: boolean }>) {
      if (!state.busy && state.edit) publish({ ...state, edit: { ...state.edit, ...change } });
    },
    cancelEdit() {
      if (!state.busy) publish({ ...state, edit: null });
    },
    async saveEdit() {
      if (
        !available(true) ||
        !client ||
        !parsed.success ||
        !state.edit ||
        !state.review ||
        state.reviewConflict
      )
        return;
      const api = client,
        captured = version,
        edit = state.edit,
        review = state.review;
      publish({ ...state, busy: "save", error: null });
      try {
        const progress = await api.saveReview(
          parsed.data,
          review.file.id,
          {
            expectedRevision: review.file.revision,
            edits: [{ observationId: edit.id, text: edit.text, included: edit.included }],
          },
          review.workspaceRevision,
        );
        if (!current(captured)) return;
        if (progress.status === "conflict")
          throw new ApiError(
            "CONFLICT",
            "교정 저장 중 자료가 바뀌었어요. 입력을 확인한 뒤 최신 검토를 읽어 주세요.",
          );
        publish({
          ...state,
          edit: null,
          busy: null,
          notice: "교정 저장이 접수됐어요. 교정은 검증된 원본 관찰을 뜻하지 않아요.",
          review: { ...review, pendingReview: progress.status === "saving" ? progress : null },
        });
        const latest = await api.review(parsed.data, review.file.id);
        if (current(captured))
          publish({ ...state, review: latest, reviewAfter: -1, reviewHistory: [] });
      } catch (error) {
        if (current(captured))
          publish({
            ...state,
            reviewConflict: error instanceof ApiError && error.code === "CONFLICT",
          });
        fail(captured, error);
      }
    },
    async pendingReview(discardPending: boolean) {
      if (!available(true) || !client || !parsed.success || !state.review?.pendingReview) return;
      const api = client,
        captured = version,
        review = state.review,
        progress = review.pendingReview;
      if (!progress) return;
      if (!discardPending && progress.status === "conflict") return;
      publish({ ...state, busy: "save", error: null });
      try {
        if (discardPending) await api.discardReview(parsed.data, review.file.id, progress.reviewId);
        else await api.continueReview(parsed.data, review.file.id, progress.reviewId);
        const latest = await api.review(parsed.data, review.file.id);
        if (current(captured))
          publish({
            ...state,
            review: latest,
            reviewAfter: -1,
            reviewHistory: [],
            edit: null,
            busy: null,
          });
      } catch (error) {
        fail(captured, error);
      }
    },
    closeReview() {
      if (!state.busy) publish({ ...state, review: null, edit: null, reviewConflict: false });
    },
    askDelete(fileId: string) {
      if (available()) publish({ ...state, deleteTarget: fileId, confirmation: "" });
    },
    confirm(value: string) {
      if (!state.busy) publish({ ...state, confirmation: value });
    },
    closeDelete() {
      if (!state.busy) publish({ ...state, deleteTarget: null, confirmation: "" });
    },
    async remove() {
      if (
        !available() ||
        !client ||
        !parsed.success ||
        !state.deleteTarget ||
        state.confirmation !== "DELETE"
      )
        return;
      const api = client,
        captured = version,
        fileId = state.deleteTarget;
      publish({ ...state, busy: "delete", error: null });
      const accepted = (files: FileView[]) => {
        discard(state.download);
        publish({
          ...state,
          files,
          review: null,
          edit: null,
          download: null,
          deleteTarget: null,
          confirmation: "",
          busy: null,
          notice:
            "자료 삭제가 접수됐어요. 서버의 물리 정리는 계속될 수 있으며 외부 앱에 전달한 복사본은 회수되지 않아요.",
        });
      };
      try {
        const files = await api.remove(parsed.data, fileId);
        if (current(captured)) accepted(files);
      } catch (error) {
        if (!current(captured)) return;
        try {
          const files = await api.list(parsed.data, { metadataOnly: true });
          if (current(captured) && !files.some((file) => file.id === fileId)) {
            accepted(files);
            return;
          }
        } catch {}
        fail(captured, error);
      }
    },
    async original(fileId: string) {
      if (!available() || !client || !parsed.success) return;
      const file = state.files.find((row) => row.id === fileId);
      if (!file) return;
      const api = client,
        captured = version;
      discard(state.download);
      publish({ ...state, download: null, busy: "download", error: null });
      let value: PrivateDownload | undefined;
      try {
        value = await api.original(parsed.data, fileId);
        if (!current(captured)) {
          await dependencies.discard(value);
          return;
        }
        if (value.size !== file.sizeBytes)
          throw new ApiError("UNAVAILABLE", "서버 원본과 파일 크기가 달라 다시 확인해 주세요.");
        if (file.uploadContentHash !== undefined && value.sha256 !== file.uploadContentHash)
          throw new ApiError("UNAVAILABLE", "서버 원본과 파일 해시가 달라 다시 확인해 주세요.");
        publish({ ...state, download: { value, file }, busy: null });
        value = undefined;
      } catch (error) {
        if (value) await dependencies.discard(value).catch(() => {});
        fail(captured, error);
      }
    },
    async present(mode: "open" | "share") {
      if (!available() || !state.download) return;
      const captured = version,
        value = state.download;
      publish({ ...state, busy: "present", error: null });
      try {
        await dependencies.present(value.value, mode, value.file, () => {
          if (!current(captured))
            throw new ApiError("UNAUTHENTICATED", "계정을 다시 확인해 주세요.");
        });
        if (current(captured)) publish({ ...state, busy: null });
      } catch (error) {
        fail(captured, error);
      }
    },
  };
}
export type FilesModel = ReturnType<typeof createFilesModel>;
