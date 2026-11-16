import type { CaseView } from "../../client/api/types";
import type { V2Summary, V2SummaryReconciliationProposal } from "../../contracts/v2";
import { FactAnswer } from "./FactAnswer";
import { SummaryDisclosure } from "./SummaryDisclosure";

type ReadingProps = {
  summary: V2Summary;
  base: string;
  context?: CaseView["intakeQuestions"];
  files?: readonly { id: string; name: string }[];
};
const headingClass = "text-sm font-medium leading-6 text-[var(--pui-text)]";

export function SummaryReading({ summary, base, context, files = [] }: ReadingProps) {
  return (
    <div data-product-summary-reading="" className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
      <section aria-label="전체 사건 정리">
        <h2 className={headingClass}>전체 정리</h2>
        <p
          data-product-summary-overview=""
          className="mt-3 whitespace-pre-wrap text-base leading-8 text-[var(--pui-text)]"
        >
          {summary.overview}
        </p>
      </section>
      {summary.facts.length > 0 && (
        <section aria-label="사실과 출처">
          <h2 className={headingClass}>사실과 출처</h2>
          <div>
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
          <h2 className={headingClass}>관련된 사람과 관계</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--pui-muted)]">
            {summary.parties.map((party) => (
              <li key={party.id}>
                {party.label} · {party.role}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.unknowns.length > 0 && (
        <section
          aria-label="아직 확인이 필요한 내용"
          className="rounded-2xl border border-[var(--pui-border)] p-4 sm:p-5"
        >
          <h2 className={headingClass}>아직 확인이 필요한 내용</h2>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-6 text-[var(--pui-muted)]">
            {[...new Set(summary.unknowns)].map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      {[...new Set(summary.notices)].map((notice) => (
        <p key={notice} className="text-xs leading-6 text-[var(--pui-muted)]">
          {notice}
        </p>
      ))}
    </div>
  );
}

/** Server-issued snapshots remain read-only until explicit exact confirmation. */
export function SummaryChanges({
  proposal,
  base,
  context,
  files = [],
}: Omit<ReadingProps, "summary"> & { proposal: V2SummaryReconciliationProposal }) {
  return (
    <section data-product-summary-proposal="" aria-label="변경 전후 확인" className="space-y-5">
      <header>
        <h2 className="text-lg font-medium text-[var(--pui-text)]">변경안을 확인해 주세요</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--pui-muted)]">
          아직 기존 정리에 반영하지 않았어요. 출처와 서로 다른 진술, 확인이 필요한 내용도 함께
          살펴보세요.
        </p>
      </header>
      <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-[var(--pui-muted)]">
        {[...new Set(proposal.reasons)].map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="border-y border-[var(--pui-border)] py-2">
        <SummaryDisclosure title="변경 전 전체 내용">
          <SummaryReading summary={proposal.before} base={base} context={context} files={files} />
        </SummaryDisclosure>
      </div>
      <div className="rounded-2xl border border-[var(--pui-border)] p-4 sm:p-6">
        <h3 className="mb-6 text-sm font-medium text-[var(--pui-text)]">변경 후 제안</h3>
        <SummaryReading summary={proposal.after} base={base} context={context} files={files} />
      </div>
    </section>
  );
}
