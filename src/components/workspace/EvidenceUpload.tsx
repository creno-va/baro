import { useEffect, useRef, useState } from "react";
import type { FileView } from "../../client/api/types";
import { accessHref } from "../../client/return-path";
import type { V2Fact } from "../../contracts/v2";
import { ErrorPanel } from "../intake/common";
import { Button } from "../ui/button";
import { Input as ControlInput, Label as FieldLabel } from "../ui/form";
import { ChatAttachments } from "./ChatAttachments";
import { EvidencePicker } from "./EvidencePicker";
import { materialState, materialStateLabels } from "./evidence-state";
import { FileReview } from "./FileReview";
import { uploadProgressLabel } from "./processing-progress";
import { useEvidenceUpload } from "./useEvidenceUpload";

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

/** Reusable materials/report entry. Case changes discard local handles, never server work. */
export function EvidenceUpload(props: EvidenceUploadProps) {
  return <EvidenceUploadEditor key={props.caseId} {...props} />;
}
function EvidenceUploadEditor({
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
  return (
    <section
      className="evidence-upload"
      aria-label={photoOnly ? "사진 분석에 추가" : "새 증거 추가"}
      aria-busy={busy}
    >
      <h3>{photoOnly ? "사진 분석" : "새 증거 추가"}</h3>
      <p className="evidence-hint">
        계약서·영수증·문자나 메신저 화면 등을 사건 자료로 분석해요. 리포트에 꾸미는 사진을 넣는 것과
        달라요.
      </p>
      <EvidencePicker
        scopeKey={upload.scopeKey}
        disabled={!upload.writable || busy}
        photoOnly={photoOnly}
        onSelect={upload.select}
        onError={upload.report}
      />
      {!upload.writable && upload.ready && !disabled && !busy && !reviewDirty && (
        <p>
          <a href={accessHref("consent")}>최신 동의 확인</a> 후 새 자료를 추가할 수 있어요.
        </p>
      )}
      <ChatAttachments
        local={upload.local}
        uploaded={[]}
        disabled={busy}
        removeLocal={upload.remove}
        removeUploaded={() => {}}
      />
      {upload.selecting && <p role="status">선택한 자료를 확인하고 있어요.</p>}
      {upload.local.length > 0 && (
        <FieldLabel className="evidence-consent">
          <ControlInput
            type="checkbox"
            checked={upload.consent}
            disabled={busy || !upload.writable}
            onChange={(event) => upload.setConsent(event.target.checked)}
          />
          추가한 자료의 자동 처리에 동의합니다.
        </FieldLabel>
      )}
      <p className="evidence-hint">
        불필요한 주민번호·연락처는 포함하지 마세요. 원본은 비공개로 보관하며 분석에 외부 AI·파일
        처리 서비스를 사용해요.
      </p>
      <Button
        disabled={busy || !upload.writable || !upload.consent || !upload.local.length}
        onClick={() => void upload.upload()}
      >
        새 증거 업로드
      </Button>
      {upload.progress && (
        <p role="status">
          {upload.progress.name} · {uploadProgressLabel(upload.progress.value)}
        </p>
      )}
      {upload.notice && <p role="status">{upload.notice}</p>}
      {upload.error ? (
        <ErrorPanel error={upload.error} retry={() => void upload.refresh()} disabled={busy} />
      ) : null}
      {upload.uploaded.length > 0 && (
        <ul className="evidence-file-list" aria-label="사건에 추가한 증거">
          {upload.uploaded.map((file) => (
            <li key={file.id}>
              <div>
                <strong>{file.name}</strong>
                <span>{materialStateLabels[materialState(file, facts)]}</span>
              </div>
              {file.status === "ready" && (
                <Button
                  variant="outline"
                  disabled={busy || reviewDirty}
                  onClick={() => {
                    setReviewId(file.id);
                    setReflectionNotice("");
                  }}
                >
                  관찰 검토
                </Button>
              )}
              {file.status === "uploading" && !file.uploadRejection && (
                <p className="evidence-hint">
                  같은 원본을 다시 선택하면 기존 업로드를 이어서 확인해요.
                </p>
              )}
              {file.uploadRejection && (
                <p className="evidence-hint">
                  암호·보호를 해제하거나 지원하는 형식의 파일을 새로 선택해 주세요.
                </p>
              )}
              {(file.status === "failed" || file.uploadRejection) && (
                <a
                  href={`/cases/${encodeURIComponent(caseId)}/files?file=${encodeURIComponent(file.id)}`}
                >
                  실패·재시도·삭제 확인
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {reviewFile && (
        <div className="evidence-review">
          <FileReview
            key={`${upload.scopeKey}:${reviewFile.id}`}
            caseId={caseId}
            fileId={reviewFile.id}
            canEdit={!disabled && !upload.busy && !reflectBusy}
            onChanged={changed}
            onError={upload.report}
            onDirtyChange={setReviewDirty}
            onBusyChange={setReviewBusy}
            refreshVersion={String(reviewFile.revision ?? "")}
          />
          {onReflect ? (
            <Button
              disabled={!upload.writable || busy || reviewDirty || reviewFile.status !== "ready"}
              onClick={() => void reflect(reviewFile.id)}
            >
              자료 내용 반영하기
            </Button>
          ) : (
            <a href={`/cases/${encodeURIComponent(caseId)}`}>대화에서 자료 내용 반영하기</a>
          )}
          <p className="evidence-hint">
            포함할 관찰을 확인한 뒤 반영해 주세요. 원본 진정성·사건의 확정 사실을 보장하지 않아요.
          </p>
          {reflectionNotice && <p role="status">{reflectionNotice}</p>}
        </div>
      )}
    </section>
  );
}
