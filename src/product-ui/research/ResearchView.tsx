import { ArrowLeft, ChevronDown, ExternalLink, Search } from "lucide-react";
import type { ComponentType } from "react";
import { ApiError, errorMessage } from "../../client/api/errors";
import { accessHref } from "../../client/return-path";
import { CaseNavigation } from "../../components/workspace/CaseNavigation";
import { PrecedentDocument } from "../../components/workspace/PrecedentDocument";
import type { V2PrecedentTopic } from "../../contracts/v2/precedent-research";
import { PRECEDENT_TOPIC_LABELS } from "../../contracts/v2/precedent-topics";
import { Button as ControlButton } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import { isAccessError } from "./presentation";
import { ResearchSpinner as Spinner } from "./ResearchNotice";
import type { ComparisonPanelProps } from "./useComparisonPanelController";
import type { ResearchController } from "./useResearchController";
export function ResearchView({
  controller,
  ComparisonPanel,
}: {
  controller: ResearchController;
  ComparisonPanel: ComponentType<ComparisonPanelProps>;
}) {
  const {
    caseId,
    embedded,
    context,
    topics,
    result,
    document,
    selected,
    busy,
    reading,
    error,
    readError,
    access,
    documentHeading,
    detailView,
    resultOpener,
    visibleTopics,
    allTopics,
    chosen,
    sourceCurrent,
    setReload,
    setError,
    setTopics,
    backToResults,
    search,
    read,
  } = controller;
  const topicOption = (topic: V2PrecedentTopic) => (
    <label
      key={topic}
      data-product-precedent-topic=""
      className="m-0 grid min-h-11 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-3 py-2 text-sm has-checked:border-[var(--pui-text)] has-checked:bg-[var(--pui-background)] has-disabled:cursor-not-allowed has-disabled:opacity-50 md:flex"
    >
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
        checked={topics.includes(topic)}
        disabled={busy || (!topics.includes(topic) && topics.length >= 2)}
        onChange={() =>
          setTopics((prior) =>
            prior.includes(topic)
              ? prior.filter((value) => value !== topic)
              : [...prior, topic].slice(0, 2),
          )
        }
      />
      <span>{PRECEDENT_TOPIC_LABELS[topic]}</span>
      {context?.recommendedTopics.includes(topic) && (
        <small className="col-start-2 justify-self-start rounded-md bg-[var(--pui-border)] px-1.5 py-0.5 text-[10px] font-medium">
          추천
        </small>
      )}
    </label>
  );

  return (
    <section
      data-product-precedent-research=""
      className="min-w-0 space-y-6 text-[var(--pui-text)] [overflow-wrap:anywhere]"
      aria-label="관련 판례 탐색"
    >
      {!embedded && (
        <CaseNavigation
          caseId={caseId}
          title={access.ready && context ? context.caseTitle : "관련 판례"}
          active="precedents"
        />
      )}
      <header className="space-y-2" hidden={selected !== null}>
        <div>
          <h2 className="text-2xl font-medium tracking-tight">사건과 비슷한 판례 찾기</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--pui-muted)]">
            확인한 사건 요약을 바탕으로 검색 주제를 추천해요. 궁금한 주제를 골라 공식 판례를
            살펴보세요.
          </p>
        </div>
      </header>
      {!!error && (
        <div
          className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-7 text-[var(--pui-muted)]"
          role="alert"
        >
          <p>
            {error instanceof ApiError && error.code === "CONFLICT"
              ? "최신 사건 요약을 확인한 뒤 다시 찾아 주세요."
              : errorMessage(error)}
          </p>
          <div className="flex flex-wrap items-center gap-3 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:text-sm [&_a]:underline [&_a]:underline-offset-4">
            <ControlButton
              variant="secondary"
              type="button"
              onClick={() => {
                setReload((n) => n + 1);
                void access.verify().catch(setError);
              }}
            >
              다시 불러오기
            </ControlButton>
            {error instanceof ApiError && error.code === "CONFLICT" && (
              <a href={`/cases/${encodeURIComponent(caseId)}/summary?from=precedents`}>
                사건 요약 확인
              </a>
            )}
            {isAccessError(error) && (
              <a
                href={accessHref(
                  error instanceof ApiError && error.code === "CONSENT_REQUIRED"
                    ? "consent"
                    : "login",
                  `/cases/${caseId}/precedents`,
                )}
              >
                {error instanceof ApiError && error.code === "CONSENT_REQUIRED"
                  ? "필수 동의 확인"
                  : "로그인 확인"}
              </a>
            )}
            <a href="/cases">내 사건으로 돌아가기</a>
          </div>
        </div>
      )}
      {!access.ready || !context ? (
        !error && <p role="status">확인한 사건 요약을 불러오고 있어요.</p>
      ) : (
        <>
          <div className="space-y-5" hidden={selected !== null}>
            <form
              noValidate
              data-product-precedent-search=""
              className="min-w-0 space-y-4 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <fieldset disabled={busy} className="min-w-0 space-y-3 border-0 p-0">
                <legend className="mb-3 text-sm font-medium [&_span]:ml-2 [&_span]:text-xs [&_span]:font-normal [&_span]:text-[var(--pui-muted)]">
                  검색 주제 <span>최대 2개 · {topics.length}개 선택</span>
                </legend>
                <div data-product-precedent-topics="" className="flex flex-wrap gap-2">
                  {visibleTopics.map(topicOption)}
                </div>
                <Disclosure>
                  <DisclosureSummary>다른 주제 선택</DisclosureSummary>
                  <div data-product-precedent-topics="" className="flex flex-wrap gap-2">
                    {allTopics.filter((topic) => !visibleTopics.includes(topic)).map(topicOption)}
                  </div>
                </Disclosure>
              </fieldset>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--pui-border)] pt-4 [&_p]:max-w-2xl [&_p]:text-xs [&_p]:leading-6 [&_p]:text-[var(--pui-muted)]">
                <p>
                  외부에는 선택한 법률 주제만 전달돼요. 사건 진술과 개인정보는 검색어로 보내지
                  않아요.
                </p>
                <ControlButton
                  variant="secondary"
                  className="shrink-0"
                  type="submit"
                  disabled={!topics.length || busy}
                  aria-busy={busy || undefined}
                >
                  {busy ? <Spinner /> : <Search size={17} aria-hidden="true" />}
                  {busy ? "공식 원문 확인 중…" : "판례 찾기"}
                </ControlButton>
              </div>
            </form>
            {result && (
              <>
                <div
                  data-product-precedent-results-heading=""
                  className="flex flex-wrap items-center justify-between gap-2 text-sm [&_h3]:font-semibold [&_time]:text-xs [&_time]:text-[var(--pui-muted)]"
                  role="status"
                >
                  <h3>
                    검색 결과 <span>{result.items.length}건</span>
                  </h3>
                  <time dateTime={result.checkedAt}>
                    {new Date(result.checkedAt).toLocaleString("ko-KR")}
                  </time>
                </div>
                {!result.items.length && (
                  <p className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-7 text-[var(--pui-muted)]">
                    {result.status === "unavailable"
                      ? "판례를 확인하지 못했어요. 잠시 후 다시 검색해 주세요."
                      : "선택한 주제와 가까운 판례를 찾지 못했어요. 다른 주제로 다시 찾아보세요."}
                  </p>
                )}
                {!!result.items.length && (
                  <ul
                    data-product-precedent-list=""
                    className="grid list-none gap-3 p-0"
                    aria-label="관련 판례 목록"
                  >
                    {result.items.map((item) => (
                      <li key={item.id}>
                        <ControlButton
                          variant="secondary"
                          type="button"
                          data-product-precedent-card=""
                          className="h-auto w-full min-w-0 flex-col items-start justify-start gap-3 whitespace-normal p-4 text-left [&_h4]:text-base [&_h4]:font-semibold [&_h4]:leading-7"
                          disabled={!sourceCurrent}
                          onClick={(event) => {
                            resultOpener.current = event.currentTarget;
                            void read(item);
                          }}
                          aria-label={`${item.citation.title} · ${item.citation.caseNumber}`}
                        >
                          <h4 className="line-clamp-2 h-14 w-full shrink-0">
                            {item.citation.title}
                          </h4>
                          <div
                            data-product-precedent-metadata=""
                            className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--pui-muted)]"
                          >
                            <span>{item.citation.court}</span>
                            <span>{item.citation.decisionDate}</span>
                            <span>{item.citation.caseNumber}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-normal text-[var(--pui-muted)] [&_span]:rounded-lg [&_span]:bg-[var(--pui-background)] [&_span]:px-2 [&_span]:py-1">
                            {item.matchedTopics.map((topic) => (
                              <span key={topic}>{PRECEDENT_TOPIC_LABELS[topic]}</span>
                            ))}
                          </div>
                        </ControlButton>
                      </li>
                    ))}
                  </ul>
                )}
                {result.nextCursor && (
                  <div className="flex justify-center">
                    <ControlButton
                      variant="ghost"
                      type="button"
                      disabled={busy || !sourceCurrent}
                      aria-busy={busy || undefined}
                      onClick={() => void search(true)}
                    >
                      {busy ? <Spinner /> : <ChevronDown size={17} aria-hidden="true" />}
                      {busy ? "불러오는 중…" : "더보기"}
                    </ControlButton>
                  </div>
                )}
              </>
            )}
          </div>
          {selected !== null && (
            <section
              ref={detailView}
              data-product-precedent-detail=""
              className="min-w-0 space-y-5"
              hidden={selected === null}
              aria-label="선택한 판례"
            >
              <h2 className="sr-only">판례 상세</h2>
              <ControlButton
                variant="secondary"
                className="gap-2"
                type="button"
                onClick={backToResults}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                검색 결과로
              </ControlButton>
              <ComparisonPanel
                caseId={caseId}
                context={context}
                selected={
                  sourceCurrent && chosen && document?.citation.id === chosen.citation.id
                    ? chosen
                    : null
                }
                key={chosen?.citation.sourceId ?? selected}
                sourceId={document?.citation.sourceId ?? chosen?.citation.sourceId ?? null}
                fullText={document?.fullText}
                sourceNeedsRefresh={!!document && (!sourceCurrent || !chosen)}
                access={access}
                onSettled={() => setReload((n) => n + 1)}
                onRefreshSources={() => void search()}
                heading={
                  <header
                    data-product-precedent-document-heading=""
                    className="min-w-0 space-y-2 [&_h3]:rounded-lg [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:leading-8 [&_h3]:focus-visible:outline-2 [&_h3]:focus-visible:outline-offset-4 [&_h3]:focus-visible:outline-[var(--pui-focus)]"
                  >
                    <h3 ref={documentHeading} tabIndex={-1}>
                      {document?.citation.title ?? chosen?.citation.title ?? "판례 내용"}
                    </h3>
                    {document && (
                      <div
                        data-product-precedent-metadata=""
                        className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--pui-muted)]"
                      >
                        <span>{document.citation.court}</span>
                        <span>{document.citation.decisionDate}</span>
                        <span>{document.citation.caseNumber}</span>
                      </div>
                    )}
                    {reading && <p role="status">선택한 판례를 불러오고 있어요.</p>}
                    {!!readError && (
                      <div role="alert">
                        <p>판례를 다시 확인하지 못했어요. 잠시 후 다시 확인하거나 검색해 주세요.</p>
                        {chosen && (
                          <ControlButton
                            variant="secondary"
                            type="button"
                            onClick={() =>
                              void (readError instanceof ApiError && readError.code === "NOT_FOUND"
                                ? search()
                                : read(chosen))
                            }
                          >
                            {readError instanceof ApiError && readError.code === "NOT_FOUND"
                              ? "다시 검색"
                              : "다시 확인"}
                          </ControlButton>
                        )}
                      </div>
                    )}
                  </header>
                }
                originalLink={
                  document && (
                    <a
                      data-product-precedent-original=""
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--pui-border)] px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
                      href={document.citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="국가법령정보센터에서 전체 원문 보기 (새 창)"
                    >
                      공식 원문 보기
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  )
                }
              >
                {document && (
                  <article
                    data-product-precedent-source=""
                    className="min-w-0 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 sm:p-6"
                    aria-label="판례 본문"
                  >
                    <PrecedentDocument text={document.fullText ?? document.excerpt.text} />
                  </article>
                )}
              </ComparisonPanel>
            </section>
          )}
        </>
      )}
    </section>
  );
}
