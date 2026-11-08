import type { ReworkReportView } from "@baro/api-client";
import { Download, Pencil, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { apiMode } from "../../client/api/core";
import type { ReportView as BaseReportView, FileView } from "../../client/api/types";
import { isExplicitSignOut } from "../../client/session-events";
import type { V2ConversationActionRequest, V2ConversationState, V2Fact } from "../../contracts/v2";
import { reportPhotoIds } from "../../utils/report-markdown";
import { FollowUpResolution } from "../resolution/FollowUpResolution";
import { Button } from "../ui/button";
import { LoadingContent, Spinner } from "../ui/loading";
import { CaseWorkspaceFrame } from "../ui/workspace-frame";
import { CaseNavigation } from "../workspace/CaseNavigation";
import { EvidenceUpload } from "../workspace/EvidenceUpload";
import { ConfirmDialog } from "./ConfirmDialog";
import { downloadBlob, maskReportText } from "./download";
import { downloadReviewedReport } from "./download-reviewed";
import { ReportReading } from "./ReportReading";
import { withInlineReportPhotos } from "./review-sections";

type ReportView = BaseReportView & {
  basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string } | undefined;
  pdfAvailable?: boolean | undefined;
  analysisReview?: ReworkReportView["analysisReview"];
};

function reportReviewContent(value: ReportView) {
  return value.maskIdentifiers
    ? value.content
    : withInlineReportPhotos(
        value.content,
        (value.includedPhotoIds ?? []).map((id) => ({
          id,
          name: value.photoCandidates?.find((photo) => photo.id === id)?.name ?? "사건 사진",
        })),
      );
}

function preparationFailureText(code: string) {
  const messages: Record<string, string> = {
    MODEL_UNAVAILABLE: "분석 서비스를 지금 이용할 수 없어요. 저장된 사건은 보존돼요.",
    MODEL_SCHEMA_INVALID: "분석 결과가 검증을 통과하지 못했어요. 다시 준비해 주세요.",
    LEGAL_SOURCE_UNAVAILABLE: "공식 법률 자료의 원문을 확인하지 못했어요.",
    CITATION_INVALID: "법률 설명과 원문 인용이 일치하는지 확인하지 못했어요.",
    JOB_TIMEOUT: "처리 시간이 초과됐어요. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
    STORAGE_UNAVAILABLE: "리포트 저장을 완료하지 못했어요. 기존 리포트는 보존돼요.",
    CRYPTO_DECRYPT_FAILED: "저장한 자료를 확인하지 못했어요. 현재 상태를 다시 확인해 주세요.",
    FILE_PROCESSING_FAILED: "자료 처리를 완료하지 못했어요. 자료 상태를 확인해 주세요.",
    COVERAGE_INCOMPLETE: "자료의 처리 범위를 확인한 뒤 다시 준비해 주세요.",
    USER_QUOTA_EXCEEDED: "오늘의 AI 이용 한도에 도달했어요. 저장된 내용은 확인할 수 있어요.",
  };
  return messages[code] ?? "처리를 완료하지 못했어요. 저장된 내용은 보존돼요. 다시 시도해 주세요.";
}

export type ReportReviewProps = {
  caseId: string;
  embedded?: boolean;
  rework?: boolean;
  onChanged?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  /** A fresh, owner-checked body has been accepted and rendered. */
  onViewed?: (identity: { id: string; revision: number }) => void;
};
export function ReportReview({
  caseId,
  embedded = false,
  rework = false,
  onChanged,
  onDirtyChange,
  onBusyChange,
  onViewed,
}: ReportReviewProps) {
  const [report, setReport] = useState<ReportView | null>(null);
  const [files, setFiles] = useState<FileView[]>([]);
  const [content, setContent] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [includedPhotos, setIncludedPhotos] = useState<string[]>([]);
  const [maskIdentifiers, setMaskIdentifiers] = useState(false);
  const [busy, setBusy] = useState("");
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [cancelEdit, setCancelEdit] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [mockPhotos, setMockPhotos] = useState<{
    key: string;
    urls: Record<string, string>;
  } | null>(null);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessUnknown, setAccessUnknown] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [initialLimit, setInitialLimit] = useState(false);
  const [exportExhausted, setExportExhausted] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [preservedEdit, setPreservedEdit] = useState("");
  const [preparation, setPreparation] = useState<V2ConversationState | null>(null);
  const [actionMissing, setActionMissing] = useState<string[]>([]);
  const [newReportAvailable, setNewReportAvailable] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [resolutionDirty, setResolutionDirty] = useState(false);
  const [evidenceFacts, setEvidenceFacts] = useState<V2Fact[]>([]);
  const owner = useRef<string | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const focusRequest = useRef(0);
  const refreshStatus = useRef<() => void>(() => {});
  const preparationAttempt = useRef<V2ConversationActionRequest | null>(null);
  const reflectionAttempt = useRef<{
    fileId: string;
    expectedRevision: number;
    text: string;
    selectedFileIds: string[];
  } | null>(null);
  const acceptedBody = useRef<{ id: string; revision: number } | null>(null);
  const viewedIdentity = useRef("");
  const onViewedRef = useRef(onViewed);
  onViewedRef.current = onViewed;
  const readReport = useCallback(
    () =>
      rework
        ? api.rework.peekReport(caseId, { expectedOwner: owner.current ?? "" })
        : api.reports.get(caseId),
    [caseId, rework],
  );
  const readPreparation = useCallback(
    () =>
      rework
        ? api.rework.getConversation(caseId, { expectedOwner: owner.current ?? "" })
        : Promise.resolve(null),
    [caseId, rework],
  );
  const accept = useCallback((value: ReportView) => {
    acceptedBody.current = { id: value.id, revision: value.revision };
    const positioned = reportReviewContent(value);
    setReport({ ...value, content: positioned });
    setNewReportAvailable(false);
    setEditing(false);
    setIncludedPhotos(value.includedPhotoIds ?? []);
    setMaskIdentifiers(value.maskIdentifiers);

    setContent(positioned);

    setExcluded(value.excludedFileIds);

    setInitialLimit(false);
    setExportExhausted(false);
  }, []);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    owner.current = null;
    acceptedBody.current = null;
    viewedIdentity.current = "";
    setReport(null);
    setNeedsConsent(false);
    setInitialLimit(false);
    setExportExhausted(false);
    setFiles([]);
    setExportingPdf(false);
    setContent("");
    setPreservedEdit("");
    setPreparation(null);
    setActionMissing([]);
    setNewReportAvailable(false);
    setPollPaused(false);
    preparationAttempt.current = null;
    reflectionAttempt.current = null;
    setEvidenceBusy(false);
    setEvidenceDirty(false);
    setResolutionBusy(false);
    setResolutionDirty(false);
    setEvidenceFacts([]);
    setEditing(false);

    setExcluded([]);
    setIncludedPhotos([]);
    setMaskIdentifiers(false);

    setRegenerate(false);
    setReloadConfirm(false);
    setCancelEdit(false);
    setMockPhotos(null);

    setAccessChecking(false);
    setAccessUnknown(false);
    setBusy("");
    setBusyStartedAt(null);
  }, []);
  useEffect(() => {
    setElapsedSeconds(0);
    if (busyStartedAt === null) return;
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.max(0, Math.floor((performance.now() - busyStartedAt) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busyStartedAt]);
  const verifyOwner = useCallback(
    async (isCurrent?: () => boolean) => {
      const sequence = loadSequence.current;
      const current = isCurrent ?? (() => sequence === loadSequence.current);
      const superseded = () =>
        Object.assign(new Error("접근 확인 요청이 갱신됐어요."), {
          code: "OWNER_CHECK_SUPERSEDED",
        });
      let session: Awaited<ReturnType<typeof api.session.get>>;
      try {
        session = await api.session.get();
      } catch (e) {
        if (!current()) throw superseded();
        setAccessUnknown(true);
        throw e;
      }
      if (!current()) throw superseded();
      const id = session.user?.id;
      if (!id || (owner.current && owner.current !== id)) {
        clearOwnerState();
        throw Object.assign(
          new Error("계정 또는 접근 상태가 변경됐어요. 로그인 후 리포트를 다시 확인해 주세요."),
          {
            ownerRevoked: true,
            code: !id ? "UNAUTHENTICATED" : "NOT_FOUND",
          },
        );
      }
      setNeedsConsent(session.needsConsent);
      setAccessUnknown(false);
      owner.current = id;
      return id;
    },
    [clearOwnerState],
  );
  const mockPhotoIds = JSON.stringify(maskIdentifiers ? [] : (report?.includedPhotoIds ?? []));
  useEffect(() => {
    const screen = window.matchMedia("(min-width: 768px)");
    const update = () => setToolsOpen(screen.matches);
    update();
    screen.addEventListener("change", update);
    return () => screen.removeEventListener("change", update);
  }, []);
  const mockPhotoKey = `${report?.id ?? ""}:${report?.revision ?? 0}:${mockPhotoIds}`;
  useEffect(() => {
    if (apiMode !== "mock" || !report?.id) return;
    setMockPhotos(null);
    let active = true;
    const sequence = loadSequence.current;
    const current = () => active && sequence === loadSequence.current;
    const ids = JSON.parse(mockPhotoIds) as string[];
    if (ids.length > 12) return;
    void (async () => {
      const urls: Record<string, string> = {};
      let total = 0;
      await verifyOwner(current);
      for (const id of ids) {
        const blob = await api.files.original(caseId, id);
        await verifyOwner(current);
        total += blob.size;
        if (
          blob.size > 5_000_000 ||
          total > 8_000_000 ||
          !/^image\/(jpeg|png|webp)$/.test(blob.type)
        )
          throw new Error("REPORT_PHOTO_LIMIT");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!current()) return;
        let raw = "";
        for (let offset = 0; offset < bytes.length; offset += 8192)
          raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        urls[id] = `data:${blob.type};base64,${btoa(raw)}`;
      }
      await verifyOwner(current);
      if (current()) setMockPhotos({ key: mockPhotoKey, urls });
    })().catch(() => {
      if (current()) setMockPhotos(null);
    });
    return () => {
      active = false;
    };
  }, [caseId, report?.id, mockPhotoIds, mockPhotoKey, verifyOwner]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setAccessChecking(true);
    setBusy("리포트 확인 중…");
    setBusyStartedAt(performance.now());
    setError("");
    try {
      await verifyOwner(() => sequence === loadSequence.current);
      const [value, materials, state] = await Promise.allSettled([
        readReport(),
        api.files.list(caseId, { metadataOnly: true }),
        readPreparation(),
      ]);
      await verifyOwner(() => sequence === loadSequence.current);
      if (sequence !== loadSequence.current) return;
      if (materials.status === "fulfilled") setFiles(materials.value);
      if (value.status === "rejected") {
        if (value.reason?.code === "EXPORT_LIMIT_EXCEEDED" && materials.status === "fulfilled")
          setInitialLimit(true);
        throw value.reason;
      }
      if (materials.status === "rejected") throw materials.reason;
      if (state.status === "rejected") throw state.reason;
      setPreparation(state.value);
      if (value.value) accept(value.value);
      else {
        setReport(null);
        setContent("");
      }
    } catch (e) {
      const failure = e as { code?: string; ownerRevoked?: boolean };
      if (
        failure?.code === "OWNER_CHECK_SUPERSEDED" ||
        (sequence !== loadSequence.current && !failure?.ownerRevoked)
      )
        return;
      if ((e as { code?: string })?.code === "EXPORT_RETRY_EXHAUSTED") setExportExhausted(true);
      if ((e as { code?: string })?.code === "CONSENT_REQUIRED") setNeedsConsent(true);
      if (
        [
          "UNAUTHENTICATED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      )
        if (!failure?.ownerRevoked) clearOwnerState();
      setError(e instanceof Error ? e.message : "리포트를 확인하지 못했어요.");
    } finally {
      if (sequence === loadSequence.current) {
        setBusy("");
        setBusyStartedAt(null);
        setAccessChecking(false);
      }
    }
  }, [caseId, accept, clearOwnerState, verifyOwner, readReport, readPreparation]);
  useEffect(() => {
    // Passive focus metadata can advance a revision without replacing the local
    // draft. Only the exact body accepted by load/save/readback counts as viewed.
    if (
      !report ||
      report.caseId !== caseId ||
      report.stale ||
      !owner.current ||
      accessChecking ||
      accessUnknown ||
      busy ||
      acceptedBody.current?.id !== report.id ||
      acceptedBody.current.revision !== report.revision ||
      !onViewedRef.current
    )
      return;
    const key = JSON.stringify([owner.current, report.id, report.revision]);
    if (viewedIdentity.current === key) return;
    viewedIdentity.current = key;
    onViewedRef.current({ id: report.id, revision: report.revision });
  }, [caseId, report, accessChecking, accessUnknown, busy]);
  useEffect(() => {
    clearOwnerState();
    void load();
    let pendingStatus: { sequence: number; request: number } | null = null;
    const check = (event: Event) => {
      if (isExplicitSignOut(event)) {
        clearOwnerState();
        setError("로그인 후 리포트를 다시 확인해 주세요.");
        return;
      }
      if (document.visibilityState === "hidden") return;
      const sequence = loadSequence.current;
      // A slow metadata read must finish before the next ordinary poll. Starting
      // a fresh fence every four seconds otherwise supersedes every response.
      // Focus/session/storage events retain their existing fresh owner checks.
      if (event.type === "report-status" && pendingStatus?.sequence === sequence) return;
      const request = ++focusRequest.current;
      const pending = { sequence, request };
      pendingStatus = pending;
      const current = () => sequence === loadSequence.current && request === focusRequest.current;
      setAccessChecking(true);
      void (async () => {
        await verifyOwner(current);
        if (!current() || lock.current) return;
        const [value, materials, state] = await Promise.all([
          readReport(),
          api.files.list(caseId, { metadataOnly: true }),
          readPreparation(),
        ]);
        await verifyOwner(current);
        if (!current()) return;
        setPreparation(state);
        setReport((existing) => {
          if (!value) return null;
          if (!existing) {
            setNewReportAvailable(true);
            return existing;
          }
          if (existing.id !== value.id) {
            setNewReportAvailable(true);
            return { ...existing, stale: true };
          }
          // Match initial acceptance without replacing the retained editor.
          // Raw server text lacks automatically positioned photo tokens.
          return { ...value, content: reportReviewContent(value) };
        });
        setFiles(materials);
        setIncludedPhotos((ids) =>
          ids.filter((id) => materials.some((file) => file.id === id && file.status === "ready")),
        );

        // Content, inline photos and exclusions intentionally stay in the editor.
      })()
        .catch((e: unknown) => {
          const failure = e as { code?: string; ownerRevoked?: boolean };
          if (
            request !== focusRequest.current ||
            failure?.code === "OWNER_CHECK_SUPERSEDED" ||
            (!current() && !failure?.ownerRevoked)
          )
            return;
          if (
            [
              "UNAUTHENTICATED",
              "NOT_FOUND",
              "FORBIDDEN",
              "ROLE_REQUIRED",
              "ORIGIN_NOT_ALLOWED",
            ].includes((e as { code?: string })?.code ?? "")
          )
            if (!failure?.ownerRevoked) clearOwnerState();
          setError(e instanceof Error ? e.message : "로그인 상태를 다시 확인해 주세요.");
        })
        .finally(() => {
          if (pendingStatus === pending) pendingStatus = null;
          if (current()) setAccessChecking(false);
        });
    };
    refreshStatus.current = () => check(new Event("report-status"));
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    window.addEventListener("baro-session-changed", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      ++loadSequence.current;
      refreshStatus.current = () => {};
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      window.removeEventListener("baro-session-changed", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, clearOwnerState, verifyOwner, caseId, readReport, readPreparation]);
  const pendingJob = preparation?.report.currentJobId ?? preparation?.analysis.currentJobId;
  useEffect(() => {
    setPollPaused(false);
    if (!rework || !pendingJob) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      if (attempts++ >= 60) {
        window.clearInterval(timer);
        setPollPaused(true);
        return;
      }
      refreshStatus.current();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [rework, pendingJob]);
  const dirty = Boolean(
    report &&
      (content !== report.content ||
        maskIdentifiers !== report.maskIdentifiers ||
        JSON.stringify(includedPhotos) !== JSON.stringify(report.includedPhotoIds ?? []) ||
        JSON.stringify(excluded) !== JSON.stringify(report.excludedFileIds)),
  );
  const photoCandidates = (report?.photoCandidates ?? [])
    .filter((photo) => !excluded.includes(photo.id))
    .map((photo) => ({
      ...photo,
      byteLength: files.find((file) => file.id === photo.id)?.sizeBytes ?? 0,
    }));
  useEffect(() => {
    onDirtyChange?.(dirty || Boolean(preservedEdit) || evidenceDirty || resolutionDirty);
    return () => onDirtyChange?.(false);
  }, [dirty, preservedEdit, evidenceDirty, resolutionDirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(
      Boolean(busy) || accessChecking || exportingPdf || evidenceBusy || resolutionBusy,
    );
    return () => onBusyChange?.(false);
  }, [busy, accessChecking, exportingPdf, evidenceBusy, resolutionBusy, onBusyChange]);
  useEffect(() => {
    if (!dirty && !preservedEdit && !evidenceDirty && !resolutionDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, preservedEdit, evidenceDirty, resolutionDirty]);
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current || accessChecking || evidenceBusy || evidenceDirty) return false;
    const sequence = loadSequence.current;
    lock.current = true;
    setBusy("계정 접근 상태 확인 중…");
    setBusyStartedAt(performance.now());
    setError("");

    try {
      await verifyOwner();
      setBusy(label);
      await action();
      return true;
    } catch (e) {
      const failure = e as { code?: string; ownerRevoked?: boolean };
      if (
        failure?.code === "OWNER_CHECK_SUPERSEDED" ||
        (sequence !== loadSequence.current && !failure?.ownerRevoked)
      )
        return;
      if ((e as { code?: string })?.code === "EXPORT_RETRY_EXHAUSTED") setExportExhausted(true);
      if ((e as { code?: string })?.code === "EXPORT_LIMIT_EXCEEDED" && !report)
        setInitialLimit(true);
      if ((e as { code?: string })?.code === "CONSENT_REQUIRED") setNeedsConsent(true);
      if (
        [
          "UNAUTHENTICATED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      ) {
        if (!failure?.ownerRevoked) clearOwnerState();
      }
      setError(e instanceof Error ? e.message : "처리하지 못했어요. 다시 시도해 주세요.");
      return false;
    } finally {
      lock.current = false;
      if (sequence === loadSequence.current) {
        setBusy("");
        setBusyStartedAt(null);
      }
    }
  }
  async function ownedResult<T>(work: Promise<T>) {
    const sequence = loadSequence.current;
    const value = await work;
    if (sequence === loadSequence.current) setBusy("접근 권한 다시 확인 중…");
    await verifyOwner(() => sequence === loadSequence.current);
    return value;
  }
  async function save() {
    if (!report) throw new Error("리포트를 다시 확인해 주세요.");
    const value = await ownedResult(
      api.reports.save(
        caseId,
        {
          content,
          maskIdentifiers,
          includedPhotoIds: includedPhotos.filter((id) => !excluded.includes(id)),
          excludedFileIds: excluded,
        },
        report.revision,
      ),
    );
    const latest = rework ? await ownedResult(readReport()) : value;
    if (!latest || latest.id !== value.id)
      throw new Error("저장된 리포트 버전이 바뀌었어요. 저장 상태를 다시 확인해 주세요.");
    accept(latest);
    onChanged?.();
    return latest;
  }
  async function prepareReport() {
    const state = await ownedResult(readPreparation());
    if (!state) throw new Error("사건 준비 상태를 다시 확인해 주세요.");
    setPreparation(state);
    if (!preparationAttempt.current)
      preparationAttempt.current = {
        action: "prepare_report",
        expectedRevision: state.workspaceRevision,
        requestId: crypto.randomUUID(),
      };
    const attempt = preparationAttempt.current;
    let result: Awaited<ReturnType<typeof api.rework.executeAction>>;
    try {
      result = await ownedResult(
        api.rework.executeAction(caseId, attempt, { expectedOwner: owner.current ?? "" }),
      );
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (
        preparationAttempt.current === attempt &&
        [
          "CONFLICT",
          "STALE_REVISION",
          "VALIDATION_ERROR",
          "IDEMPOTENCY_CONFLICT",
          "CONSENT_REQUIRED",
          "QUOTA_EXCEEDED",
          "USER_QUOTA_EXCEEDED",
          "RATE_LIMITED",
          "INVALID_STATE",
          "ROLE_REQUIRED",
          "REVIEW_REQUIRED",
        ].includes(code ?? "")
      )
        preparationAttempt.current = null;
      throw cause;
    }
    // Admission can advance the case before its ACK arrives. Replay the entire
    // original request after an ambiguous failure, including expectedRevision.
    // A confirmed receipt/rejection ends it; a later explicit attempt is new.
    if (preparationAttempt.current === attempt) preparationAttempt.current = null;
    setActionMissing(result.missingItems);
    if (result.status === "blocked" || result.status === "require_confirmation") {
      setPreparation(await ownedResult(readPreparation()));
      if (regenerate)
        setError(result.missingItems.join(" ") || "먼저 사건과 자료를 확인해 주세요.");
      return false;
    }
    await load();
    onChanged?.();
    return true;
  }
  async function evidenceChanged() {
    const sequence = loadSequence.current;
    const current = () => sequence === loadSequence.current;
    await verifyOwner(current);
    const [latest, materials, state] = await Promise.all([
      readReport(),
      api.files.list(caseId, { metadataOnly: true }),
      readPreparation(),
    ]);
    await verifyOwner(current);
    if (!current()) return;
    setFiles(materials);
    setPreparation(state);
    setReport((existing) =>
      !existing
        ? existing
        : latest?.id === existing.id
          ? { ...existing, stale: latest.stale }
          : { ...existing, stale: true },
    );
    onChanged?.();
  }
  async function reflectEvidence(fileId: string) {
    if (lock.current || accessChecking || dirty) return false;
    const sequence = loadSequence.current;
    lock.current = true;
    setBusy("자료의 사건 반영 요청 중…");
    setBusyStartedAt(performance.now());
    try {
      await verifyOwner();
      const current = await ownedResult(api.workspace.get(caseId));
      setEvidenceFacts(current.facts ?? []);
      if (!reflectionAttempt.current || reflectionAttempt.current.fileId !== fileId)
        reflectionAttempt.current = {
          fileId,
          expectedRevision: current.case.revision,
          selectedFileIds: [fileId],
          text: "선택한 자료의 포함된 관찰을 검토하고 출처와 위치를 유지하며 이 사건의 사실과 경위에 반영해 주세요. 사용자 교정과 미확인 사항을 구분하고 자료에 없는 내용은 추정하지 마세요.",
        };
      const { fileId: _, ...input } = reflectionAttempt.current;
      const result = await ownedResult(api.workspace.sendMessage(caseId, input));
      reflectionAttempt.current = null;
      setEvidenceFacts(result.facts ?? []);
      await evidenceChanged();
      return true;
    } finally {
      lock.current = false;
      if (sequence === loadSequence.current) {
        setBusy("");
        setBusyStartedAt(null);
      }
    }
  }
  async function downloadCurrentReport(): Promise<void> {
    if (!report || exportingPdf) throw new Error("다운로드할 리포트를 다시 확인해 주세요.");
    setExportingPdf(true);
    try {
      const succeeded = await run("PDF 준비 중…", async () => {
        const value = dirty ? await save() : report;
        if (rework && !(value.stale && value.pdfAvailable)) {
          const sequence = loadSequence.current;
          await downloadReviewedReport(
            {
              caseId,
              reportId: value.id,
              reportRevision: value.revision,
              expectedOwner: owner.current ?? "",
              verify: async () => {
                setBusy("접근 권한 다시 확인 중…");
                await verifyOwner(() => sequence === loadSequence.current);
              },
            },
            {
              session: () => api.session.get(),
              peekReport: api.rework.peekReport,
              pdf: async (id) => {
                setBusy("PDF 준비 중…");
                return api.reports.pdf(id);
              },
            },
          );
        } else {
          // Historical stored bytes and installed-client behavior keep their
          // existing owner/deletion fence, without silently selecting a new ID.
          const blob = await ownedResult(api.reports.pdf(value.id));
          downloadBlob(blob, `BARO-${value.id}.pdf`);
        }
        setReport((current) =>
          current?.id === value.id ? { ...current, pdfAvailable: true } : current,
        );
      });
      if (!succeeded)
        throw new Error(
          "PDF 저장 요청을 완료하지 못했어요. 리포트의 오류와 접근 상태를 확인해 주세요.",
        );
    } finally {
      setExportingPdf(false);
    }
  }
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  const progressText = `${busy || "계정 접근 상태 확인 중…"}${busyStartedAt !== null ? ` · 요청 시작 후 ${elapsedSeconds}초` : ""}`;
  const initialLoading = !report && !error && Boolean(busy || accessChecking);
  const editingBlocked =
    Boolean(busy) ||
    exportingPdf ||
    accessChecking ||
    accessUnknown ||
    needsConsent ||
    evidenceBusy ||
    evidenceDirty ||
    resolutionBusy ||
    resolutionDirty;
  const displayTitle = report
    ? maskIdentifiers
      ? maskReportText(report.title)
      : report.title
    : "내 사건 이해와 해결 준비";
  const reportDocument = (
    <div
      className={`report-review report-workspace${embedded ? " report-embedded" : ""}`}
      aria-busy={Boolean(busy) || accessChecking}
    >
      <div className="report-canvas">
        <header className="report-heading">
          {!embedded && (
            <div className="report-heading-copy">
              {report && displayTitle !== "내 사건 이해와 해결 준비" && (
                <p className="report-eyebrow">내 사건 이해와 해결 준비</p>
              )}
              <h2>{displayTitle}</h2>
              <p>핵심 쟁점과 지금 준비할 일을 살펴보고, 필요한 내용을 고쳐 보관하세요.</p>
            </div>
          )}
          {report && (
            <fieldset className="report-heading-actions" aria-label="리포트 작업">
              {editing && (
                <>
                  <button
                    type="button"
                    disabled={editingBlocked}
                    onClick={() => {
                      if (dirty) setCancelEdit(true);
                      else setEditing(false);
                    }}
                  >
                    편집 취소
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={editingBlocked || !dirty || report.stale}
                    onClick={() =>
                      void run("수정 내용 저장 중…", async () => {
                        await save();
                        setEditing(false);
                      })
                    }
                  >
                    <Save size={16} aria-hidden="true" />
                    수정 내용 저장
                  </button>
                </>
              )}
              {!editing && (
                <>
                  <button
                    type="button"
                    className="report-edit-toggle"
                    disabled={
                      Boolean(busy) ||
                      accessChecking ||
                      accessUnknown ||
                      needsConsent ||
                      evidenceBusy ||
                      evidenceDirty ||
                      resolutionBusy ||
                      resolutionDirty
                    }
                    aria-expanded={editing}
                    aria-controls="report-edit-fields"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    수정하기
                  </button>
                  <button
                    type="button"
                    className="report-regenerate primary"
                    disabled={
                      Boolean(busy) ||
                      accessChecking ||
                      accessUnknown ||
                      needsConsent ||
                      evidenceBusy ||
                      evidenceDirty ||
                      resolutionBusy ||
                      resolutionDirty ||
                      Boolean(preservedEdit && dirty && report.stale)
                    }
                    onClick={() => setRegenerate(true)}
                  >
                    새 버전 만들기
                  </button>
                </>
              )}
            </fieldset>
          )}
        </header>
        {!initialLoading && (busy || accessChecking) && (
          <p role="status" className="report-progress">
            <Spinner />
            {progressText}
          </p>
        )}
        {initialLoading && <LoadingContent layout="detail" title="리포트를 불러오고 있어요." />}
        {rework &&
          preparation &&
          (!report ||
            preparation.analysis.status !== "ready" ||
            preparation.report.status === "pending" ||
            preparation.report.status === "failed" ||
            actionMissing.length > 0) && (
            <section
              className={`report-preparation${report ? " report-preparation--compact" : ""}`}
              aria-label="리포트 준비 상태"
              aria-live="polite"
            >
              <details open={!report || Boolean(pendingJob)}>
                <summary>
                  <h3>
                    {preparation.report.status === "pending"
                      ? "리포트를 준비하고 있어요"
                      : preparation.report.status === "failed"
                        ? "새 리포트를 완성하지 못했어요"
                        : {
                            not_started: "현재 사건의 법률 분석을 준비해요",
                            pending: "법률 분석을 준비하고 있어요",
                            running: "법 조항과 판례를 확인하고 있어요",
                            ready: "검증한 분석으로 리포트를 준비할 수 있어요",
                            partial: "확인된 분석과 보완할 항목이 있어요",
                            empty: "조사한 범위에서 관련 결과를 찾지 못했어요",
                            unavailable: "공식 자료를 확인하지 못했어요",
                            failed: "분석을 완료하지 못했어요",
                            stale: "사건과 자료 변경을 반영해야 해요",
                          }[preparation.analysis.status]}
                  </h3>
                </summary>
                <p>최신 사건과 자료를 확인한 뒤 리포트를 만들어요.</p>
                {preparation.report.failure && (
                  <p>리포트 준비 실패 · {preparationFailureText(preparation.report.failure)}</p>
                )}
                {preparation.analysis.failure && (
                  <p>분석 실패 · {preparationFailureText(preparation.analysis.failure)}</p>
                )}
                {[...new Set([...preparation.analysis.missingItems, ...actionMissing])].length >
                  0 && (
                  <ul>
                    {[...new Set([...preparation.analysis.missingItems, ...actionMissing])].map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                )}
                {pollPaused && <p>처리가 계속되고 있을 수 있어요. 상태를 다시 확인해 주세요.</p>}
                <div className="report-preparation-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      Boolean(busy) ||
                      accessChecking ||
                      needsConsent ||
                      Boolean(pendingJob) ||
                      evidenceBusy ||
                      evidenceDirty ||
                      resolutionBusy ||
                      resolutionDirty
                    }
                    onClick={() =>
                      void run("리포트 준비 요청 중…", async () => {
                        await prepareReport();
                      })
                    }
                  >
                    리포트 준비
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || accessChecking}
                    onClick={() => refreshStatus.current()}
                  >
                    상태 확인
                  </button>
                </div>
              </details>
            </section>
          )}
        {newReportAvailable && (
          <section className="report-callout" role="status">
            <p>
              {dirty
                ? "새 리포트가 준비됐어요. 저장하지 않은 편집 내용을 확인한 뒤 전환하세요."
                : "새 리포트가 준비됐어요. 새 버전을 열어 내용을 확인하세요."}
            </p>
            <button
              type="button"
              disabled={
                Boolean(busy) ||
                accessChecking ||
                evidenceBusy ||
                evidenceDirty ||
                resolutionBusy ||
                resolutionDirty
              }
              onClick={() => (dirty ? setReloadConfirm(true) : void load())}
            >
              새 리포트 열기
            </button>
          </section>
        )}
        {error && !regenerate && !reloadConfirm && (
          <div className="report-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              disabled={
                Boolean(busy) || evidenceBusy || evidenceDirty || resolutionBusy || resolutionDirty
              }
              onClick={(event) => {
                event.currentTarget.focus();
                if (dirty) setReloadConfirm(true);
                else void load();
              }}
            >
              다시 확인
            </button>
            <a href="/login">로그인</a>
          </div>
        )}
        {initialLimit && !report && !accessChecking && (
          <section className="report-options-body" aria-label="리포트 처리 한도 복구">
            <h2>자료를 줄여 첫 리포트를 만들어요</h2>
            <p>리포트에서 제외할 자료를 선택하세요. 원본은 그대로 보관돼요.</p>
            {files.map((file) => (
              <label key={file.id} className="report-check">
                <input
                  type="checkbox"
                  checked={excluded.includes(file.id)}
                  disabled={Boolean(busy) || needsConsent}
                  onChange={() => setExcluded(toggle(excluded, file.id))}
                />
                {file.name} · 리포트에서 제외
              </label>
            ))}
            <button
              type="button"
              disabled={Boolean(busy) || needsConsent || !excluded.length}
              onClick={() =>
                void run("리포트 생성 중…", async () => {
                  const value = await ownedResult(api.reports.generate(caseId, excluded));
                  accept(value);
                  setBusy("자료 목록 확인 중…");
                  setFiles(await ownedResult(api.files.list(caseId, { metadataOnly: true })));
                })
              }
            >
              선택 자료를 제외하고 생성
            </button>
          </section>
        )}
        {report && (
          <fieldset
            className="report-controls"
            disabled={
              Boolean(busy) ||
              accessChecking ||
              accessUnknown ||
              evidenceBusy ||
              evidenceDirty ||
              resolutionBusy ||
              resolutionDirty
            }
          >
            {needsConsent && (
              <p className="report-callout" role="status">
                새 리포트 생성과 수정은 필수 동의 후 이용할 수 있어요. 기존 리포트와 저장된
                PDF·ZIP은 계속 확인할 수 있어요. <a href="/consent">동의 확인</a>
              </p>
            )}
            <section
              className={`report-snapshot${report.stale ? " report-snapshot--stale" : ""}`}
              aria-label="리포트 생성 기준"
            >
              <strong>
                {report.stale
                  ? "과거 기준의 리포트"
                  : report.analysisReview?.userEdited
                    ? "사용자가 수정한 리포트 · 원문 재확인 필요"
                    : report.analysisReview?.status === "ready"
                      ? "검증된 분석으로 준비한 리포트"
                      : "사건 리포트 · 분석 상태와 보완 항목을 확인해 주세요"}
              </strong>
              <span className="report-save-state">
                버전 {report.revision} · {dirty ? "미저장 편집 있음" : "저장됨"}
                {!dirty &&
                  ` · ${new Date(report.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`}
              </span>
              <details className="report-basis-details">
                <summary>작성 기준{report.stale ? " · 현재 사건과 다름" : ""}</summary>
                <p>
                  {report.basis
                    ? `요약 ${report.basis.summaryRevision} · 사건 ${report.basis.workspaceRevision} · `
                    : ""}
                  {new Date(report.basis?.generatedAt ?? report.updatedAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  기준
                </p>
                {report.stale && (
                  <p>
                    이후 사건·증거·분석 변경은 이 리포트를 바꾸지 않습니다. 최신 내용을 반영하려면
                    새 버전을 만들어 주세요.
                  </p>
                )}
              </details>
            </section>
            <details
              className="report-current-tools-menu"
              open={toolsOpen}
              onToggle={(event) => setToolsOpen(event.currentTarget.open)}
            >
              <summary>현재 사건에서 더 준비하기</summary>
              <nav className="report-current-tools" aria-label="현재 사건에서 더 준비하기">
                <p>
                  현재 사건에서 더 준비하기 <span>변경한 내용은 새 리포트에서 반영해요.</span>
                </p>
                <a href={`/cases/${encodeURIComponent(caseId)}/files`}>자료와 원본 확인</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/actions`}>현재 할 일 관리</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/timeline`}>현재 경위 정리</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/precedents`}>현재 판례 탐색</a>
              </nav>
            </details>
            {preservedEdit && (
              <details className="report-preserved-edit">
                <summary>새 버전을 만들기 전의 편집 내용 보관</summary>
                <p>
                  저장하지 않았던 내용을 이 화면에 보관했어요. 필요한 내용을 새 리포트에 옮겨
                  주세요.
                </p>
                <textarea aria-label="보관한 리포트 편집 내용" readOnly value={preservedEdit} />
                <button
                  type="button"
                  onClick={() => {
                    downloadBlob(
                      new Blob([preservedEdit], { type: "text/plain;charset=utf-8" }),
                      `BARO-${report.id}-편집보관.txt`,
                    );
                    setPreservedEdit("");
                  }}
                >
                  보관한 편집 내용 저장
                </button>
              </details>
            )}
            {(rework || report.analysisReview) && (
              <details className="report-scope">
                <summary>포함할 자료와 식별정보 가림</summary>
                <p>
                  본문 수정을 먼저 저장한 뒤 범위를 바꾸세요. 제외 자료에 의존하는 법률 분석과 판례
                  비교도 새 리포트에서 다시 검토합니다.
                </p>
                <label className="report-check">
                  <input
                    type="checkbox"
                    checked={maskIdentifiers}
                    disabled={needsConsent || report.stale || content !== report.content}
                    onChange={(event) => setMaskIdentifiers(event.target.checked)}
                  />
                  식별정보 가리기
                </label>
                <p>
                  전화번호·이메일·주민등록번호 형태의 식별정보를 가립니다. 이름·주소와 원본은 직접
                  확인해 주세요. 가림을 켜면 선택 사진을 통째로 제외합니다.
                </p>
                {files.map((file) => (
                  <label className="report-check" key={file.id}>
                    <input
                      type="checkbox"
                      checked={excluded.includes(file.id)}
                      disabled={needsConsent || report.stale || content !== report.content}
                      onChange={() => setExcluded(toggle(excluded, file.id))}
                    />
                    {file.name} · 리포트에서 제외
                  </label>
                ))}
                <button
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    needsConsent ||
                    report.stale ||
                    content !== report.content ||
                    (maskIdentifiers === report.maskIdentifiers &&
                      JSON.stringify(excluded) === JSON.stringify(report.excludedFileIds))
                  }
                  onClick={() =>
                    void run("선택 범위 저장 중…", async () => {
                      await save();
                    })
                  }
                >
                  선택 범위 저장
                </button>
              </details>
            )}
            <section className="report-read-content" aria-label="리포트 검토 본문">
              <div id="report-edit-fields">
                <ReportReading
                  content={maskIdentifiers && !editing ? maskReportText(content) : content}
                  editing={editing}
                  disabled={Boolean(busy) || needsConsent}
                  reportId={report.id}
                  photoUrls={
                    apiMode === "mock"
                      ? mockPhotos?.key === mockPhotoKey
                        ? mockPhotos.urls
                        : {}
                      : undefined
                  }
                  photoCandidates={maskIdentifiers ? [] : photoCandidates}
                  savedPhotoIds={maskIdentifiers ? [] : (report.includedPhotoIds ?? [])}
                  onChange={(next) => {
                    setContent(next);
                    setIncludedPhotos(reportPhotoIds(next));
                  }}
                />
              </div>
            </section>
            <section className="report-export" aria-label="리포트 다운로드">
              {exportExhausted && (
                <div className="report-callout">
                  <p>다운로드 재시도를 모두 사용했어요. 새 버전으로 다시 준비해 주세요.</p>
                  <button
                    type="button"
                    disabled={Boolean(busy) || needsConsent || report.stale || !content.trim()}
                    onClick={() =>
                      void run("다운로드 버전 준비 중…", async () => {
                        await save();
                      })
                    }
                  >
                    새 버전으로 다시 준비
                  </button>
                </div>
              )}
              <div className="report-actions">
                <button
                  type="button"
                  className="primary"
                  title={
                    report.stale && (!report.pdfAvailable || dirty)
                      ? "새 버전 만들기로 최신 사건을 반영한 뒤 다운로드하세요."
                      : needsConsent && dirty
                        ? "필수 동의를 확인한 뒤 수정 내용을 저장할 수 있어요."
                        : undefined
                  }
                  disabled={
                    Boolean(busy) ||
                    exportingPdf ||
                    !content.trim() ||
                    ((report.stale || needsConsent) && (!report.pdfAvailable || dirty))
                  }
                  onClick={() => {
                    void downloadCurrentReport().catch(() => {});
                  }}
                >
                  {exportingPdf ? <Spinner /> : <Download size={16} aria-hidden="true" />}
                  {exportingPdf ? "PDF 만드는 중…" : "PDF 다운로드"}
                </button>
              </div>
            </section>
          </fieldset>
        )}
        {rework && report && owner.current && (
          <FollowUpResolution
            caseId={caseId}
            reportId={report.id}
            reportRevision={report.revision}
            embedded={embedded}
            disabled={
              Boolean(busy) ||
              accessChecking ||
              accessUnknown ||
              dirty ||
              evidenceBusy ||
              evidenceDirty ||
              exportingPdf
            }
            onSaveReport={downloadCurrentReport}
            onChanged={() => {
              void evidenceChanged().catch((cause: unknown) => {
                setError(
                  cause instanceof Error ? cause.message : "현재 리포트 상태를 다시 확인해 주세요.",
                );
              });
            }}
            onDirtyChange={setResolutionDirty}
            onBusyChange={setResolutionBusy}
          />
        )}
        {rework && owner.current && (
          <details className="report-evidence-entry">
            <summary>자료 추가와 사건 반영</summary>
            <EvidenceUpload
              caseId={caseId}
              disabled={
                Boolean(busy) ||
                exportingPdf ||
                needsConsent ||
                dirty ||
                resolutionBusy ||
                resolutionDirty ||
                accessChecking ||
                accessUnknown
              }
              facts={evidenceFacts}
              onUploaded={evidenceChanged}
              onEvidenceChanged={evidenceChanged}
              onReflect={reflectEvidence}
              onBusyChange={setEvidenceBusy}
              onDirtyChange={setEvidenceDirty}
              onError={(cause) =>
                setError(cause instanceof Error ? cause.message : "자료 상태를 다시 확인해 주세요.")
              }
            />
            <p className="report-option-note">
              새 증거의 업로드 접수, 처리·관찰 검토, 사건 반영과 재분석은 각각 다른 단계예요. 기존
              리포트는 바뀌지 않으며 최신 분석으로 새 버전을 만들어 주세요.
            </p>
          </details>
        )}
        {regenerate && report && (
          <ConfirmDialog
            title="새 버전을 만들까요?"
            busy={Boolean(busy)}
            busyLabel={progressText}
            onCancel={() => setRegenerate(false)}
          >
            <p className="report-modal-description">
              최신 사건과 자료로 리포트를 다시 만들어요.
              {dirty && report.stale ? " 저장하지 않은 수정은 새 내용으로 바뀌어요." : ""}
            </p>
            {error && (
              <p role="alert" className="report-error">
                {error}
              </p>
            )}
            <div className="report-modal-actions">
              <Button
                disabled={Boolean(busy) || needsConsent}
                onClick={() =>
                  void run("새 버전 생성 중…", async () => {
                    if (dirty && report.stale) setPreservedEdit(content);
                    const current = dirty && !report.stale ? await save() : report;
                    if (
                      rework &&
                      (!preparation?.snapshot ||
                        ["not_started", "pending", "running", "failed", "stale"].includes(
                          preparation.analysis.status,
                        ))
                    ) {
                      if (await prepareReport()) setRegenerate(false);
                      return;
                    }
                    const value = await ownedResult(
                      api.reports.generate(caseId, undefined, current.revision),
                    );
                    setBusy("자료 목록 확인 중…");
                    const materials = await ownedResult(
                      api.files.list(caseId, { metadataOnly: true }),
                    );
                    const latest = rework ? await ownedResult(readReport()) : value;
                    if (!latest || latest.id !== value.id)
                      throw new Error("새 리포트의 저장 상태를 다시 확인해 주세요.");
                    accept(latest);
                    onChanged?.();
                    setFiles(materials);
                    setRegenerate(false);
                  })
                }
              >
                새 버전 생성
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => setRegenerate(false)}
              >
                취소
              </Button>
            </div>
          </ConfirmDialog>
        )}
        {cancelEdit && report && (
          <ConfirmDialog
            title="편집을 취소할까요?"
            busy={Boolean(busy)}
            onCancel={() => setCancelEdit(false)}
          >
            <p>저장하지 않은 본문·사진 배치·선택 변경을 취소하고 저장본으로 돌아갑니다.</p>
            <div className="report-modal-actions">
              <Button variant="outline" onClick={() => setCancelEdit(false)}>
                계속 편집
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setContent(report.content);
                  setIncludedPhotos(report.includedPhotoIds ?? []);
                  setExcluded(report.excludedFileIds);
                  setMaskIdentifiers(report.maskIdentifiers);
                  setEditing(false);
                  setCancelEdit(false);
                }}
              >
                저장본으로 돌아가기
              </Button>
            </div>
          </ConfirmDialog>
        )}
        {reloadConfirm && (
          <ConfirmDialog
            title="저장 내용을 다시 불러올까요?"
            busy={Boolean(busy)}
            busyLabel={progressText}
            onCancel={() => setReloadConfirm(false)}
          >
            <p>저장하지 않은 편집 내용은 사라져요. 현재 편집 내용을 보관하려면 취소해 주세요.</p>
            <button type="button" onClick={() => setReloadConfirm(false)}>
              취소
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setReloadConfirm(false);
                void load();
              }}
            >
              편집을 버리고 다시 불러오기
            </button>
          </ConfirmDialog>
        )}
      </div>
    </div>
  );
  return embedded ? (
    reportDocument
  ) : (
    <CaseWorkspaceFrame
      kind="document"
      header={
        <CaseNavigation
          caseId={caseId}
          title={displayTitle}
          active="reports"
          {...(report ? { fileCount: files.length } : {})}
        />
      }
    >
      {reportDocument}
    </CaseWorkspaceFrame>
  );
}
