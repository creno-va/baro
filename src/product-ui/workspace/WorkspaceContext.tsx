import { ArrowRight, FileText } from "lucide-react";
import { CaseMaterials } from "../../components/workspace/CaseMaterials";
import { ButtonLink } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
export function WorkspaceContext({
  controller,
}: {
  controller: WorkspaceController;
  components: WorkspaceComponents;
}) {
  const { caseId, tab, view, setContextRequested, contextLoaded, privateContent, base } =
    controller;

  return view ? (
    <aside
      data-product-workspace-sidebar=""
      className="min-w-0 shrink-0"
      aria-label="사건 요약 및 준비 현황"
      {...privateContent}
    >
      <Disclosure
        data-product-workspace-context=""
        className="w-full bg-[var(--pui-surface)]"
        onOpenChange={(open) => {
          if (open && tab === "files") setContextRequested(true);
        }}
      >
        <DisclosureSummary>
          <FileText size={17} />
          <span>사건 요약과 준비 현황</span>
        </DisclosureSummary>
        <div
          data-product-workspace-context-content=""
          className="grid min-w-0 gap-5 text-sm leading-7 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-[var(--pui-text)]"
        >
          {tab === "files" && !contextLoaded ? (
            <p
              data-product-workspace-context-notices=""
              className="space-y-2 text-xs leading-6 text-[var(--pui-muted)]"
              role="status"
            >
              사건 요약을 불러오고 있어요…
            </p>
          ) : (
            <>
              <section data-product-workspace-context-overview="" className="min-w-0 space-y-3">
                <h2>현재까지 정리한 내용</h2>
                <p
                  data-product-workspace-summary=""
                  className="whitespace-pre-line text-sm leading-7 text-[var(--pui-text)]"
                >
                  {view.case.summary || "확인한 요약이 아직 없어요."}
                </p>
                <div data-product-workspace-summary-review="" className="flex flex-wrap gap-2">
                  <ButtonLink href={`${base}/summary?from=${tab}`}>
                    요약 검토하기 <ArrowRight size={16} />
                  </ButtonLink>
                </div>
              </section>
              <section>
                <h2>아직 확인할 내용</h2>
                {view.unknowns?.length ? (
                  <ul
                    data-product-workspace-facts=""
                    className="list-disc space-y-2 pl-5 text-sm leading-7"
                  >
                    {view.unknowns.map((unknown) => (
                      <li key={unknown}>{unknown}</li>
                    ))}
                  </ul>
                ) : (
                  <p
                    data-product-workspace-muted=""
                    className="text-xs leading-6 text-[var(--pui-muted)]"
                  >
                    추가로 확인할 내용이 아직 없어요.
                  </p>
                )}
              </section>
              <section>
                <h2>관련 인물</h2>
                {view.people?.length ? (
                  <ul
                    data-product-workspace-facts=""
                    className="list-disc space-y-2 pl-5 text-sm leading-7"
                  >
                    {view.people.map((person) => (
                      <li key={person.id}>
                        <strong>{person.label}</strong>
                        <p>{person.role}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    data-product-workspace-muted=""
                    className="text-xs leading-6 text-[var(--pui-muted)]"
                  >
                    정리된 관련 인물이 아직 없어요.
                  </p>
                )}
              </section>
              <section>
                <h2>준비 현황</h2>
                <p>대화와 자료를 바탕으로 사건의 흐름과 준비할 일을 정리해요.</p>
                <ul
                  data-product-workspace-preparation-badges=""
                  className="m-0 flex list-none flex-wrap gap-2 p-0 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:gap-2 [&_a]:rounded-xl [&_a]:border [&_a]:border-[var(--pui-border)] [&_a]:px-3 [&_a]:text-xs [&_strong]:font-semibold"
                  aria-label="준비 현황 바로가기"
                >
                  <li>
                    <a href={`${base}/files`}>
                      자료 <strong>{view.files.length}</strong>
                    </a>
                  </li>
                  <li>
                    <a href={`${base}/timeline`}>
                      타임라인 <strong>{view.timeline.length}</strong>
                    </a>
                  </li>
                  <li>
                    <a href={`${base}/actions`}>
                      남은 다음 행동{" "}
                      <strong>{view.actions.filter((action) => !action.done).length}</strong>
                    </a>
                  </li>
                </ul>
                <CaseMaterials caseId={caseId} files={view.files} facts={view.facts} />
              </section>
              {!!view.notices?.length && (
                <div
                  data-product-workspace-context-notices=""
                  className="space-y-2 text-xs leading-6 text-[var(--pui-muted)]"
                >
                  {view.notices.map((notice) => (
                    <p
                      key={notice}
                      data-product-workspace-muted=""
                      className="text-xs leading-6 text-[var(--pui-muted)]"
                    >
                      {notice}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Disclosure>
    </aside>
  ) : null;
}
