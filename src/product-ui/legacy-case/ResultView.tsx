import { LegacyCaseSection, legacyLinkClass, legacyMutedClass } from "./LegacyCaseParts";
import type { LegacyResultController, LegacyResultProps } from "./useLegacyResultController";

export function LegacyResultView({
  result,
  controller,
}: Pick<LegacyResultProps, "result"> & { controller: LegacyResultController }) {
  const { checked, summary, evidenceChange, citationClick } = controller;
  if (result.kind !== "guidance")
    return (
      <LegacyCaseSection
        title={result.kind === "urgent_redirect" ? "안전 확인이 우선이에요" : "지원 범위 안내"}
        data-product-legacy-result=""
      >
        <p className="text-base leading-8">{result.message}</p>
        <div className={legacyMutedClass}>
          {result.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
        <a className={legacyLinkClass} href="/">
          지원 범위와 한계 보기
        </a>
      </LegacyCaseSection>
    );
  return (
    <div data-product-legacy-result="" className="min-w-0 space-y-6">
      <LegacyCaseSection aria-labelledby="result-summary" ref={summary}>
        <h2 id="result-summary" className="text-lg font-semibold tracking-tight">
          상황 정리
        </h2>
        <div className="rounded-xl bg-[var(--pui-background)] p-4 text-xs leading-6 text-[var(--pui-muted)]">
          <p>
            AI가 만든 일반 정보이며 법률 자문이 아니에요. 고지 버전 {result.noticeVersion} · 기준일{" "}
            {result.asOfDate}
          </p>
          {result.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
        <div className="grid min-w-0 gap-6 md:grid-cols-3">
          {[
            { title: "사용자가 알려준 내용", items: result.summary.userStatements },
            { title: "AI가 정리한 내용", items: result.summary.organizedByAi },
            { title: "확인 필요", items: result.summary.unknowns },
          ].map(({ title, items }) => (
            <div key={title} className="min-w-0 space-y-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <ul className="list-disc space-y-2 pl-4 text-sm leading-7 text-[var(--pui-muted)]">
                {items.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </LegacyCaseSection>
      <LegacyCaseSection title="시간 순서">
        <ol className="space-y-5 border-l border-[var(--pui-border)] pl-5">
          {result.timeline.map((entry) => (
            <li key={`${entry.date}-${entry.event}-${entry.source}`} className="space-y-1">
              <p className="text-sm font-medium leading-7">
                <span>{entry.date ?? "날짜 확인 필요"}</span> · {entry.event}
              </p>
              <p data-product-legacy-provenance="" className={legacyMutedClass}>
                {entry.source === "user" ? "사용자 진술" : "AI 정리"} ·{" "}
                {entry.confidence === "stated"
                  ? "진술됨"
                  : entry.confidence === "inferred"
                    ? "추정 · 확인 필요"
                    : "미확인"}
              </p>
            </li>
          ))}
        </ol>
      </LegacyCaseSection>
      <LegacyCaseSection title="살펴볼 쟁점">
        <div className="divide-y divide-[var(--pui-border)]">
          {result.issues.map((issue) => (
            <article key={issue.id} className="space-y-3 py-5 first:pt-0 last:pb-0">
              <h3 className="text-sm font-semibold leading-7">{issue.title}</h3>
              <p className={legacyMutedClass}>{issue.explanation}</p>
              <p className={legacyMutedClass}>불확실성: {issue.uncertainty}</p>
              <div className="flex flex-wrap gap-x-4">
                {issue.citationIds.map((id) => (
                  <a className={legacyLinkClass} key={id} href={`#source-${id}`}>
                    연결된 공식 근거 확인
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </LegacyCaseSection>
      <LegacyCaseSection title="자료 체크리스트">
        <p className={legacyMutedClass}>체크는 이 화면에서만 유지되며 법적 완료를 뜻하지 않아요.</p>
        <div className="grid gap-3">
          {result.evidenceChecklist.map((item, index) => (
            <label
              key={item.id}
              data-product-legacy-evidence-choice=""
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-[var(--pui-background)] p-4"
            >
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                onChange={evidenceChange(item, index)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--pui-primary)]"
              />
              <span className="min-w-0 text-sm font-medium leading-6">
                {item.label} ·{" "}
                {item.status === "provided"
                  ? "제공됨"
                  : item.status === "missing"
                    ? "없음"
                    : "확인 필요"}
                <small className="mt-1 block text-xs font-normal leading-6 text-[var(--pui-muted)]">
                  {item.why}
                </small>
              </span>
            </label>
          ))}
        </div>
      </LegacyCaseSection>
      <LegacyCaseSection title="다음에 확인할 일">
        <div className="divide-y divide-[var(--pui-border)]">
          {result.nextSteps.map((item) => (
            <article key={item.id} className="space-y-3 py-5 first:pt-0 last:pb-0">
              <h3 className="text-sm font-semibold leading-7">{item.label}</h3>
              <p className={legacyMutedClass}>{item.purpose}</p>
              <p className={legacyMutedClass}>주의: {item.caution}</p>
              {item.citationIds.map((id) => (
                <a className={legacyLinkClass} key={id} href={`#source-${id}`}>
                  연결된 공식 근거 확인
                </a>
              ))}
            </article>
          ))}
        </div>
      </LegacyCaseSection>
      <LegacyCaseSection title="공식 출처">
        <p className={legacyMutedClass}>
          시행일과 실제 사건에 적용되는 시점은 다를 수 있어요. 원문과 적용 여부를 확인해 주세요.
        </p>
        <ul className="space-y-5">
          {result.citations.map((citation, index) => (
            <li id={`source-${citation.id}`} key={citation.id} className="scroll-mt-24 space-y-1">
              <a
                className={legacyLinkClass}
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={citationClick(index)}
              >
                {citation.lawName} {citation.article} 공식 원문 (새 탭)
              </a>
              <p className={legacyMutedClass}>
                시행일 {citation.effectiveDate} · 확인일 {citation.verifiedAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      </LegacyCaseSection>
    </div>
  );
}
