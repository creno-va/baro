import type { V2ResolutionState } from "../../contracts/v2/resolution";
import { resolutionContextLabel, resolutionGuideTextParts } from "../../utils/resolution";

const linkClass =
  "inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)] [overflow-wrap:anywhere]";

export function ResolutionGuide({ state }: { state: V2ResolutionState }) {
  return (
    <div data-product-resolution-guide="" className="min-w-0 space-y-6">
      {state.basis && (
        <p className="text-xs leading-6 text-[var(--pui-muted)]">
          확인할 사건 맥락: {resolutionContextLabel(state.basis)}
        </p>
      )}
      <section aria-label="준비 순서와 확인할 안내" className="space-y-4">
        <h3 className="text-base font-medium">준비 순서와 확인할 안내</h3>
        <ol className="grid gap-3">
          {state.procedureChecks
            .filter((c) => c.id !== "public-defender")
            .map((check, index) => (
              <li
                key={check.id}
                className="flex min-w-0 gap-3 rounded-2xl border border-[var(--pui-border)] p-4 sm:p-5"
              >
                <span
                  aria-hidden="true"
                  className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-[var(--pui-background)] text-xs tabular-nums text-[var(--pui-muted)]"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
                  <strong className="block text-sm font-medium leading-7">{check.label}</strong>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--pui-muted)]">
                    {resolutionGuideTextParts(check.detail).map((part) =>
                      part.url ? (
                        <a
                          key={`${part.start}-${part.url}`}
                          href={part.url}
                          target="_blank"
                          rel="noreferrer"
                          className={linkClass}
                        >
                          공식 안내 원문에서 확인
                        </a>
                      ) : (
                        part.text
                      ),
                    )}
                  </p>
                  <small className="block text-xs leading-6 text-[var(--pui-muted)]">
                    {check.status === "verified"
                      ? "공식 근거 확인 · 사건에 맞는지 검토 필요"
                      : "공식 안내 확인 필요"}
                  </small>
                  {check.sourceClaimIds.map((id) => {
                    const claim = state.sourceClaims.find((c) => c.id === id);
                    const citation = state.citations.find((c) => c.id === claim?.citationId);
                    return citation ? (
                      <a
                        key={id}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className={linkClass}
                      >
                        {citation.title} · 확인{" "}
                        {new Date(citation.verifiedAt).toLocaleDateString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </a>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
        </ol>
      </section>
      {state.weaknessChecks.length > 0 && (
        <section aria-label="약점과 보완할 자료·사실" className="space-y-3">
          <h3 className="text-base font-medium">약점과 보완할 자료·사실</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-[var(--pui-muted)]">
            {[...new Set(state.weaknessChecks)].map((text) => (
              <li key={text} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
