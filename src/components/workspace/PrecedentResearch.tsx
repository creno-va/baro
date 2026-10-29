import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../client/api/core";
import { precedentsApi } from "../../client/api/precedents";
import { accessHref } from "../../client/return-path";
import { legalFailureMessages } from "../../contracts/v2/legal-availability";
import type {
  V2PrecedentReadResponse,
  V2PrecedentResearchContext,
  V2PrecedentSearchResponse,
  V2PrecedentTopic,
} from "../../contracts/v2/precedent-research";
import { PRECEDENT_TOPIC_LABELS } from "../../contracts/v2/precedent-topics";
import { useCustomerAccess } from "../intake/useCustomerAccess";
import { CaseNavigation } from "./CaseNavigation";
import { PrecedentComparisonPanel } from "./PrecedentComparisonPanel";

type Item = V2PrecedentSearchResponse["items"][number];
const allTopics = Object.keys(PRECEDENT_TOPIC_LABELS) as V2PrecedentTopic[];
const isAccessError = (error: unknown) =>
  error instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code);

export function PrecedentResearch({ caseId }: { caseId: string }) {
  const [context, setContext] = useState<V2PrecedentResearchContext | null>(null);
  const [topics, setTopics] = useState<V2PrecedentTopic[]>([]);
  const [result, setResult] = useState<V2PrecedentSearchResponse | null>(null);
  const [document, setDocument] = useState<V2PrecedentReadResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const currentContext = useRef<V2PrecedentResearchContext | null>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const detailView = useRef<HTMLElement>(null);
  const resultOpener = useRef<HTMLButtonElement | null>(null);
  const listScroll = useRef(0);
  const restoreComparison = useRef(true);
  const requests = useRef<{
    context?: AbortController;
    search?: AbortController;
    read?: AbortController;
  }>({});
  const clearResults = useCallback(() => {
    requests.current.search?.abort();
    requests.current.read?.abort();
    setResult(null);
    setDocument(null);
    setSelected(null);
    setBusy(false);
    setReading(false);
    setReadError(null);
  }, []);
  const access = useCustomerAccess(() => {
    requests.current.context?.abort();
    clearResults();
    currentContext.current = null;
    setContext(null);
    setTopics([]);
  }, setError);
  const boundary = useRef(access);
  boundary.current = access;

  useEffect(() => {
    // Foreground verification and explicit retry each refresh the case revision.
    void access.version;
    void reload;
    if (!access.ready) return;
    const controller = new AbortController();
    requests.current.context?.abort();
    requests.current.context = controller;
    const ticket = access.ticket();
    void precedentsApi
      .context(caseId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || !boundary.current.current(ticket)) return;
        const prior = currentContext.current;
        if (prior && prior.summaryRevision !== next.summaryRevision) {
          clearResults();
          setTopics(next.recommendedTopics.slice(0, 2));
        } else if (!prior) setTopics(next.recommendedTopics.slice(0, 2));
        currentContext.current = next;
        setContext(next);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted || !boundary.current.alive(ticket)) return;
        if (isAccessError(cause)) boundary.current.deny();
        if (cause instanceof ApiError && ["NOT_FOUND", "CONFLICT"].includes(cause.code)) {
          clearResults();
          currentContext.current = null;
          setContext(null);
        }
        setError(cause);
      });
    return () => controller.abort();
  }, [caseId, access.ready, access.version, access.ticket, reload, clearResults]);
  useEffect(
    () => () => {
      for (const controller of Object.values(requests.current)) controller?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!selected) return;
    documentHeading.current?.focus({ preventScroll: true });
    detailView.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selected]);

  function backToResults() {
    restoreComparison.current = false;
    requests.current.read?.abort();
    setSelected(null);
    setDocument(null);
    setReadError(null);
    setReading(false);
    requestAnimationFrame(() => {
      resultOpener.current?.focus({ preventScroll: true });
      window.scrollTo({ top: listScroll.current, behavior: "instant" });
    });
  }

  async function search() {
    if (busy || !context || !topics.length) return;
    restoreComparison.current = false;
    clearResults();
    setError(null);
    const controller = new AbortController();
    requests.current.search = controller;
    setBusy(true);
    const ticket = access.ticket();
    try {
      if (!(await access.verify()) || controller.signal.aborted || !access.current(ticket)) return;
      const next = await precedentsApi.search(
        caseId,
        {
          expectedRevision: context.workspaceRevision,
          summaryRevision: context.summaryRevision,
          topics,
        },
        controller.signal,
      );
      if (!controller.signal.aborted && access.current(ticket)) setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted && access.alive(ticket)) {
        if (isAccessError(cause)) access.deny();
        if (cause instanceof ApiError && ["NOT_FOUND", "CONFLICT"].includes(cause.code)) {
          currentContext.current = null;
          setContext(null);
        }
        setError(cause);
      }
    } finally {
      if (!controller.signal.aborted && access.current(ticket)) setBusy(false);
    }
  }
  async function read(item: Item) {
    if (!context) return;
    restoreComparison.current = false;
    if (!selected) listScroll.current = window.scrollY;
    requests.current.read?.abort();
    const controller = new AbortController();
    requests.current.read = controller;
    setSelected(item.id);
    setDocument(null);
    setReadError(null);
    setReading(true);
    const ticket = access.ticket();
    try {
      if (!(await access.verify()) || controller.signal.aborted || !access.current(ticket)) return;
      const next = await precedentsApi.read(
        caseId,
        { expectedRevision: context.workspaceRevision, readToken: item.readToken },
        controller.signal,
      );
      if (!controller.signal.aborted && access.current(ticket)) setDocument(next);
    } catch (cause) {
      if (!controller.signal.aborted && access.alive(ticket)) {
        if (isAccessError(cause)) access.deny();
        if (cause instanceof ApiError && cause.code === "CONFLICT") {
          clearResults();
          currentContext.current = null;
          setContext(null);
          setError(cause);
        } else {
          setReadError(cause);
          // A missing proof can also mean the case/role was revoked. Refresh
          // scope without hiding valid results merely because a proof expired.
          if (cause instanceof ApiError && cause.code === "NOT_FOUND") setReload((n) => n + 1);
        }
      }
    } finally {
      if (!controller.signal.aborted && access.current(ticket)) setReading(false);
    }
  }
  const visibleTopics = [
    ...new Set([...(context?.recommendedTopics ?? []), ...allTopics.slice(0, 8)]),
  ];
  const topicOption = (topic: V2PrecedentTopic) => (
    <label key={topic} className="precedent-topic">
      <input
        type="checkbox"
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
      {context?.recommendedTopics.includes(topic) && <small>추천</small>}
    </label>
  );
  const chosen = result?.items.find((item) => item.id === selected);
  const sourceCurrent =
    result?.workspaceRevision === context?.workspaceRevision &&
    result?.summaryRevision === context?.summaryRevision;
  return (
    <section className="workspace precedent-workspace" aria-label="관련 판례 탐색">
      <CaseNavigation
        caseId={caseId}
        title={access.ready && context ? context.caseTitle : "관련 판례"}
        active="precedents"
      />
      <header className="workspace-section-heading" hidden={selected !== null}>
        <div>
          <h2>사건과 비슷한 판례 찾기</h2>
          <p>
            확인한 사건 요약을 바탕으로 검색 주제를 추천해요. 궁금한 주제를 골라 공식 판례를
            살펴보세요.
          </p>
        </div>
      </header>
      {!!error && (
        <div className="precedent-notice" role="alert">
          <p>
            {error instanceof ApiError && error.code === "CONFLICT"
              ? "최신 사건 요약을 확인한 뒤 다시 찾아 주세요."
              : errorMessage(error)}
          </p>
          <div className="precedent-links">
            <button
              type="button"
              onClick={() => {
                setReload((n) => n + 1);
                void access.verify().catch(setError);
              }}
            >
              다시 불러오기
            </button>
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
          <div className="precedent-list-view" hidden={selected !== null}>
            <form
              className="precedent-search"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <fieldset disabled={busy}>
                <legend>
                  검색 주제 <span>최대 2개 · {topics.length}개 선택</span>
                </legend>
                <div className="precedent-topics">{visibleTopics.map(topicOption)}</div>
                <details>
                  <summary>다른 주제 선택</summary>
                  <div className="precedent-topics">
                    {allTopics.filter((topic) => !visibleTopics.includes(topic)).map(topicOption)}
                  </div>
                </details>
              </fieldset>
              <div className="precedent-search-footer">
                <p>
                  외부에는 선택한 법률 주제만 전달돼요. 사건 진술과 개인정보는 검색어로 보내지
                  않아요.
                </p>
                <button
                  className="precedent-primary"
                  type="submit"
                  disabled={!topics.length || busy}
                >
                  <Search size={17} aria-hidden="true" />
                  {busy ? "공식 원문 확인 중…" : "판례 찾기"}
                </button>
              </div>
            </form>
            {busy && (
              <div className="precedent-notice" role="status">
                <p>공식 판례와 원문을 확인하고 있어요. 최대 2분 정도 걸릴 수 있어요.</p>
                <button type="button" onClick={clearResults}>
                  검색 취소
                </button>
              </div>
            )}
            {result && (
              <>
                <div className="precedent-result-heading" role="status">
                  <h3>
                    검색 결과 <span>{result.items.length}건</span>
                  </h3>
                  <p>
                    {result.topics.map((topic) => PRECEDENT_TOPIC_LABELS[topic]).join(" · ")} ·{" "}
                    {new Date(result.checkedAt).toLocaleString("ko-KR")}
                  </p>
                </div>
                {result.status === "partial" && !result.availabilityIssues?.length && (
                  <p className="precedent-notice" role="status">
                    {result.unavailableTopics
                      .map((topic) => PRECEDENT_TOPIC_LABELS[topic])
                      .join(" · ")}{" "}
                    주제를 일부 확인하지 못했어요. 확인된 판례만 표시해요.
                  </p>
                )}
                {result.status === "unavailable" && !result.availabilityIssues?.length && (
                  <p className="precedent-notice" role="alert">
                    공식 판례를 지금 확인할 수 없어요. 잠시 후 다시 검색해 주세요.
                  </p>
                )}
                {result.status === "empty" && (
                  <p className="precedent-notice">
                    선택한 주제와 가까운 판례를 찾지 못했어요. 다른 주제로 다시 찾아보세요.
                  </p>
                )}
                {!!result.availabilityIssues?.length && (
                  <ul className="precedent-notice" aria-label="공식 자료 확인 상태">
                    {result.availabilityIssues.map(({ topic, reason }) => (
                      <li key={`${topic}:${reason}`}>
                        {PRECEDENT_TOPIC_LABELS[topic]} · {legalFailureMessages[reason]}
                      </li>
                    ))}
                  </ul>
                )}
                {result.searchTruncated && (
                  <p className="precedent-scope">
                    관련성을 기준으로 주제별 최대 3건을 표시해요. 전체 판례를 조사한 결과는
                    아니에요.
                  </p>
                )}
                {!sourceCurrent && (
                  <div className="precedent-notice" role="status">
                    <p>사건 내용이 바뀌었어요. 최신 내용으로 다시 검색해 주세요.</p>
                    <button type="button" onClick={() => void search()}>
                      다시 검색
                    </button>
                  </div>
                )}
                {!!result.items.length && (
                  <ul className="precedent-list" aria-label="관련 판례 목록">
                    {result.items.map((item) => (
                      <li key={item.id}>
                        <article className="precedent-card">
                          <h4>{item.citation.title}</h4>
                          <div className="precedent-card-footer">
                            <div className="precedent-metadata">
                              <span>{item.citation.court}</span>
                              <span>{item.citation.decisionDate}</span>
                              <span>{item.citation.caseNumber}</span>
                              <span>
                                관련 주제 ·{" "}
                                {item.matchedTopics
                                  .map((topic) => PRECEDENT_TOPIC_LABELS[topic])
                                  .join(" · ")}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={!sourceCurrent}
                              onClick={(event) => {
                                resultOpener.current = event.currentTarget;
                                void read(item);
                              }}
                            >
                              판례 내용 보기
                              <span className="sr-only"> · {item.citation.caseNumber}</span>
                            </button>
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <section
            ref={detailView}
            className="precedent-detail-view"
            hidden={selected === null}
            aria-label="선택한 판례"
          >
            <h2 className="sr-only">판례 상세</h2>
            <button className="precedent-back" type="button" onClick={backToResults}>
              <ArrowLeft size={18} aria-hidden="true" />
              검색 결과로
            </button>
            <PrecedentComparisonPanel
              caseId={caseId}
              context={context}
              selected={
                sourceCurrent && chosen && document?.citation.id === chosen.citation.id
                  ? chosen
                  : null
              }
              sourceId={selected}
              sourceNeedsRefresh={!!document && (!sourceCurrent || !chosen)}
              onRecovered={(comparison) => {
                if (!restoreComparison.current || !comparison) return;
                restoreComparison.current = false;
                setSelected(comparison.source.citation.id);
                setDocument({
                  schemaVersion: "2",
                  workspaceRevision: context.workspaceRevision,
                  ...comparison.source,
                });
              }}
              access={access}
              onSettled={() => setReload((n) => n + 1)}
              onRefreshSources={() => void search()}
            />
            <article className="precedent-document">
              <h3 ref={documentHeading} tabIndex={-1}>
                {document?.citation.title ?? chosen?.citation.title ?? "판례 내용"}
              </h3>
              {reading && <p role="status">선택한 판례를 불러오고 있어요.</p>}
              {!!readError && (
                <div role="alert">
                  <p>판례를 다시 확인하지 못했어요. 잠시 후 다시 확인하거나 검색해 주세요.</p>
                  {chosen && (
                    <button
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
                    </button>
                  )}
                </div>
              )}
              {document && (
                <>
                  <p className="precedent-metadata">
                    {document.citation.court} · {document.citation.decisionDate} ·{" "}
                    {document.citation.caseNumber}
                  </p>
                  <a
                    className="precedent-original"
                    href={document.citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    국가법령정보센터에서 전체 원문 보기{" "}
                    <ExternalLink size={15} aria-hidden="true" />
                    <span className="sr-only"> (새 창)</span>
                  </a>
                  <p className="precedent-body">{document.excerpt.text}</p>
                  {document.excerpt.truncated && (
                    <p className="precedent-scope">
                      긴 원문 중 일부를 표시했어요. 전체 내용은 공식 원문에서 확인해 주세요.
                    </p>
                  )}
                </>
              )}
            </article>
          </section>
        </>
      )}
    </section>
  );
}
