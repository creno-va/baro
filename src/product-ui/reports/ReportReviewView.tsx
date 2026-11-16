import { Download, Pencil, Save } from "lucide-react";
import type { ReactNode } from "react";
import { maskReportText } from "../../components/reports/download";
import { CaseWorkspaceFrame } from "../../components/ui/workspace-frame";
import { CaseNavigation } from "../../components/workspace/CaseNavigation";
import { Button } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import { cn } from "../utils";
import {
  ConfirmDialog,
  ReportButton as ControlButton,
  LoadingContent,
  ReportReadonlyText,
  Spinner,
} from "./ReportComponents";
import { ReportReading } from "./ReportReading";
import { preparationFailureText } from "./report-status";
import type { ReportReviewController } from "./useReportReviewController";

export function ReportReviewView({
  controller,
  resolution,
  evidence,
}: {
  controller: ReportReviewController;
  resolution?: ReactNode;
  evidence?: ReactNode;
}) {
  const {
    accessChecking,
    accessUnknown,
    actionMissing,
    apiMode,
    beginEditing,
    busy,
    cancelEdit,
    cancelEditing,
    caseId,
    changeContent,
    changeExcluded,
    changeMask,
    confirmRegenerate,
    confirmReload,
    content,
    dirty,
    discardEditing,
    dismissCancel,
    dismissRegenerate,
    dismissReload,
    displayTitle,
    downloadPDF,
    downloadPreservedEdit,
    editing,
    editingBlocked,
    embedded,
    error,
    evidenceBusy,
    evidenceDirty,
    excluded,
    exportExhausted,
    exportingPdf,
    files,
    generateExcluded,
    initialLimit,
    initialLoading,
    maskIdentifiers,
    mockPhotoKey,
    mockPhotos,
    needsConsent,
    newReportAvailable,
    openAvailableReport,
    openRegenerate,
    owner,
    pendingJob,
    photoCandidates,
    pollPaused,
    preparation,
    preservedEdit,
    progressText,
    refreshPreparation,
    regenerate,
    reloadConfirm,
    renewDownload,
    report,
    requestPreparation,
    resolutionBusy,
    resolutionDirty,
    retryRead,
    rework,
    saveEditing,
    saveScope,
    setToolsOpen,
    toolsOpen,
  } = controller;
  const reportDocument = (
    <div
      data-product-report=""
      data-embedded={embedded || undefined}
      className={cn(
        "min-w-0 w-full text-[var(--pui-text)]",
        !embedded && "px-4 py-6 sm:px-6 sm:py-8",
      )}
      aria-busy={Boolean(busy) || accessChecking}
    >
      <div data-product-report-canvas="" className="mx-auto w-full max-w-[1120px] space-y-6">
        <header
          data-product-report-heading=""
          className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--pui-border)] pb-6"
        >
          {!embedded && (
            <div
              data-product-report-heading-copy=""
              className="min-w-0 flex-1 basis-72 space-y-2 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:leading-snug [&_h2]:tracking-tight [&_p]:text-sm [&_p]:leading-6 [&_p]:text-[var(--pui-muted)]"
            >
              {report && displayTitle !== "내 사건 이해와 해결 준비" && (
                <p
                  data-product-report-eyebrow=""
                  className="text-xs font-medium text-[var(--pui-muted)]"
                >
                  내 사건 이해와 해결 준비
                </p>
              )}
              <h2>{displayTitle}</h2>
              <p>핵심 쟁점과 지금 준비할 일을 살펴보고, 필요한 내용을 고쳐 보관하세요.</p>
            </div>
          )}
          {report && (
            <fieldset
              data-product-report-heading-actions=""
              className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
              aria-label="리포트 작업"
            >
              {editing && (
                <>
                  <ControlButton type="button" disabled={editingBlocked} onClick={cancelEditing}>
                    편집 취소
                  </ControlButton>
                  <ControlButton
                    type="button"
                    data-product-report-primary=""
                    variant="primary"
                    disabled={editingBlocked || !dirty || report.stale}
                    onClick={saveEditing}
                  >
                    <Save size={16} aria-hidden="true" />
                    수정 내용 저장
                  </ControlButton>
                </>
              )}
              {!editing && (
                <ControlButton
                  type="button"
                  data-product-report-edit-toggle=""
                  className="rounded-full"
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
                  onClick={beginEditing}
                >
                  <Pencil size={16} aria-hidden="true" />
                  수정하기
                </ControlButton>
              )}
              {(!editing || report.stale) && (
                <ControlButton
                  type="button"
                  data-product-report-regenerate=""
                  variant="primary"
                  className="rounded-full"
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
                  onClick={openRegenerate}
                >
                  새 버전 만들기
                </ControlButton>
              )}
            </fieldset>
          )}
        </header>
        {!initialLoading && (busy || accessChecking) && (
          <p
            role="status"
            data-product-report-progress=""
            className="flex items-center gap-2 text-sm leading-6 text-[var(--pui-muted)]"
          >
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
              data-product-report-preparation=""
              data-compact={Boolean(report)}
              className="min-w-0"
              aria-label="리포트 준비 상태"
              aria-live="polite"
            >
              <Disclosure open={!report || Boolean(pendingJob)}>
                <DisclosureSummary>
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
                </DisclosureSummary>
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
                <div
                  data-product-report-preparation-actions=""
                  className="flex flex-wrap gap-2 pt-2"
                >
                  <ControlButton
                    type="button"
                    data-product-report-primary=""
                    variant="primary"
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
                    onClick={requestPreparation}
                  >
                    리포트 준비
                  </ControlButton>
                  <ControlButton
                    type="button"
                    disabled={Boolean(busy) || accessChecking}
                    onClick={refreshPreparation}
                  >
                    상태 확인
                  </ControlButton>
                </div>
              </Disclosure>
            </section>
          )}
        {newReportAvailable && (
          <section
            data-product-report-callout=""
            className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-6 text-[var(--pui-text)]"
            role="status"
          >
            <p>
              {dirty
                ? "새 리포트가 준비됐어요. 저장하지 않은 편집 내용을 확인한 뒤 전환하세요."
                : "새 리포트가 준비됐어요. 새 버전을 열어 내용을 확인하세요."}
            </p>
            <ControlButton
              type="button"
              disabled={
                Boolean(busy) ||
                accessChecking ||
                evidenceBusy ||
                evidenceDirty ||
                resolutionBusy ||
                resolutionDirty
              }
              onClick={openAvailableReport}
            >
              새 리포트 열기
            </ControlButton>
          </section>
        )}
        {error && !regenerate && !reloadConfirm && (
          <div
            data-product-report-error=""
            className="space-y-3 rounded-xl border border-[var(--pui-danger)]/40 p-4 text-sm leading-6 text-[var(--pui-danger)]"
            role="alert"
          >
            <p>{error}</p>
            <ControlButton
              type="button"
              disabled={
                Boolean(busy) || evidenceBusy || evidenceDirty || resolutionBusy || resolutionDirty
              }
              onClick={retryRead}
            >
              다시 확인
            </ControlButton>
            <a href="/login">로그인</a>
          </div>
        )}
        {initialLimit && !report && !accessChecking && (
          <section
            data-product-report-options-body=""
            className="space-y-4 rounded-2xl border border-[var(--pui-border)] p-5 [&_h2]:text-lg [&_h2]:font-medium [&_p]:text-sm [&_p]:leading-6 [&_p]:text-[var(--pui-muted)]"
            aria-label="리포트 처리 한도 복구"
          >
            <h2>자료를 줄여 첫 리포트를 만들어요</h2>
            <p>리포트에서 제외할 자료를 선택하세요. 원본은 그대로 보관돼요.</p>
            {files.map((file) => (
              <label
                key={file.id}
                data-product-report-check=""
                className="flex min-h-11 items-center gap-3 text-sm leading-6 text-[var(--pui-text)] has-disabled:opacity-60"
              >
                <input
                  className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)]"
                  type="checkbox"
                  checked={excluded.includes(file.id)}
                  disabled={Boolean(busy) || needsConsent}
                  onChange={() => changeExcluded(file.id)}
                />
                {file.name} · 리포트에서 제외
              </label>
            ))}
            <ControlButton
              type="button"
              disabled={Boolean(busy) || needsConsent || !excluded.length}
              onClick={generateExcluded}
            >
              선택 자료를 제외하고 생성
            </ControlButton>
          </section>
        )}
        {report && (
          <fieldset
            data-product-report-controls=""
            className="m-0 min-w-0 space-y-6 border-0 p-0"
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
              <p
                data-product-report-callout=""
                className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-6 text-[var(--pui-text)]"
                role="status"
              >
                새 리포트 생성과 수정은 필수 동의 후 이용할 수 있어요. 기존 리포트와 저장된
                PDF·ZIP은 계속 확인할 수 있어요. <a href="/consent">동의 확인</a>
              </p>
            )}
            <section
              data-product-report-snapshot=""
              data-stale={report.stale || undefined}
              className="space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] px-4 py-3 text-sm leading-6 [&_strong]:block [&_strong]:font-medium"
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
              <span
                data-product-report-save-state=""
                className="block text-xs leading-5 text-[var(--pui-muted)]"
              >
                버전 {report.revision} · {dirty ? "미저장 편집 있음" : "저장됨"}
                {!dirty &&
                  ` · ${new Date(report.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`}
              </span>
              <Disclosure
                data-product-report-basis-details=""
                className="w-full border-0 bg-transparent px-0 py-0"
              >
                <DisclosureSummary>
                  작성 기준{report.stale ? " · 현재 사건과 다름" : ""}
                </DisclosureSummary>
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
              </Disclosure>
            </section>
            <Disclosure
              data-product-report-current-tools-menu=""
              open={toolsOpen}
              onOpenChange={setToolsOpen}
            >
              <DisclosureSummary>현재 사건에서 더 준비하기</DisclosureSummary>
              <nav
                data-product-report-current-tools=""
                className="grid gap-2 [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-lg [&_a]:px-3 [&_a]:text-[var(--pui-text)] [&_a:hover]:bg-[var(--pui-background)] [&_p]:text-xs [&_span]:block"
                aria-label="현재 사건에서 더 준비하기"
              >
                <p>
                  현재 사건에서 더 준비하기 <span>변경한 내용은 새 리포트에서 반영해요.</span>
                </p>
                <a href={`/cases/${encodeURIComponent(caseId)}/files`}>자료와 원본 확인</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/actions`}>현재 할 일 관리</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/timeline`}>현재 경위 정리</a>
                <a href={`/cases/${encodeURIComponent(caseId)}/precedents`}>현재 판례 탐색</a>
              </nav>
            </Disclosure>
            {preservedEdit && (
              <Disclosure data-product-report-preserved-edit="">
                <DisclosureSummary>새 버전을 만들기 전의 편집 내용 보관</DisclosureSummary>
                <p>
                  저장하지 않았던 내용을 이 화면에 보관했어요. 필요한 내용을 새 리포트에 옮겨
                  주세요.
                </p>
                <ReportReadonlyText
                  aria-label="보관한 리포트 편집 내용"
                  readOnly
                  value={preservedEdit}
                />
                <ControlButton type="button" onClick={downloadPreservedEdit}>
                  보관한 편집 내용 저장
                </ControlButton>
              </Disclosure>
            )}
            {(rework || report.analysisReview) && (
              <Disclosure data-product-report-scope="">
                <DisclosureSummary>포함할 자료와 식별정보 가림</DisclosureSummary>
                <p>
                  본문 수정을 먼저 저장한 뒤 범위를 바꾸세요. 제외 자료에 의존하는 법률 분석과 판례
                  비교도 새 리포트에서 다시 검토합니다.
                </p>
                <label
                  data-product-report-check=""
                  className="flex min-h-11 items-center gap-3 text-sm leading-6 text-[var(--pui-text)] has-disabled:opacity-60"
                >
                  <input
                    className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)]"
                    type="checkbox"
                    checked={maskIdentifiers}
                    disabled={needsConsent || report.stale || content !== report.content}
                    onChange={changeMask}
                  />
                  식별정보 가리기
                </label>
                <p>
                  전화번호·이메일·주민등록번호 형태의 식별정보를 가립니다. 이름·주소와 원본은 직접
                  확인해 주세요. 가림을 켜면 선택 사진을 통째로 제외합니다.
                </p>
                {files.map((file) => (
                  <label
                    data-product-report-check=""
                    className="flex min-h-11 items-center gap-3 text-sm leading-6 text-[var(--pui-text)] has-disabled:opacity-60"
                    key={file.id}
                  >
                    <input
                      className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)]"
                      type="checkbox"
                      checked={excluded.includes(file.id)}
                      disabled={needsConsent || report.stale || content !== report.content}
                      onChange={() => changeExcluded(file.id)}
                    />
                    {file.name} · 리포트에서 제외
                  </label>
                ))}
                <ControlButton
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    needsConsent ||
                    report.stale ||
                    content !== report.content ||
                    (maskIdentifiers === report.maskIdentifiers &&
                      JSON.stringify(excluded) === JSON.stringify(report.excludedFileIds))
                  }
                  onClick={saveScope}
                >
                  선택 범위 저장
                </ControlButton>
              </Disclosure>
            )}
            <section
              data-product-report-read-content=""
              className="min-w-0"
              aria-label="리포트 검토 본문"
            >
              <div id="report-edit-fields">
                <ReportReading
                  showOrientation={false}
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
                  onChange={changeContent}
                />
              </div>
            </section>
            <section
              data-product-report-export=""
              className="border-t border-[var(--pui-border)] pt-6"
              aria-label="리포트 다운로드"
            >
              {exportExhausted && (
                <div
                  data-product-report-callout=""
                  className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-6 text-[var(--pui-text)]"
                >
                  <p>다운로드 재시도를 모두 사용했어요. 새 버전으로 다시 준비해 주세요.</p>
                  <ControlButton
                    type="button"
                    disabled={Boolean(busy) || needsConsent || report.stale || !content.trim()}
                    onClick={renewDownload}
                  >
                    새 버전으로 다시 준비
                  </ControlButton>
                </div>
              )}
              <div
                data-product-report-actions=""
                className="flex flex-wrap items-center justify-end gap-2"
              >
                <ControlButton
                  type="button"
                  data-product-report-primary=""
                  variant="primary"
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
                  onClick={downloadPDF}
                >
                  {exportingPdf ? <Spinner /> : <Download size={16} aria-hidden="true" />}
                  {exportingPdf ? "PDF 만드는 중…" : "PDF 다운로드"}
                </ControlButton>
              </div>
            </section>
          </fieldset>
        )}
        {rework && report && owner.current && resolution}
        {rework && owner.current && (
          <Disclosure data-product-report-evidence-entry="" className="mt-6">
            <DisclosureSummary>자료 추가와 사건 반영</DisclosureSummary>
            {evidence}
            <p
              data-product-report-option-note=""
              className="text-xs leading-5 text-[var(--pui-muted)]"
            >
              새 증거의 업로드 접수, 처리·관찰 검토, 사건 반영과 재분석은 각각 다른 단계예요. 기존
              리포트는 바뀌지 않으며 최신 분석으로 새 버전을 만들어 주세요.
            </p>
          </Disclosure>
        )}
        {regenerate && report && (
          <ConfirmDialog
            title="새 버전을 만들까요?"
            busy={Boolean(busy)}
            busyLabel={progressText}
            onCancel={dismissRegenerate}
          >
            <p
              data-product-report-modal-description=""
              className="text-sm leading-6 text-[var(--pui-muted)]"
            >
              최신 사건과 자료로 리포트를 다시 만들어요.
              {dirty && report.stale ? " 저장하지 않은 수정은 새 내용으로 바뀌어요." : ""}
            </p>
            {error && (
              <p
                role="alert"
                data-product-report-error=""
                className="space-y-3 rounded-xl border border-[var(--pui-danger)]/40 p-4 text-sm leading-6 text-[var(--pui-danger)]"
              >
                {error}
              </p>
            )}
            <div
              data-product-report-modal-actions=""
              className="mt-5 flex flex-wrap justify-end gap-2"
            >
              <Button disabled={Boolean(busy) || needsConsent} onClick={confirmRegenerate}>
                새 버전 생성
              </Button>
              <Button variant="secondary" disabled={Boolean(busy)} onClick={dismissRegenerate}>
                취소
              </Button>
            </div>
          </ConfirmDialog>
        )}
        {cancelEdit && report && (
          <ConfirmDialog title="편집을 취소할까요?" busy={Boolean(busy)} onCancel={dismissCancel}>
            <p>저장하지 않은 본문·사진 배치·선택 변경을 취소하고 저장본으로 돌아갑니다.</p>
            <div
              data-product-report-modal-actions=""
              className="mt-5 flex flex-wrap justify-end gap-2"
            >
              <Button variant="secondary" onClick={dismissCancel}>
                계속 편집
              </Button>
              <Button variant="secondary" onClick={discardEditing}>
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
            onCancel={dismissReload}
          >
            <p>저장하지 않은 편집 내용은 사라져요. 현재 편집 내용을 보관하려면 취소해 주세요.</p>
            <ControlButton type="button" onClick={dismissReload}>
              취소
            </ControlButton>
            <ControlButton type="button" disabled={Boolean(busy)} onClick={confirmReload}>
              편집을 버리고 다시 불러오기
            </ControlButton>
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
