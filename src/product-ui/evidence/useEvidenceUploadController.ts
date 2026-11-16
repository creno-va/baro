import { useEffect, useRef, useState } from "react";
import type { FileView } from "../../client/api/types";
import { useEvidenceUpload } from "../../components/workspace/useEvidenceUpload";
import type { V2Fact } from "../../contracts/v2";

export type EvidenceUploadProps = {
  caseId: string;
  disabled?: boolean;
  photoOnly?: boolean;
  facts?: V2Fact[];
  /** ACK + authorized file readback only. This does not mean analysis/attribution completed. */
  onUploaded: (files: FileView[]) => Promise<unknown>;
  onError?: (cause: unknown) => unknown;
  onBusyChange?: (busy: boolean) => void;
  /** Includes local selections and unsaved observation corrections. */
  onDirtyChange?: (dirty: boolean) => void;
  onEvidenceChanged?: () => Promise<unknown>;
  /** Use the existing selectedFileIds message path and then read fresh revisions. */
  onReflect?: (fileId: string) => Promise<unknown>;
};

export function useEvidenceUploadController({
  caseId,
  disabled = false,
  photoOnly = false,
  facts = [],
  onUploaded,
  onError,
  onBusyChange,
  onDirtyChange,
  onEvidenceChanged,
  onReflect,
}: EvidenceUploadProps) {
  const [reviewId, setReviewId] = useState<string | null>(null),
    [reviewDirty, setReviewDirty] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false);
  const [reflectBusy, setReflectBusy] = useState(false),
    [reflectionNotice, setReflectionNotice] = useState("");
  const reflectLock = useRef(false);
  const upload = useEvidenceUpload({
    caseId,
    disabled: disabled || reviewDirty || reviewBusy || reflectBusy,
    onUploaded,
    onError,
  });
  const scope = useRef(upload.scopeKey);
  const previousScope = useRef(upload.scopeKey);
  scope.current = upload.scopeKey;
  const reviewFile = upload.uploaded.find((file) => file.id === reviewId);
  const busy = upload.busy || upload.selecting || reviewBusy || reflectBusy;
  const dirty = reviewDirty || upload.local.length > 0 || upload.selecting;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (previousScope.current === upload.scopeKey) return;
    previousScope.current = upload.scopeKey;
    setReviewId(null);
    setReviewDirty(false);
    setReviewBusy(false);
    setReflectionNotice("");
    reflectLock.current = false;
    setReflectBusy(false);
  }, [upload.scopeKey]);
  useEffect(() => {
    if (reviewId && !reviewFile) setReviewId(null);
  }, [reviewId, reviewFile]);
  async function changed() {
    await upload.refresh();
    await onEvidenceChanged?.();
  }
  async function reflect(fileId: string) {
    if (reflectLock.current || reviewDirty || busy || !upload.writable || !onReflect) return;
    reflectLock.current = true;
    setReflectBusy(true);
    setReflectionNotice("");
    const epoch = scope.current;
    try {
      if (!(await upload.verifyWrite()) || scope.current !== epoch) return;
      const result = await onReflect(fileId);
      if (scope.current === epoch && result !== false)
        setReflectionNotice("반영을 요청했어요. 대화와 분석의 최신 처리 상태를 확인해 주세요.");
    } catch (cause) {
      if (scope.current === epoch) upload.report(cause);
    } finally {
      if (scope.current === epoch) {
        reflectLock.current = false;
        setReflectBusy(false);
      }
    }
  }
  return {
    caseId,
    disabled,
    photoOnly,
    facts,
    onReflect,
    upload,
    reviewFile,
    reviewDirty,
    busy,
    reflectionNotice,
    setReviewId,
    setReflectionNotice,
    setReviewDirty,
    setReviewBusy,
    changed,
    reflect,
    reflectBusy,
  };
}
export type EvidenceUploadController = ReturnType<typeof useEvidenceUploadController>;
