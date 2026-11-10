import type { FileView } from "../../client/api/types";
import type { V2ConversationState, V2Fact, V2LegalAnalysisSnapshot } from "../../contracts/v2";
import { Button } from "../ui/button";
import { Disclosure, DisclosureSummary } from "../ui/disclosure";
import { positionLabel } from "./source-label";

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
export function ConversationAnalysis({
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
    <div className="conversation-analysis">
      <p role="status">{statusLabels[analysis.status]}</p>
      {analysis.missingItems.length > 0 && (
        <ul aria-label="조사에 남은 확인 사항">
          {[...new Set(analysis.missingItems)].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!snapshot && (
        <p>확인된 사실과 자료는 보존돼요. 모르는 부분은 미확인으로 남겨 두고 정리할 수 있어요.</p>
      )}
      {snapshot && (
        <section aria-label={previous ? "이전 조사 결과" : "법률 분석 결과"}>
          {previous && (
            <p className="workspace-muted">
              아래는 이전 기준의 결과예요. 현재 사건의 분석 완료로 표시하지 않아요.
            </p>
          )}
          <p className="workspace-muted">
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
          <dl className="conversation-analysis-availability">
            {snapshot.availability.map((item) => (
              <div key={JSON.stringify(item)}>
                <dt>
                  {
                    {
                      statute: "법 조항",
                      precedent: "유사 판례",
                      official_guide: "공식 절차 안내",
                    }[item.kind]
                  }
                </dt>
                <dd>
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
      <div key={id} className="conversation-analysis-source">
        <p>{item.text}</p>
        <a href={citation.url} target="_blank" rel="noopener noreferrer">
          {citation.title}
          {citation.kind === "statute" ? ` ${citation.article}` : ""} · 공식 원문
        </a>
      </div>
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
          <strong>{label}</strong>
          <ul>
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
            <p className="workspace-muted">
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
            <section key={issue.id}>
              <h4>{issue.title}</h4>
              {issue.requirements.map((requirement) => (
                <div key={requirement.id} className="conversation-analysis-requirement">
                  <h5>{requirement.label}</h5>
                  <p className="workspace-muted">
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
                    <ul aria-label="요건에 연결된 자료">
                      {requirement.evidence.map((ref) => (
                        <li key={JSON.stringify(ref)}>
                          <Button
                            variant="ghost"
                            size="sm"
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
                      <strong>더 확인할 부분</strong>
                      <ul>
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
            <section key={precedent.citationId}>
              <h4>
                {snapshot.citations.find((citation) => citation.id === precedent.citationId)?.title}
              </h4>
              <h5>구체적으로 비슷한 점</h5>
              <ul>
                {precedent.commonalities.map((item) => (
                  <li key={JSON.stringify(item)}>{item.text}</li>
                ))}
              </ul>
              <h5>다른 점과 확인할 점</h5>
              <ul>
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
            <section key={String(label)}>
              <h4>{label}</h4>
              <ul>
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
            <section key={JSON.stringify(point)}>
              <h4>{point.opponentPosition}</h4>
              <p>{point.ourExplanation}</p>
              {factList(point.conflictingFactIds, "상반되는 사실")}
              {point.sourceClaimIds.map(claim)}
              {point.additionalMaterials.length > 0 && (
                <ul>
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
