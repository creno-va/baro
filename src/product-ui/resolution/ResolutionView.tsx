import { Download, FilePenLine, FileText, Pause, Scale } from "lucide-react";
import { draftReviewState } from "../../components/resolution/draft-review";
import { resolutionDocumentLabels } from "../../utils/resolution";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { TextareaField } from "../Field";
import { SelectField } from "../Select";
import { cn } from "../utils";
import { actionClass, checkboxClass, checkClass, ResolutionNotice } from "./ResolutionComponents";
import { ResolutionGuide } from "./ResolutionGuide";
import { ResolutionScope } from "./ResolutionScope";
import type { ResolutionController } from "./useResolutionController";

const paths = [
  {
    id: "self",
    label: "직접 해결",
    description: "확인된 준비 항목과 절차의 조건을 살펴보고 초안을 검토해요.",
    Icon: FilePenLine,
  },
  {
    id: "lawyer",
    label: "변호사와 해결",
    description: "현재 지원 여부를 확인해요.",
    Icon: Scale,
  },
  {
    id: "save_report",
    label: "리포트만 저장",
    description: "현재 리포트의 저장으로 바로 이어져요.",
    Icon: FileText,
  },
] as const;

export function ResolutionView({ controller: c }: { controller: ResolutionController }) {
  const { state, selected, props, busy, blocked, reference, dirty, viewBlocked } = c;
  return (
    <section
      data-product-resolution=""
      data-embedded={props.embedded || undefined}
      aria-label="리포트 이후 해결 방법"
      className={cn(
        "min-w-0 space-y-6 text-[var(--pui-text)] [overflow-wrap:anywhere]",
        !props.embedded && "border-t border-[var(--pui-border)] pt-8",
      )}
    >
      <header className="space-y-3">
        <h2 className="text-xl font-medium leading-snug tracking-tight">
          이해한 내용을 다음 준비로 이어가요
        </h2>
        <p className="max-w-3xl text-sm leading-7 text-[var(--pui-muted)]">
          직접 준비할 범위, 전문가 도움이 필요한 부분, 보관 중에서 선택할 수 있어요. 절차와 서식의
          미확인 사항은 선택 뒤에도 구분해 보여드려요.
        </p>
      </header>
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        {paths.map(({ id, label, description, Icon }) => (
          <Button
            key={id}
            ref={id === "lawyer" ? c.lawyerTrigger : undefined}
            variant="secondary"
            data-product-resolution-path=""
            aria-pressed={selected === id}
            disabled={busy || props.disabled}
            onClick={() => c.requestChoice(id)}
            className="h-full min-h-28 w-full min-w-0 items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left font-normal aria-pressed:border-[var(--pui-text)] aria-pressed:bg-[var(--pui-background)] sm:flex-col sm:gap-4 sm:p-5"
          >
            <Icon size={20} className="mt-1 shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
            <span className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
              <strong className="block text-sm font-medium leading-7">{label}</strong>
              <span className="block text-xs leading-6 text-[var(--pui-muted)]">{description}</span>
            </span>
          </Button>
        ))}
      </div>
      {(c.loadError || c.error) && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-[var(--pui-danger)]/40 p-4 text-sm leading-7 text-[var(--pui-danger)]"
          data-load-error-code={c.loadDiagnostic?.code}
          data-load-error-http-status={c.loadDiagnostic?.httpStatus}
          data-load-error-transport={c.loadDiagnostic?.transport}
          data-action-error-code={c.actionDiagnostic?.code}
          data-action-error-http-status={c.actionDiagnostic?.httpStatus}
          data-action-error-transport={c.actionDiagnostic?.transport}
          data-action-error-step={c.actionFailureStep}
        >
          {c.loadError && <p>{c.loadError}</p>}
          {c.error && <p>{c.error}</p>}
          <Button variant="secondary" disabled={busy} onClick={c.retry}>
            다시 확인
          </Button>
        </div>
      )}
      {c.needsConsent && (
        <ResolutionNotice>
          <p>
            새 초안 준비·수정은 현재 정책 동의 후 이용할 수 있어요. 저장된 내용 확인과 다운로드는
            계속 이용할 수 있어요. 동의 전에는 화면만 전환하며 선택을 저장하지 않아요.
          </p>
        </ResolutionNotice>
      )}
      {c.notice && (
        <p role="status" className="text-sm leading-7 text-[var(--pui-muted)]">
          {c.notice}
        </p>
      )}
      {(viewBlocked || state?.status === "stale") && (
        <ResolutionNotice>
          <p>현재 리포트 기준을 저장·확인한 뒤 새 초안을 준비해 주세요. 이전 초안은 보존돼요.</p>
          <Button variant="secondary" disabled={busy || dirty || props.disabled} onClick={c.retry}>
            현재 기준 다시 확인
          </Button>
        </ResolutionNotice>
      )}
      {state?.status === "not_ready" && (
        <ResolutionNotice>
          <p>
            아직 연결할 현재 리포트·분석이 없어요. 리포트를 확인해 주세요. 기존 리포트 저장은 이용할
            수 있어요.
          </p>
        </ResolutionNotice>
      )}
      {state?.status === "paused" && (
        <ResolutionNotice>
          <p>잠시 중단했어요. 저장된 내용을 이어갈 수 있어요.</p>
          <Button variant="secondary" disabled={busy || blocked || !reference} onClick={c.resume}>
            이어서 진행
          </Button>
        </ResolutionNotice>
      )}
      {selected === "self" && state && (
        <div data-product-resolution-body="" className="min-w-0 space-y-8">
          <ResolutionGuide state={state} />
          <ResolutionScope controller={c} />
          <ResolutionPreparation controller={c} />
          {state.draft && <ResolutionDraft controller={c} />}
        </div>
      )}
      {state && selected && selected !== "save_report" && (
        <div className={cn(actionClass, "border-t border-[var(--pui-border)] pt-4")}>
          <Button
            variant="ghost"
            disabled={busy || blocked || !reference || dirty}
            onClick={c.pause}
          >
            <Pause size={18} aria-hidden="true" />
            잠시 중단
          </Button>
          {props.onCancel && (
            <Button variant="ghost" disabled={busy || dirty} onClick={props.onCancel}>
              닫기
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={c.lawyerNoticeOpen}
        onClose={c.closeLawyerNotice}
        title="아직 지원하지 않는 기능이에요"
        description="현재 변호사 연결 기능은 제공하지 않습니다."
        returnFocusRef={c.lawyerTrigger}
        showCloseButton={false}
      >
        <Button onClick={c.closeLawyerNotice}>확인</Button>
      </Dialog>
      <Dialog
        open={c.pendingChoice !== null}
        onClose={c.closePendingChoice}
        title="저장하지 않은 변경이 있어요"
        description="경로를 바꾸면 이 화면의 미저장 수정은 사라져요. 저장된 초안은 보존돼요."
      >
        <div className={actionClass}>
          <Button variant="secondary" onClick={c.closePendingChoice}>
            계속 검토
          </Button>
          <Button variant="secondary" onClick={c.discardAndChange}>
            수정을 버리고 경로 변경
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function ResolutionPreparation({ controller: c }: { controller: ResolutionController }) {
  const { state, busy, blocked, reference } = c;
  if (!state) return null;
  return (
    <section aria-label="검토용 초안 준비" className="min-w-0 space-y-4">
      <SelectField
        label="문서 종류"
        value={c.kind}
        disabled={busy || blocked}
        onValueChange={c.changeKind}
        options={state.allowedDocumentKinds.map((value) => ({
          value,
          label: resolutionDocumentLabels[value],
        }))}
        wrapperClassName="max-w-sm"
      />
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        절차·서식의 공식 근거가 없으면 사실 정리 초안만 제공해요. 방어 선택만으로 항소를 권하지
        않아요.
      </p>
      <label className={checkClass}>
        <input
          type="checkbox"
          className={checkboxClass}
          checked={c.factsConfirmed}
          onChange={(event) => c.changeFactsConfirmed(event.target.checked)}
          disabled={busy || blocked}
        />
        현재 리포트의 사실과 사용할 자료를 확인했어요.
      </label>
      <Button
        variant="secondary"
        disabled={
          busy ||
          blocked ||
          c.scopeDirty ||
          c.contentDirty ||
          !c.factsConfirmed ||
          !reference ||
          state.status === "not_ready" ||
          state.status === "paused"
        }
        onClick={c.prepareDraft}
      >
        검토용 초안 준비
      </Button>
    </section>
  );
}

export function ResolutionDraft({ controller: c }: { controller: ResolutionController }) {
  const { state, busy, blocked, viewBlocked, draftCurrent, contentDirty, dirty, reviewed } = c;
  if (!state?.draft) return null;
  return (
    <section
      data-product-resolution-draft=""
      className="min-w-0 space-y-4 rounded-2xl border border-[var(--pui-border)] p-4 sm:p-6"
    >
      <header className="space-y-2">
        <h3 className="text-lg font-medium leading-7 [overflow-wrap:anywhere]">
          {state.draft.title}
        </h3>
        <p className="text-sm leading-7 text-[var(--pui-muted)]">
          {draftReviewState(state.draft, Boolean(draftCurrent), contentDirty, reviewed)}
        </p>
        <p className="text-xs leading-6 text-[var(--pui-muted)]">
          기준 리포트 {state.draft.basis.reportRevision} ·{" "}
          {state.draft.userEdited ? "사용자가 수정한 내용" : "근거에서 구성한 초안"}
        </p>
      </header>
      {!draftCurrent ? (
        <ResolutionNotice>
          <p>
            이전 기준의 초안이에요. 선택한 범위나 사건이 달라져 본문을 표시하거나 최신 문서로
            저장하지 않아요. 현재 기준으로 새 초안을 준비해 주세요.
          </p>
        </ResolutionNotice>
      ) : (
        <>
          <TextareaField
            label="초안 검토·수정"
            value={c.content}
            maxLength={20000}
            disabled={busy || blocked || state.status === "paused"}
            onChange={(event) => c.changeContent(event.target.value)}
            className="min-h-80 text-base leading-8"
          />
          <p className="text-sm leading-7 text-[var(--pui-muted)]">
            미입력 항목: {state.draft.missingFields.join(" · ")}
          </p>
          <label className={checkClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={reviewed}
              disabled={busy || blocked}
              onChange={(event) => c.changeReviewed(event.target.checked)}
            />
            사실·증거·미입력 항목과 수정한 내용을 검토했어요.
          </label>
          <div className={actionClass}>
            <Button
              variant="secondary"
              disabled={busy || blocked || !reviewed || state.status === "paused"}
              onClick={c.saveDraft}
            >
              검토한 초안 저장
            </Button>
            <Button
              variant="secondary"
              disabled={
                busy ||
                viewBlocked ||
                dirty ||
                state.draft.status !== "saved" ||
                !state.draft.reviewed
              }
              onClick={c.exportDraft}
            >
              <Download size={18} aria-hidden="true" />
              초안 다운로드
            </Button>
          </div>
        </>
      )}
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        사용자가 최종 확인하고 직접 제출해요. 이 화면에서 제출·발송·대리를 수행하지 않아요.
      </p>
    </section>
  );
}
