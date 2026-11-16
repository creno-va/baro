import { BookOpen, SearchCheck } from "lucide-react";
import type { FileView } from "../../client/api/types";
import { positionLabel } from "../../components/workspace/source-label";
import type { V2ConversationState, V2Fact, V2LegalAnalysisSnapshot } from "../../contracts/v2";
import { Button } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";

const statusLabels: Record<V2ConversationState["analysis"]["status"], string> = {
  not_started: "법률·판례 조사를 준비할 수 있어요",
  pending: "법률·판례 조사 접수됨",
  running: "법률·판례를 확인하고 있어요",
  ready: "현재 기준의 법률·판례 조사",
  partial: "일부 근거를 확인했어요",
  empty: "확인한 범위에서 관련 근거를 찾지 못했어요",
  unavailable: "공식 근거를 확인하지 못했어요",
  failed: "조사를 완료하지 못했어요",
  stale: "사건이나 자료가 바뀌어 다시 확인해야 해요",
};

/** Read-only projection of the same authorized snapshot used by reports.
 * Opening/expanding this component never starts research or calls a model. */
export function AnalysisView({
  state,
  files,
  facts = [],
  onReviewFile,
}: {
  state: V2ConversationState;
  files: readonly FileView[];
  facts?: readonly V2Fact[] | undefined;
  onReviewFile: (fileId: string) => void;
}) {
  const { analysis, snapshot } = state;
  const previous = ["stale", "pending", "running", "failed"].includes(analysis.status);
  return (
    <div
      data-product-conversation-analysis=""
      className="min-w-0 space-y-4 text-sm leading-6 text-[var(--pui-text)] [overflow-wrap:anywhere]"
    >
      <header className="flex items-start gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4">
        <SearchCheck
          size={20}
          className="mt-0.5 shrink-0 text-[var(--pui-primary)]"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-[var(--pui-muted)]">법률·판례 조사</p>
          <p role="status" className="font-medium">
            {statusLabels[analysis.status]}
          </p>
        </div>
      </header>
      {analysis.missingItems.length > 0 && (
        <ul
          aria-label="조사에 남은 확인 사항"
          className="list-disc space-y-1 rounded-xl bg-[var(--pui-background)] py-3 pl-8 pr-3 text-[var(--pui-muted)]"
        >
          {[...new Set(analysis.missingItems)].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!snapshot && (
        <p>확인된 사실과 자료는 보존돼요. 모르는 부분은 미확인으로 남겨 두고 정리할 수 있어요.</p>
      )}
      {snapshot && (
        <section
          aria-label={previous ? "이전 조사 결과" : "법률 분석 결과"}
          className="min-w-0 space-y-4"
        >
          {previous && (
            <p className="text-xs leading-6 text-[var(--pui-muted)]">
              아래는 이전 기준의 결과예요. 현재 사건의 분석 완료로 표시하지 않아요.
            </p>
          )}
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            {snapshot.context.casePurpose === "prepare_claim"
              ? "고소·청구 준비"
              : snapshot.context.casePurpose === "respond_to_claim"
                ? "상대방 주장 대응"
                : "사건 입장 미확정"}
            {" · "}요약 {snapshot.basis.summaryRevision}판 기준{" · "}
            <time dateTime={snapshot.checkedAt}>
              {new Date(snapshot.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </time>{" "}
            확인
          </p>
          <dl
            data-product-analysis-availability=""
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {snapshot.availability.map((item) => (
              <div
                key={JSON.stringify(item)}
                className="rounded-lg border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3"
              >
                <dt className="text-xs text-[var(--pui-muted)]">
                  {
                    {
                      statute: "법 조항",
                      precedent: "유사 판례",
                      official_guide: "공식 절차 안내",
                    }[item.kind]
                  }
                </dt>
                <dd className="mt-1 text-sm font-medium text-[var(--pui-text)]">
                  {
                    {
                      verified: "원문 확인",
                      limited: "일부 확인",
                      unavailable: "확인하지 못함",
                      empty: "확인 범위에서 관련 근거 없음",
                    }[item.status]
                  }
                </dd>
              </div>
            ))}
          </dl>
          <SnapshotDetails
            snapshot={snapshot}
            files={files}
            facts={facts}
            onReviewFile={onReviewFile}
          />
        </section>
      )}
    </div>
  );
}

function SnapshotDetails({
  snapshot,
  files,
  facts,
  onReviewFile,
}: {
  snapshot: V2LegalAnalysisSnapshot;
  files: readonly FileView[];
  facts: readonly V2Fact[];
  onReviewFile: (fileId: string) => void;
}) {
  const claim = (id: string) => {
    const item = snapshot.sourceClaims.find((claim) => claim.id === id);
    const citation = snapshot.citations.find((citation) => citation.id === item?.citationId);
    if (!item || !citation) return null;
    return (
      <article
        key={id}
        data-product-analysis-source=""
        className="space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3"
      >
        <p className="text-sm leading-6 text-[var(--pui-text)]">{item.text}</p>
        <a
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-medium text-[var(--pui-primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
        >
          <BookOpen size={14} className="shrink-0" aria-hidden="true" />
          {citation.title}
          {citation.kind === "statute" ? ` ${citation.article}` : ""} · 공식 원문
        </a>
      </article>
    );
  };
  const factList = (ids: readonly string[], label: string) => {
    const current = ids.flatMap((id) => {
      const fact = facts.find((fact) => fact.id === id);
      return fact ? [fact] : [];
    });
    return (
      ids.length > 0 && (
        <div>
          <strong className="text-xs font-semibold text-[var(--pui-text)]">{label}</strong>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {current.map((fact) => (
              <li key={fact.id}>
                {fact.text}
                {fact.certainty === "conflicting"
                  ? " · 상반된 내용"
                  : fact.certainty === "uncertain"
                    ? " · 미확인"
                    : ""}
              </li>
            ))}
          </ul>
          {current.length < ids.length && (
            <p className="text-xs leading-6 text-[var(--pui-muted)]">
              연결된 사실 일부는 현재 불러온 범위에 없어요. 이를 확인된 사실로 새로 추정하지 않아요.
            </p>
          )}
        </div>
      )
    );
  };
  return (
    <>
      {snapshot.issues.length > 0 && (
        <Disclosure open>
          <DisclosureSummary>법 조항·요건과 사건 근거</DisclosureSummary>
          {snapshot.issues.map((issue) => (
            <section key={issue.id} className="space-y-3">
              <h4 className="text-sm font-semibold text-[var(--pui-text)]">{issue.title}</h4>
              {issue.requirements.map((requirement) => (
                <div
                  key={requirement.id}
                  data-product-analysis-requirement=""
                  className="space-y-3 rounded-xl border border-[var(--pui-border)] p-3"
                >
                  <h5 className="text-sm font-medium text-[var(--pui-text)]">
                    {requirement.label}
                  </h5>
                  <p className="text-xs leading-6 text-[var(--pui-muted)]">
                    {
                      {
                        supported: "현재 자료에서 뒷받침되는 부분",
                        insufficient: "근거가 부족한 부분",
                        conflicting: "상반된 내용 확인 필요",
                      }[requirement.assessment]
                    }
                  </p>
                  {requirement.sourceClaimIds.map(claim)}
                  {factList(requirement.factIds, "관련 사실")}
                  {factList(requirement.conflictingFactIds, "다르게 진술된 사실")}
                  {requirement.evidence.length > 0 && (
                    <ul aria-label="요건에 연결된 자료" className="grid list-none gap-2 p-0">
                      {requirement.evidence.map((ref) => (
                        <li key={JSON.stringify(ref)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]"
                            disabled={!files.some((file) => file.id === ref.fileId)}
                            onClick={(event) => {
                              event.currentTarget.focus();
                              onReviewFile(ref.fileId);
                            }}
                          >
                            {files.find((file) => file.id === ref.fileId)?.name ??
                              "현재 확인할 수 없는 자료"}{" "}
                            · {positionLabel(ref.position)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {requirement.gaps.length > 0 && (
                    <div>
                      <strong className="text-xs font-semibold text-[var(--pui-text)]">
                        더 확인할 부분
                      </strong>
                      <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                        {[...new Set(requirement.gaps)].map((gap) => (
                          <li key={gap}>{gap}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </Disclosure>
      )}
      {snapshot.precedents.length > 0 && (
        <Disclosure open>
          <DisclosureSummary>관련 판례와 우리 사건 비교</DisclosureSummary>
          {snapshot.precedents.map((precedent) => (
            <section
              key={precedent.citationId}
              className="space-y-3 rounded-xl border border-[var(--pui-border)] p-3"
            >
              <h4 className="text-sm font-semibold text-[var(--pui-text)]">
                {snapshot.citations.find((citation) => citation.id === precedent.citationId)?.title}
              </h4>
              <h5 className="text-xs font-semibold text-[var(--pui-text)]">구체적으로 비슷한 점</h5>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                {precedent.commonalities.map((item) => (
                  <li key={JSON.stringify(item)}>{item.text}</li>
                ))}
              </ul>
              <h5 className="text-xs font-semibold text-[var(--pui-text)]">다른 점과 확인할 점</h5>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                {precedent.differences.map((item) => (
                  <li key={JSON.stringify(item)}>{item.text}</li>
                ))}
              </ul>
              <p>{precedent.preparationMeaning}</p>
              <Disclosure>
                <DisclosureSummary>비교에 사용한 공식 근거</DisclosureSummary>
                {factList(
                  [
                    ...new Set(
                      [...precedent.commonalities, ...precedent.differences].flatMap(
                        (item) => item.factIds,
                      ),
                    ),
                  ],
                  "비교에 사용한 사건 사실",
                )}
                {[
                  ...new Set(
                    [...precedent.commonalities, ...precedent.differences].flatMap(
                      (item) => item.sourceClaimIds,
                    ),
                  ),
                ].map(claim)}
              </Disclosure>
            </section>
          ))}
        </Disclosure>
      )}
      {[
        ["현재 우리 쪽 약점", snapshot.perspective.weaknesses],
        ["주장의 빈틈·미확인 사항", snapshot.perspective.claimGaps],
        ["보완할 자료", snapshot.perspective.additionalMaterials],
        ["이 결과의 한계", snapshot.limitations],
      ].map(
        ([label, items]) =>
          Array.isArray(items) &&
          items.length > 0 && (
            <section
              key={String(label)}
              className="space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3"
            >
              <h4 className="text-sm font-semibold text-[var(--pui-text)]">{label}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                {[...new Set(items)].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ),
      )}
      {snapshot.perspective.responsePoints.length > 0 && (
        <Disclosure open>
          <DisclosureSummary>상대방 주장과 대응 검토</DisclosureSummary>
          {snapshot.perspective.responsePoints.map((point) => (
            <section
              key={JSON.stringify(point)}
              className="space-y-3 rounded-xl border border-[var(--pui-border)] p-3"
            >
              <h4 className="text-sm font-semibold text-[var(--pui-text)]">
                {point.opponentPosition}
              </h4>
              <p>{point.ourExplanation}</p>
              {factList(point.conflictingFactIds, "상반되는 사실")}
              {point.sourceClaimIds.map(claim)}
              {point.additionalMaterials.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                  {[...new Set(point.additionalMaterials)].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </Disclosure>
      )}
    </>
  );
}
