import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown, FileCheck2, LoaderCircle } from "lucide-react";
import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../Button";
import { CaseInputError } from "../intake/CaseInputError";
import { ReviewObservation } from "./ReviewObservation";
import type { FileReviewController } from "./useFileReviewController";

export function FileReviewView({ controller: c }: { controller: FileReviewController }) {
  const { review, busy, loadingAfter, error, dirty, drafts } = c;
  return (
    <section
      data-product-file-review=""
      aria-label="자료 내용 검토"
      aria-busy={busy || loadingAfter !== null}
      className="space-y-5 text-[var(--pui-text)]"
    >
      <header className="flex items-start gap-3 border-b border-[var(--pui-border)] pb-4">
        <FileCheck2
          size={20}
          className="mt-0.5 shrink-0 text-[var(--pui-muted)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            {c.photo ? "사진 분석 결과 확인" : "추출 내용 확인·수정"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--pui-muted)]">
            원본과 추출 내용을 비교하고, 필요한 부분을 직접 교정하세요.
          </p>
        </div>
      </header>
      {error ? (
        <CaseInputError
          error={error}
          retry={() => void c.retry()}
          disabled={busy || loadingAfter !== null}
        />
      ) : null}
      {!c.ready || !review ? (
        !error || loadingAfter !== null ? (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-[var(--pui-muted)]">
            <LoaderCircle
              size={17}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            처리 위치와 저장한 교정 내용을 불러오고 있어요.
          </p>
        ) : null
      ) : (
        <>
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            분석은 원본 진정성이나 사건의 확정 사실을 보장하지 않아요. 기재 내용·화면 관찰·불확실한
            해석을 원본과 비교해 주세요. 교정·제외 후 사건에 반영할 수 있어요.
          </p>
          {c.partial && (
            <p
              role="status"
              className="rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3 text-sm leading-6"
            >
              {c.photo
                ? "일부만 분석했어요. 흐리거나 읽지 못한 위치는 원본으로 확인하고, 필요하면 선명한 전체 사진이나 확대 사진을 추가해 주세요."
                : "일부만 분석했어요. 처리하지 못한 페이지·시간 구간을 원본과 확인해 주세요."}
            </p>
          )}
          {loadingAfter !== null && loadingAfter >= 0 && (
            <p role="status" className="text-sm text-[var(--pui-muted)]">
              추출 내용을 더 불러오고 있어요.
            </p>
          )}
          {!c.canMutate && (
            <p className="text-sm leading-6">
              기존 자료를 읽을 수 있어요. 수정하려면{" "}
              <ButtonLink variant="ghost" size="sm" href={accessHref("consent")}>
                최신 동의 확인
              </ButtonLink>
              이 필요해요.
            </p>
          )}
          {c.canMutate && !c.canEdit && (
            <p className="text-sm leading-6 text-[var(--pui-muted)]">
              자료 교정은 사건 요약을 확인한 뒤 진행할 수 있어요.
            </p>
          )}
          {review.recovery && (
            <p role="status" className="text-sm leading-6">
              {review.recovery.message}
            </p>
          )}
          <Disclosure>
            {({ open }) => (
              <div
                data-product-review-coverage=""
                className="rounded-xl border border-[var(--pui-border)]"
              >
                <DisclosureButton
                  data-disclosure-button=""
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
                >
                  페이지·시간별 처리 범위 ({c.rows.length}개)
                  <ChevronDown
                    size={16}
                    className={open ? "rotate-180" : undefined}
                    aria-hidden="true"
                  />
                </DisclosureButton>
                <DisclosurePanel
                  static
                  hidden={!open}
                  className="space-y-3 border-t border-[var(--pui-border)] p-4 text-xs leading-6 text-[var(--pui-muted)]"
                >
                  {c.rows.length ? (
                    <ul className="list-inside list-disc">
                      {c.rows.slice(0, c.limit).map((row) => (
                        <li key={row}>{row}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>확인된 처리 범위가 없어요.</p>
                  )}
                  {c.rows.length > c.limit && (
                    <Button variant="secondary" size="sm" onClick={() => c.setLimit(c.limit + 100)}>
                      처리 범위 100개 더 보기 ({c.rows.length - c.limit}개 남음)
                    </Button>
                  )}
                </DisclosurePanel>
              </div>
            )}
          </Disclosure>
          <div className="space-y-4">
            {review.observations.map((observation) => (
              <ReviewObservation
                key={observation.value.id}
                observation={observation}
                draft={drafts[observation.value.id] ?? observation.value}
                fieldPrefix={c.fieldPrefix}
                fileName={review.file.name}
                fileRevision={review.file.revision}
                disabled={busy || !c.canWrite || !!review.pendingReview}
                onChange={(next) => c.updateDraft(observation.value, next)}
              />
            ))}
          </div>
          {review.nextAfterOrdinal !== null && (
            <div className="space-y-2 border-t border-[var(--pui-border)] pt-4">
              <Button
                variant="secondary"
                disabled={busy || loadingAfter !== null || dirty}
                onClick={c.loadMore}
              >
                추출 내용 더 보기
              </Button>
              <p className="text-xs leading-5 text-[var(--pui-muted)]">
                추출 내용이 더 있어요. {review.observations.length}개를 불러왔어요.
                {dirty ? " 수정 내용을 저장한 뒤 더 볼 수 있어요." : ""}
              </p>
            </div>
          )}
          {review.pendingReview ? (
            <div
              role="status"
              className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-6"
            >
              <p>
                {review.pendingReview.status === "conflict"
                  ? "사건이 바뀌었거나 저장 시간이 만료됐어요. 미완료 교정을 취소한 뒤 다시 확인해 주세요."
                  : `교정 저장 중 ${review.pendingReview.completed} / ${review.pendingReview.total}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {review.pendingReview.status === "saving" && (
                  <Button
                    disabled={busy || loadingAfter !== null || !c.canWrite}
                    onClick={c.continueSave}
                  >
                    저장 이어가기
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busy || loadingAfter !== null}
                  onClick={c.discardPending}
                >
                  미완료 교정 취소
                </Button>
              </div>
            </div>
          ) : dirty ? (
            <div className="border-t border-[var(--pui-border)] pt-4">
              <Button
                disabled={
                  busy ||
                  loadingAfter !== null ||
                  !c.canWrite ||
                  Object.values(drafts).some(
                    (draft) => !draft.text.trim() || [...draft.text].length > 5000,
                  )
                }
                onClick={c.saveDrafts}
              >
                교정 내용 저장
              </Button>
            </div>
          ) : null}
          {c.notice && (
            <p
              role="status"
              className="rounded-xl bg-[var(--pui-background)] p-3 text-sm leading-6"
            >
              {c.notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
