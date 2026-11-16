import { FileCheck2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { accessHref } from "../../client/return-path";
import { materialState, materialStateLabels } from "../../components/workspace/evidence-state";
import { uploadProgressLabel } from "../../components/workspace/processing-progress";
import { Button, ButtonLink } from "../Button";
import { CaseInputError } from "../intake/CaseInputError";
import type { EvidenceUploadController } from "./useEvidenceUploadController";

/** Authenticated child entries are composed by the facade, not imported by this view. */
export function EvidenceUploadView({
  controller: c,
  picker,
  attachments,
  review,
}: {
  controller: EvidenceUploadController;
  picker: ReactNode;
  attachments: ReactNode;
  review: ReactNode;
}) {
  const {
    upload,
    busy,
    photoOnly,
    disabled,
    reviewDirty,
    reviewFile,
    facts,
    caseId,
    onReflect,
    reflectionNotice,
  } = c;
  return (
    <section
      data-product-evidence-upload=""
      className="min-w-0 space-y-4 text-sm leading-6 text-[var(--pui-text)]"
      aria-label={photoOnly ? "사진 분석에 추가" : "새 증거 추가"}
      aria-busy={busy}
    >
      <header className="flex items-start gap-3 border-b border-[var(--pui-border)] pb-4">
        <Upload size={20} className="mt-0.5 shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold">{photoOnly ? "사진 분석" : "새 증거 추가"}</h3>
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            계약서·영수증·문자나 메신저 화면 등을 사건 자료로 분석해요. 리포트에 꾸미는 사진을 넣는
            것과 달라요.
          </p>
        </div>
      </header>
      {picker}
      {!upload.writable && upload.ready && !disabled && !busy && !reviewDirty && (
        <p>
          <a
            href={accessHref("consent")}
            className="rounded text-[var(--pui-primary)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)]"
          >
            최신 동의 확인
          </a>{" "}
          후 새 자료를 추가할 수 있어요.
        </p>
      )}
      {attachments}
      {upload.selecting && <p role="status">선택한 자료를 확인하고 있어요.</p>}
      {upload.local.length > 0 && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3">
          <input
            type="checkbox"
            checked={upload.consent}
            disabled={busy || !upload.writable}
            onChange={(event) => upload.setConsent(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          추가한 자료의 자동 처리에 동의합니다.
        </label>
      )}
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        불필요한 주민번호·연락처는 포함하지 마세요. 원본은 비공개로 보관하며 분석에 외부 AI·파일
        처리 서비스를 사용해요.
      </p>
      <Button
        disabled={busy || !upload.writable || !upload.consent || !upload.local.length}
        onClick={() => void upload.upload()}
      >
        <Upload size={16} aria-hidden="true" />새 증거 업로드
      </Button>
      {upload.progress && (
        <p role="status">
          {upload.progress.name} · {uploadProgressLabel(upload.progress.value)}
        </p>
      )}
      {upload.notice && <p role="status">{upload.notice}</p>}
      {upload.error ? (
        <CaseInputError error={upload.error} retry={() => void upload.refresh()} disabled={busy} />
      ) : null}
      {upload.uploaded.length > 0 && (
        <ul
          data-product-evidence-file-list=""
          className="m-0 grid list-none gap-2 p-0"
          aria-label="사건에 추가한 증거"
        >
          {upload.uploaded.map((file) => (
            <li
              key={file.id}
              className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3"
            >
              <FileCheck2
                size={18}
                className="shrink-0 text-[var(--pui-muted)]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
                <strong className="block font-medium">{file.name}</strong>
                <span className="block text-xs text-[var(--pui-muted)]">
                  {materialStateLabels[materialState(file, facts)]}
                </span>
              </div>
              {file.status === "ready" && (
                <Button
                  variant="secondary"
                  disabled={busy || reviewDirty}
                  onClick={() => {
                    c.setReviewId(file.id);
                    c.setReflectionNotice("");
                  }}
                >
                  관찰 검토
                </Button>
              )}
              {file.status === "uploading" && !file.uploadRejection && (
                <p className="w-full text-xs text-[var(--pui-muted)]">
                  같은 원본을 다시 선택하면 기존 업로드를 이어서 확인해요.
                </p>
              )}
              {file.uploadRejection && (
                <p className="w-full text-xs text-[var(--pui-muted)]">
                  암호·보호를 해제하거나 지원하는 형식의 파일을 새로 선택해 주세요.
                </p>
              )}
              {(file.status === "failed" || file.uploadRejection) && (
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  href={`/cases/${encodeURIComponent(caseId)}/files?file=${encodeURIComponent(file.id)}`}
                >
                  실패·재시도·삭제 확인
                </ButtonLink>
              )}
            </li>
          ))}
        </ul>
      )}
      {reviewFile && (
        <div
          data-product-evidence-review=""
          className="min-w-0 space-y-4 border-t border-[var(--pui-border)] pt-4"
        >
          {review}
          {onReflect ? (
            <Button
              disabled={!upload.writable || busy || reviewDirty || reviewFile.status !== "ready"}
              onClick={() => void c.reflect(reviewFile.id)}
            >
              자료 내용 반영하기
            </Button>
          ) : (
            <ButtonLink variant="secondary" href={`/cases/${encodeURIComponent(caseId)}`}>
              대화에서 자료 내용 반영하기
            </ButtonLink>
          )}
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            포함할 관찰을 확인한 뒤 반영해 주세요. 원본 진정성·사건의 확정 사실을 보장하지 않아요.
          </p>
          {reflectionNotice && <p role="status">{reflectionNotice}</p>}
        </div>
      )}
    </section>
  );
}
