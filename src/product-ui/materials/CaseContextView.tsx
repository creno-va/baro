import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { ArrowRight, FileText, Scale } from "lucide-react";
import { lazy, Suspense } from "react";
import { Button, ButtonLink } from "../Button";
import { useClientReady } from "../utils";
import type { CaseContextPanelProps } from "./types";
import type { CaseContextController } from "./useCaseContextController";

function PrecedentUnavailable({ caseId }: { caseId: string }) {
  return (
    <section role="alert" className="space-y-3 text-sm leading-6">
      <p>판례 도구를 불러오지 못했어요. 작성 중인 대화는 그대로 유지돼요.</p>
      <ButtonLink
        variant="secondary"
        size="sm"
        href={`/cases/${encodeURIComponent(caseId)}/precedents`}
        target="_blank"
        rel="noopener noreferrer"
      >
        별도 화면에서 판례 보기
      </ButtonLink>
    </section>
  );
}
const PrecedentResearch = lazy(() =>
  import("../../components/workspace/PrecedentResearch")
    .then((module) => ({ default: module.PrecedentResearch }))
    .catch(() => ({ default: PrecedentUnavailable })),
);
const tabs = ["지금 확인", "자료", "판례"] as const;
type Props = CaseContextPanelProps & { controller: CaseContextController };
const taskClass =
  "w-full justify-start gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3 text-left font-normal whitespace-normal";

export function CaseContextOverview({
  controller: c,
  caseId,
  files,
  reportStatus,
  preparation,
  canAdd,
  onAdd,
  onReview,
}: Props) {
  return (
    <div className="space-y-3">
      <header className="space-y-2 pb-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--pui-muted)]">
          사건 준비
        </p>
        <h3 className="text-base font-semibold leading-6">
          {c.attention
            ? "이 부분부터 확인해 보세요"
            : files.length
              ? "차근차근 준비하고 있어요"
              : "자료와 함께 더 정확하게"}
        </h3>
        <p className="text-xs leading-5 text-[var(--pui-muted)]">
          대화를 이어가면서 자료와 리포트를 함께 확인하세요.
        </p>
      </header>
      {c.failed.map((file) => (
        <Button
          key={file.id}
          variant="ghost"
          className={taskClass}
          onClick={(event) => onReview(file, event.currentTarget)}
        >
          <FileText size={18} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <strong className="block text-sm font-medium">{file.name}</strong>
            <small className="mt-1 block text-xs text-[var(--pui-muted)]">
              {file.uploadRejection
                ? "등록 거절 내용을 확인해 주세요"
                : "처리 실패 내용을 확인해 주세요"}
            </small>
          </span>
          <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
        </Button>
      ))}
      {c.processing.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl bg-[var(--pui-background)] p-3 text-xs leading-5"
        >
          <span
            aria-hidden="true"
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--pui-muted)]"
          />
          <div>
            <strong className="font-medium">자료 {c.processing.length}개를 처리하고 있어요</strong>
            <p className="mt-1 text-[var(--pui-muted)]">
              완료된 자료는 자료 탭에서 확인할 수 있어요.
            </p>
          </div>
        </div>
      )}
      {preparation}
      <ButtonLink
        variant="ghost"
        className={taskClass}
        href={`/cases/${encodeURIComponent(caseId)}/reports?mode=conversation`}
      >
        <FileText size={18} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-medium">
            {reportStatus === "stale"
              ? "리포트를 갱신해 주세요"
              : reportStatus === "failed"
                ? "리포트 상태를 확인해 주세요"
                : reportStatus === "not_started"
                  ? "리포트 준비하기"
                  : reportStatus === "pending"
                    ? "리포트 준비 상태 보기"
                    : reportStatus === "ready"
                      ? "지금까지 정리한 내용 보기"
                      : "리포트 확인하기"}
          </strong>
          <small className="mt-1 block text-xs text-[var(--pui-muted)]">
            준비 중에도 리포트를 확인할 수 있어요
          </small>
        </span>
        <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
      </ButtonLink>
      {!files.length && (
        <Button variant="ghost" className={taskClass} onClick={onAdd} disabled={!canAdd}>
          <FileText size={18} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-medium">첫 자료 추가하기</strong>
            <small className="mt-1 block text-xs text-[var(--pui-muted)]">
              받은 문서나 관련 자료를 첨부하세요
            </small>
          </span>
          <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
        </Button>
      )}
      <Button variant="ghost" className={taskClass} onClick={() => c.select(2)}>
        <Scale size={18} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-medium">관련 판례 살펴보기</strong>
          <small className="mt-1 block text-xs text-[var(--pui-muted)]">
            사건 요약을 바탕으로 직접 찾아보세요
          </small>
        </span>
        <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function CaseContextView(props: Props) {
  const ready = useClientReady();
  if (!ready) return null;
  const { controller: c, files, feedback, viewer, materials, viewingFileId, caseId } = props;
  return (
    <TabGroup
      data-product-case-context=""
      selectedIndex={c.active}
      onChange={c.select}
      className="flex h-full min-h-0 flex-col text-[var(--pui-text)]"
    >
      <TabList
        aria-label="사건 참고 자료"
        className="grid shrink-0 grid-cols-3 gap-1 border-b border-[var(--pui-border)] p-2"
      >
        {tabs.map((label, index) => (
          <Tab
            key={label}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium text-[var(--pui-muted)] data-selected:bg-[var(--pui-background)] data-selected:text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)]"
          >
            {label}
            {index === 1 && files.length > 0 && (
              <span className="rounded-full border border-[var(--pui-border)] px-1.5 text-[10px]">
                {files.length}
              </span>
            )}
            {index === 0 && c.attention && (
              <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--pui-primary)]" />
            )}
          </Tab>
        ))}
      </TabList>
      {feedback && (
        <div className="border-b border-[var(--pui-border)] px-4 py-3 text-xs leading-5">
          {feedback}
        </div>
      )}
      <TabPanels className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TabPanel
          as="section"
          unmount={false}
          className="space-y-4 p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)]"
        >
          <CaseContextOverview {...props} />
        </TabPanel>
        <TabPanel
          as="section"
          unmount={false}
          className="p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)]"
        >
          {viewer}
          <div hidden={!!viewingFileId}>{materials}</div>
        </TabPanel>
        <TabPanel
          as="section"
          unmount={false}
          className="p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--pui-focus)]"
        >
          {c.researchOpened && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-[var(--pui-muted)]">
                  판례 도구를 불러오고 있어요.
                </p>
              }
            >
              <PrecedentResearch key={caseId} caseId={caseId} embedded />
            </Suspense>
          )}
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
