import {
  ApiError,
  type createReportsClient,
  errorMessage,
  type ReportSave,
  reportSaveSchema,
} from "@baro/api-client";
import type { FileView, ReportView } from "@baro/client-core";
import { opaqueIdSchema } from "@baro/contracts/common";
import type { PrivateDownload } from "../../platform/files/download";
import { ReportFailure } from "../../platform/reports/http";
import type { SessionModel, SessionState } from "../session/model";

export type ExportKind = "pdf" | "html" | "zip" | "savedZip";
export interface ReportsPorts {
  reports: ReturnType<typeof createReportsClient<PrivateDownload>>;
  listFiles(caseId: string): Promise<FileView[]>;
  original(caseId: string, fileId: string): Promise<PrivateDownload>;
}
export interface ReportsState {
  gate: "checking" | "login" | "role" | "error" | "ready";
  canWrite: boolean;
  report: ReportView | null;
  files: FileView[];
  draft: ReportSave | null;
  reviewed: boolean;
  originals: string[];
  originalsAcknowledged: boolean;
  download: { value: PrivateDownload; name: string; mimeType: string; label: string } | null;
  busy: "load" | "save" | "generate" | "download" | "present" | "photo" | null;
  confirm: "reload" | "generate" | null;
  conflict: boolean;
  initialLimit: boolean;
  initialExcluded: string[];
  exportExhausted: boolean;
  error: string | null;
  notice: string | null;
}
const empty = (): ReportsState => ({
  gate: "checking",
  canWrite: false,
  report: null,
  files: [],
  draft: null,
  reviewed: false,
  originals: [],
  originalsAcknowledged: false,
  download: null,
  busy: null,
  confirm: null,
  conflict: false,
  initialLimit: false,
  initialExcluded: [],
  exportExhausted: false,
  error: null,
  notice: null,
});
const equalIds = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function reportDirty(state: ReportsState) {
  const { report, draft } = state;
  return Boolean(
    report &&
      draft &&
      (draft.content !== report.content ||
        draft.maskIdentifiers !== report.maskIdentifiers ||
        !equalIds(draft.excludedFileIds, report.excludedFileIds) ||
        !equalIds(draft.includedPhotoIds ?? [], report.includedPhotoIds ?? [])),
  );
}
export function reportDownloadAllowed(state: ReportsState, kind: ExportKind) {
  if (
    state.gate !== "ready" ||
    state.busy ||
    !state.report ||
    !state.reviewed ||
    reportDirty(state)
  )
    return false;
  if (kind === "html") return true;
  if (state.exportExhausted) return false;
  if (kind === "pdf")
    return Boolean(
      state.report.pdfAvailable ||
        (state.canWrite && !state.report.stale && !state.exportExhausted),
    );
  if (kind === "savedZip") return Boolean(state.report.savedZip);
  return (
    state.canWrite &&
    !state.report.stale &&
    !state.exportExhausted &&
    state.originalsAcknowledged &&
    state.originals.length > 0
  );
}
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
export function createReportsModel(dependencies: {
  caseId: string;
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient(signal: AbortSignal, owner: string): ReportsPorts;
  discard(value: PrivateDownload): Promise<void>;
  present(
    value: PrivateDownload,
    mode: "open" | "share",
    input: { name: string; mimeType: string },
    ensure: () => void,
  ): Promise<void>;
  clear(): Promise<void>;
}) {
  const parsed = opaqueIdSchema.safeParse(dependencies.caseId);
  let state = empty(),
    active = false,
    version = 0,
    owner: string | undefined,
    permission = false;
  let controller: AbortController | undefined, client: ReportsPorts | undefined;
  let parked: { owner: string; canWrite: boolean; state: ReportsState } | undefined;
  const listeners = new Set<() => void>(),
    accessChecks = new Set<string>(),
    retired = new Set<PrivateDownload>();
  const publish = (next: ReportsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const current = (captured: number) =>
    active && version === captured && state.gate === "ready" && !controller?.signal.aborted;
  const discard = () => {
    if (state.download) void dependencies.discard(state.download.value).catch(() => {});
  };
  const retire = () => {
    version++;
    controller?.abort();
    client = undefined;
  };
  function renew() {
    retire();
    controller = new AbortController();
    if (owner) client = dependencies.createClient(controller.signal, owner);
  }
  function accept(report: ReportView, notice: string | null = null) {
    parked = undefined;
    discard();
    publish({
      ...state,
      report,
      draft: {
        content: report.content,
        maskIdentifiers: report.maskIdentifiers,
        excludedFileIds: [...report.excludedFileIds],
        includedPhotoIds: [...(report.includedPhotoIds ?? [])],
      },
      reviewed: false,
      originals: [],
      originalsAcknowledged: false,
      download: null,
      conflict: false,
      initialLimit: false,
      initialExcluded: [],
      exportExhausted: false,
      busy: null,
      confirm: null,
      error: null,
      notice,
    });
  }
  function fail(captured: number, error: unknown) {
    if (!current(captured)) return;
    if (
      error instanceof ApiError &&
      ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(error.code)
    ) {
      parked = undefined;
      discard();
      publish({ ...empty(), gate: "ready", canWrite: permission, error: errorMessage(error) });
      const identity = `${owner}:${permission}:${error.code}`;
      if (!accessChecks.has(identity)) {
        accessChecks.add(identity);
        void dependencies.session.refresh();
      }
      return;
    }
    publish({
      ...state,
      busy: null,
      error: errorMessage(error),
      conflict:
        error instanceof ReportFailure
          ? ["STALE_REVISION", "IDEMPOTENCY_CONFLICT"].includes(error.reason)
          : error instanceof ApiError && error.code === "CONFLICT",
      exportExhausted:
        state.exportExhausted ||
        (error instanceof ReportFailure && error.reason === "EXPORT_RETRY_EXHAUSTED"),
    });
  }
  async function load(force = false) {
    if (!active || !parsed.success || state.gate !== "ready" || !client || state.busy) return;
    const restoring = parked?.state;
    if (reportDirty(state) && !force && !restoring) {
      publish({ ...state, confirm: "reload" });
      return;
    }
    const api = client,
      captured = version;
    publish({ ...state, busy: "load", error: null });
    const [report, files] = await Promise.allSettled([
      api.reports.get(parsed.data),
      api.listFiles(parsed.data),
    ]);
    if (!current(captured)) return;
    if (report.status === "rejected") {
      if (
        report.reason instanceof ReportFailure &&
        report.reason.reason === "EXPORT_LIMIT_EXCEEDED" &&
        !state.report &&
        !restoring?.report &&
        files.status === "fulfilled"
      ) {
        publish({
          ...state,
          files: files.value,
          busy: null,
          initialLimit: true,
          initialExcluded: restoring?.initialExcluded ?? state.initialExcluded,
          error: errorMessage(report.reason),
        });
        return;
      }
      fail(captured, report.reason);
      return;
    }
    if (files.status === "rejected") {
      fail(captured, files.reason);
      return;
    }
    accessChecks.clear();
    if (restoring?.report && (reportDirty(restoring) || restoring.originals.length)) {
      const previous = restoring.report,
        latest = report.value;
      const unchanged =
        previous.id === latest.id &&
        previous.revision === latest.revision &&
        previous.content === latest.content &&
        previous.maskIdentifiers === latest.maskIdentifiers &&
        equalIds(previous.excludedFileIds, latest.excludedFileIds) &&
        equalIds(previous.includedPhotoIds ?? [], latest.includedPhotoIds ?? []);
      parked = undefined;
      publish({
        ...restoring,
        gate: "ready",
        canWrite: permission,
        files: files.value,
        report: unchanged ? latest : previous,
        busy: null,
        download: null,
        confirm: null,
        reviewed: false,
        originalsAcknowledged: false,
        error: null,
        conflict: restoring.conflict || !unchanged || latest.stale,
        notice: unchanged
          ? "계정과 저장 상태를 다시 확인하고 편집을 복원했어요."
          : "복귀 중 저장 버전이 바뀌었어요. 원래 입력은 보존했어요. 내용을 확인한 뒤 저장 상태를 다시 불러와 주세요.",
      });
      return;
    }
    parked = undefined;
    publish({ ...state, files: files.value });
    accept(report.value);
  }
  function observe() {
    const session = dependencies.session.getSnapshot(),
      next = access(session);
    if (next.gate !== "ready") {
      if (state.download) retired.add(state.download.value);
      if (next.gate === "checking" && session.phase !== "authorizing") {
        if (state.gate === "ready" && owner && (state.report || state.initialLimit))
          parked = { owner, canWrite: permission, state: { ...state, busy: null, download: null } };
      } else {
        parked = undefined;
        owner = undefined;
      }
      retire();
      publish({ ...empty(), gate: next.gate });
      return;
    }
    if (state.gate === "ready" && owner === next.owner && permission === next.canWrite) return;
    for (const value of retired) void dependencies.discard(value).catch(() => {});
    retired.clear();
    discard();
    if (parked && (parked.owner !== next.owner || parked.canWrite !== next.canWrite))
      parked = undefined;
    owner = next.owner;
    permission = next.canWrite;
    publish({ ...empty(), gate: "ready", canWrite: permission });
    renew();
    void load();
  }
  const available = (write = false) =>
    active &&
    parsed.success &&
    state.gate === "ready" &&
    !state.busy &&
    client &&
    (!write || state.canWrite);
  const editable = () =>
    available(true) && state.report && !state.report.stale && !state.conflict && state.draft;
  function change(input: Partial<ReportSave>) {
    if (!editable() || !state.draft) return;
    discard();
    publish({
      ...state,
      draft: { ...state.draft, ...input },
      download: null,
      reviewed: false,
      error: null,
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      active = true;
      const unsubscribe = dependencies.session.subscribe(observe);
      observe();
      return () => {
        active = false;
        unsubscribe();
        retire();
        discard();
        for (const value of retired) void dependencies.discard(value).catch(() => {});
        retired.clear();
        parked = undefined;
        owner = undefined;
        publish(empty());
        void dependencies.clear().catch(() => {});
      };
    },
    refresh: () => load(),
    confirmReload: () => (state.confirm === "reload" ? load(true) : Promise.resolve()),
    cancelConfirm() {
      if (!state.busy) publish({ ...state, confirm: null });
    },
    change,
    exclude(id: string) {
      if (!state.files.some((file) => file.id === id) || !state.draft) return;
      const excluded = state.draft.excludedFileIds.includes(id)
        ? state.draft.excludedFileIds.filter((value) => value !== id)
        : [...state.draft.excludedFileIds, id];
      change({
        excludedFileIds: excluded,
        includedPhotoIds: (state.draft.includedPhotoIds ?? []).filter(
          (value) => !excluded.includes(value),
        ),
      });
      if (editable())
        publish({
          ...state,
          originals: state.originals.filter((value) => !excluded.includes(value)),
          originalsAcknowledged: false,
        });
    },
    photo(id: string) {
      if (
        !editable() ||
        !state.draft ||
        state.draft.maskIdentifiers ||
        state.draft.excludedFileIds.includes(id) ||
        !state.report?.photoCandidates?.some((photo) => photo.id === id)
      )
        return;
      const photos = state.draft.includedPhotoIds ?? [],
        selected = photos.includes(id);
      if (!selected && photos.length >= 12) return;
      change({
        includedPhotoIds: selected ? photos.filter((value) => value !== id) : [...photos, id],
      });
    },
    reviewed(value: boolean) {
      if (available() && !reportDirty(state) && state.report)
        publish({ ...state, reviewed: value });
    },
    originalSelection(id: string) {
      if (
        !available(true) ||
        !state.report ||
        state.report.stale ||
        !state.files.some((file) => file.id === id && file.status === "ready") ||
        state.report.excludedFileIds.includes(id)
      )
        return;
      publish({
        ...state,
        originals: state.originals.includes(id)
          ? state.originals.filter((value) => value !== id)
          : [...state.originals, id],
        originalsAcknowledged: false,
      });
    },
    acknowledgeOriginals(value: boolean) {
      if (available(true)) publish({ ...state, originalsAcknowledged: value });
    },
    async save() {
      if (!editable() || !client || !parsed.success || !state.report || !state.draft) return;
      const validation = reportSaveSchema.safeParse(state.draft);
      if (!validation.success) {
        publish({ ...state, error: "본문은 1~30,000자로 입력해 주세요." });
        return;
      }
      const api = client,
        captured = version,
        report = state.report,
        draft = validation.data;
      const exclusions = [...draft.excludedFileIds],
        split = draft.content !== report.content && !equalIds(exclusions, report.excludedFileIds);
      publish({ ...state, busy: "save", error: null });
      try {
        const saved = await api.reports.save(
          parsed.data,
          { ...draft, excludedFileIds: split ? report.excludedFileIds : exclusions },
          report.revision,
        );
        if (!current(captured)) return;
        accept(
          saved,
          split
            ? "본문 편집을 먼저 저장했어요. 자료 제외를 적용하려면 다시 저장하고 새로 구성된 본문을 확인해 주세요."
            : "검토 내용을 저장했어요. 전달 전 본문과 선택을 다시 확인해 주세요.",
        );
        if (split && state.draft)
          publish({ ...state, draft: { ...state.draft, excludedFileIds: exclusions } });
      } catch (error) {
        fail(captured, error);
      }
    },
    askGenerate() {
      if (available(true) && state.report) publish({ ...state, confirm: "generate" });
    },
    excludeInitial(id: string) {
      if (
        !available(true) ||
        !state.initialLimit ||
        state.report ||
        !state.files.some((file) => file.id === id)
      )
        return;
      publish({
        ...state,
        initialExcluded: state.initialExcluded.includes(id)
          ? state.initialExcluded.filter((value) => value !== id)
          : [...state.initialExcluded, id],
      });
    },
    async generateInitial() {
      if (
        !available(true) ||
        !client ||
        !parsed.success ||
        !state.initialLimit ||
        state.report ||
        !state.initialExcluded.length
      )
        return;
      const api = client,
        captured = version;
      publish({ ...state, busy: "generate", error: null });
      try {
        const report = await api.reports.generate(parsed.data, state.initialExcluded, null);
        if (current(captured))
          accept(
            report,
            "선택한 자료를 제외하고 첫 초안을 만들었어요. 내용과 출처를 검토해 주세요.",
          );
      } catch (error) {
        fail(captured, error);
      }
    },
    async generate() {
      if (
        !available(true) ||
        !client ||
        !parsed.success ||
        !state.report ||
        state.confirm !== "generate"
      )
        return;
      const api = client,
        captured = version,
        report = state.report;
      publish({ ...state, busy: "generate", error: null });
      try {
        const next = await api.reports.generate(
          parsed.data,
          state.draft?.excludedFileIds ?? report.excludedFileIds,
          report.revision,
        );
        if (current(captured))
          accept(next, "최신 사건 기준의 새 초안을 만들었어요. 내용과 선택을 다시 검토해 주세요.");
      } catch (error) {
        fail(captured, error);
      }
    },
    async download(kind: ExportKind) {
      if (!reportDownloadAllowed(state, kind) || !client || !state.report) return;
      const api = client,
        captured = version,
        report = state.report;
      discard();
      publish({ ...state, busy: "download", download: null, error: null });
      let value: PrivateDownload | undefined;
      try {
        value =
          kind === "zip"
            ? await api.reports.zip(report.id, state.originals)
            : await api.reports[kind](report.id);
        if (!current(captured)) {
          await dependencies.discard(value);
          return;
        }
        const extension = kind === "savedZip" ? "zip" : kind;
        publish({
          ...state,
          busy: null,
          report: kind === "pdf" ? { ...report, pdfAvailable: true } : state.report,
          download: {
            value,
            name: `BARO-${report.id}.${extension}`,
            mimeType: value.mimeType,
            label: `검토 버전 ${report.revision} ${extension.toUpperCase()}`,
          },
          notice:
            kind === "zip"
              ? "선택 원본 ZIP을 기기에 저장했어요. 보관된 패키지는 저장 상태를 다시 불러와 확인할 수 있어요."
              : "기기에 저장했어요. 열기·공유는 직접 선택해 주세요.",
        });
        value = undefined;
      } catch (error) {
        if (value) await dependencies.discard(value).catch(() => {});
        fail(captured, error);
      }
    },
    async openPhoto(id: string) {
      if (
        !available() ||
        !client ||
        !parsed.success ||
        !state.report?.photoCandidates?.some((photo) => photo.id === id)
      )
        return;
      const file = state.files.find((file) => file.id === id);
      if (!file) return;
      const api = client,
        captured = version;
      discard();
      publish({ ...state, busy: "photo", download: null, error: null });
      let value: PrivateDownload | undefined;
      try {
        value = await api.original(parsed.data, id);
        if (!current(captured)) {
          await dependencies.discard(value);
          return;
        }
        if (value.size !== file.sizeBytes)
          throw new ApiError("UNAVAILABLE", "원본 크기를 다시 확인해 주세요.");
        publish({
          ...state,
          busy: null,
          download: { value, name: file.name, mimeType: file.mimeType, label: "사진 현재 원본" },
        });
        value = undefined;
        await present("open");
      } catch (error) {
        if (value) await dependencies.discard(value).catch(() => {});
        fail(captured, error);
      }
    },
    present,
    cancel() {
      if (state.gate !== "ready") return;
      discard();
      renew();
      publish({
        ...state,
        download: null,
        busy: null,
        error: null,
        notice:
          "기기 요청을 중단했어요. 이미 접수된 서버 작업은 계속될 수 있어요. 같은 입력의 재시도로 결과를 확인해 주세요.",
      });
    },
  };
  async function present(mode: "open" | "share") {
    if (!available() || !state.download) return;
    const captured = version,
      download = state.download;
    publish({ ...state, busy: "present", error: null });
    try {
      await dependencies.present(download.value, mode, download, () => {
        if (!current(captured)) throw new ApiError("UNAUTHENTICATED", "계정을 다시 확인해 주세요.");
      });
      if (current(captured)) publish({ ...state, busy: null });
    } catch (error) {
      fail(captured, error);
    }
  }
}
export type ReportsModel = ReturnType<typeof createReportsModel>;
