import type { CaseView } from "../../client/api/types";
import type { V2Summary, V2SummaryReconciliationProposal } from "../../contracts/v2";
import { FactAnswer } from "./FactAnswer";

type ReadingProps = {
  summary: V2Summary;
  base: string;
  context?: CaseView["intakeQuestions"];
  files?: readonly { id: string; name: string }[];
};
export function SummaryReading({ summary, base, context, files = [] }: ReadingProps) {
  return (
    <div className="summary-reading">
      <section aria-label="전체 사건 정리">
        <h2>전체 정리</h2>
        <p className="summary-reading-overview">{summary.overview}</p>
      </section>
      {summary.facts.length > 0 && (
        <section aria-label="사실과 출처">
          <h2>사실과 출처</h2>
          <div className="summary-reading-facts">
            {summary.facts.map((fact) => (
              <article key={fact.id} data-fact-id={fact.id}>
                <FactAnswer fact={fact} context={context} base={base} files={files} />
              </article>
            ))}
          </div>
        </section>
      )}
      {summary.parties.length > 0 && (
        <section aria-label="관련된 사람과 관계">
          <h2>관련된 사람과 관계</h2>
          <ul>
            {summary.parties.map((party) => (
              <li key={party.id}>
                {party.label} · {party.role}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.unknowns.length > 0 && (
        <section aria-label="아직 확인이 필요한 내용">
          <h2>아직 확인이 필요한 내용</h2>
          <ul>
            {[...new Set(summary.unknowns)].map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      {[...new Set(summary.notices)].map((notice) => (
        <p key={notice} className="intake-scene-notice">
          {notice}
        </p>
      ))}
    </div>
  );
}

/** Both snapshots are server-issued; no form field can write either snapshot. */
export function SummaryChanges({
  proposal,
  base,
  context,
  files = [],
}: Omit<ReadingProps, "summary"> & { proposal: V2SummaryReconciliationProposal }) {
  return (
    <section className="summary-changes" aria-label="변경 전후 확인">
      <h2>변경안을 확인해 주세요</h2>
      <p>
        아직 기존 정리에 반영하지 않았어요. 출처와 서로 다른 진술, 확인이 필요한 내용도 함께
        살펴보세요.
      </p>
      <ul className="summary-change-reasons">
        {[...new Set(proposal.reasons)].map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="summary-comparison">
        <details>
          <summary>변경 전 전체 내용</summary>
          <SummaryReading summary={proposal.before} base={base} context={context} files={files} />
        </details>
        <div className="summary-candidate">
          <h3>변경 후 제안</h3>
          <SummaryReading summary={proposal.after} base={base} context={context} files={files} />
        </div>
      </div>
    </section>
  );
}
