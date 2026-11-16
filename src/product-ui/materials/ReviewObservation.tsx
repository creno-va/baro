import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown } from "lucide-react";
import { observationKind, observationKindLabels } from "../../components/workspace/evidence-state";
import { positionLabel } from "../../components/workspace/source-label";
import { TextareaField } from "../Field";
import type { ReviewDraft, ReviewObservationRow } from "./types";

export function ReviewObservation({
  observation: { value, original, ordinal },
  draft,
  fieldPrefix,
  fileName,
  fileRevision,
  disabled,
  onChange,
}: {
  observation: ReviewObservationRow;
  draft: ReviewDraft;
  fieldPrefix: string;
  fileName: string;
  fileRevision: number;
  disabled: boolean;
  onChange: (next: ReviewDraft) => void;
}) {
  return (
    <fieldset
      disabled={disabled}
      data-product-review-observation=""
      className="min-w-0 space-y-4 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 sm:p-5"
    >
      <legend className="px-1 text-sm font-semibold text-[var(--pui-text)]">
        {positionLabel(value.position)}
      </legend>
      <div className="space-y-1 text-xs leading-5 text-[var(--pui-muted)]">
        <p className="font-medium text-[var(--pui-text)]">
          {observationKindLabels[observationKind(value)]}
        </p>
        <p className="[overflow-wrap:anywhere]">
          {fileName} · 파일 v{fileRevision} · {positionLabel(value.position)}
        </p>
        {value.certainty === "uncertain" &&
          !value.userEdited &&
          observationKind(value) !== "uncertain" && <p>불확실한 관찰 · 원본 확인 필요</p>}
      </div>
      <Disclosure>
        {({ open }) => (
          <div className="rounded-xl bg-[var(--pui-background)]">
            <DisclosureButton
              data-disclosure-button=""
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium text-[var(--pui-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
            >
              원본 추출 내용
              <ChevronDown
                size={15}
                className={open ? "rotate-180" : undefined}
                aria-hidden="true"
              />
            </DisclosureButton>
            <DisclosurePanel static hidden={!open} className="px-3 pb-3">
              <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--pui-muted)] [overflow-wrap:anywhere]">
                {original.text}
              </p>
            </DisclosurePanel>
          </div>
        )}
      </Disclosure>
      <TextareaField
        label="확인·교정한 내용"
        rows={Math.min(10, Math.max(2, Math.ceil(draft.text.length / 45)))}
        id={`${fieldPrefix}-observation-${ordinal}`}
        value={draft.text}
        disabled={disabled}
        onChange={(event) => onChange({ text: event.target.value, included: draft.included })}
        className="text-sm leading-6"
      />
      {[...draft.text].length > 5000 && (
        <p role="alert" className="text-sm text-[var(--pui-danger)]">
          교정 내용은 5,000자 이내로 작성해 주세요.
        </p>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--pui-text)]">
        <input
          type="checkbox"
          checked={draft.included}
          disabled={disabled}
          onChange={(event) => onChange({ text: draft.text, included: event.target.checked })}
          className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)]"
        />
        사건 정리와 새 리포트에 포함
      </label>
      {!draft.included && (
        <p className="text-xs leading-5 text-[var(--pui-muted)]">
          원본은 보관하고 AI 처리·새 리포트에서 제외합니다.
        </p>
      )}
      {value.userEdited && <p className="text-xs text-[var(--pui-muted)]">사용자가 교정한 내용</p>}
    </fieldset>
  );
}
