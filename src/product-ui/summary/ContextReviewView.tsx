import { LoaderCircle, Settings2 } from "lucide-react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { TextareaField } from "../Field";
import { SelectField } from "../Select";
import { kindLabels, purposeLabels, SummaryContext, stageLabels } from "./SummaryContext";
import type { ContextReviewController } from "./useContextReviewController";

export function ContextReviewView({ controller: view }: { controller: ContextReviewController }) {
  return (
    <div data-product-context-review="" className="mb-4">
      <Button
        variant="secondary"
        disabled={view.readDisabled}
        onClick={view.openFrom}
        className="rounded-full"
      >
        <Settings2 size={16} aria-hidden="true" /> 입장·절차 확인
      </Button>
      <Dialog
        preserveMounted
        open={view.open}
        onClose={view.close}
        title="입장과 절차 확인"
        description="사건의 입장과 진행 상황을 확인해 주세요. 모르는 항목은 그대로 두어도 괜찮아요."
        footer={
          <>
            <Button variant="secondary" disabled={view.busy} onClick={view.close}>
              {view.changed ? "나중에 확인" : "닫기"}
            </Button>
            <Button disabled={view.saveDisabled} aria-busy={view.busy} onClick={view.save}>
              {view.busy && (
                <LoaderCircle
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {view.pendingAttempt ? "저장 결과 다시 확인" : "입장·절차 저장"}
            </Button>
          </>
        }
      >
        <ContextReviewFields controller={view} />
      </Dialog>
    </div>
  );
}

/** Native text/checkbox events and controlled Select values reach the owner directly. */
export function ContextReviewFields({ controller: view }: { controller: ContextReviewController }) {
  return (
    <div className="space-y-5">
      {view.loading && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm leading-6 text-[var(--pui-muted)]"
        >
          <LoaderCircle
            size={16}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          현재 입장과 절차를 확인하고 있어요.
        </p>
      )}
      {view.base && (
        <>
          <fieldset disabled={view.frozen} className="grid gap-5">
            <legend className="sr-only">사용자가 확인한 사건 맥락</legend>
            <SelectField
              label="사건 입장"
              value={view.draft.purpose}
              onValueChange={view.setPurpose}
              disabled={view.frozen}
              options={[
                ...(view.base.context.casePurpose === "unconfirmed"
                  ? [{ value: "unconfirmed", label: "아직 모름" }]
                  : []),
                { value: "prepare_claim", label: purposeLabels.prepare_claim },
                { value: "respond_to_claim", label: purposeLabels.respond_to_claim },
              ]}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label="사건 분야"
                value={view.draft.kind}
                onValueChange={view.setKind}
                disabled={view.frozen}
                options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}
              />
              <SelectField
                label="진행 단계"
                value={view.draft.stage}
                onValueChange={view.setStage}
                disabled={view.frozen}
                options={Object.entries(stageLabels).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <TextareaField
              label="확인한 진행 상황 (선택)"
              maxLength={500}
              value={view.draft.description}
              disabled={view.frozen}
              onChange={(event) => view.setDescription(event.currentTarget.value)}
              className="min-h-28 resize-y"
            />
          </fieldset>
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            선택한 내용으로 사건을 정리해요. 공식 사건 조회 결과는 아니에요.
          </p>
          {view.draft.purpose === "unconfirmed" && (
            <p className="text-sm leading-6 text-[var(--pui-muted)]">
              아직 입장을 모르면 저장하지 않고 현재 가능한 제한된 결과로 이어가도 괜찮아요.
            </p>
          )}
          {view.stale && (
            <div className="space-y-4 rounded-2xl border border-[var(--pui-border)] p-4">
              <p className="text-sm leading-6 text-[var(--pui-text)]">
                현재 저장된 값과 선택한 변경을 비교해 주세요. 선택값은 그대로 보존했어요.
              </p>
              {!view.needsReload && <SummaryContext context={view.base.context} />}
              <Button
                variant="secondary"
                disabled={view.busy || view.loading}
                onClick={view.reloadBase}
              >
                최신 기준 불러오기
              </Button>
              <label className="flex min-h-11 items-start gap-2 text-sm leading-6 text-[var(--pui-text)]">
                <input
                  type="checkbox"
                  checked={view.reviewed}
                  disabled={view.busy || view.loading || view.needsReload}
                  onChange={(event) => view.setReviewed(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)]"
                />
                현재 저장된 값과 선택한 변경을 비교했어요.
              </label>
            </div>
          )}
        </>
      )}
      {view.error && (
        <p
          role="alert"
          className="text-sm leading-6 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
        >
          {view.error}
        </p>
      )}
      {!view.base && view.error && (
        <Button variant="secondary" disabled={view.loading} onClick={view.retryRead}>
          현재 값 다시 확인
        </Button>
      )}
    </div>
  );
}
