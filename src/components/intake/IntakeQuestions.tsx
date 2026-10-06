import { ArrowLeft, ArrowRight, Check, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { QuestionsResult } from "../../client/api/cases";
import type { CaseView, QuestionView } from "../../client/api/types";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel, IntakeProgress } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";

export function IntakeQuestions({ caseId }: { caseId: string }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [result, setResult] = useState<QuestionsResult | null>(null);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [answerState, setAnswerState] = useState<QuestionView["answerState"]>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [exit, setExit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const pending = useRef(false);
  const loaded = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef(0);
  const {
    ready,
    version,
    verify,
    ticket,
    current: accessCurrent,
    alive,
    deny,
  } = useCustomerAccess(() => {
    ++request.current;
    setItem(null);
    setResult(null);
    setValue("");
    setAnswerState(undefined);
    setIndex(0);
    setExit(false);
    setEditing(false);
    setPreparing(false);
    loaded.current = false;
    setNotice("");
    setError(null);
    setBusy(false);
    pending.current = false;
  }, setError);
  const report = useCallback(
    (cause: unknown) => {
      if (
        ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
          (cause as { code?: string }).code ?? "",
        )
      )
        deny();
      setError(cause);
    },
    [deny],
  );
  const question = result?.questions[index];
  const dirty = value !== (question?.answer ?? "") || answerState !== question?.answerState;
  const limit = Math.max(result?.followupLimit ?? 2, result?.questions.length ?? 0);
  const savedCount = result?.questions.filter((q) => q.answerState).length ?? 0;
  const waiting = preparing || Boolean(result?.processing);
  const locked = busy || waiting;
  const summarizing = result?.processingStage === "summary" || savedCount >= limit;
  const statusTitle = summarizing ? "사건 요약을 정리하고 있어요" : "다음 질문을 준비하고 있어요";
  const load = useCallback(
    async (poll = false) => {
      let epoch = ticket();
      const serial = ++request.current;
      setLoading(true);
      setError(null);
      try {
        if (!(await verify())) return;
        epoch = ticket();
        const [caseView, questions] = await Promise.all([
          api.cases.get(caseId),
          api.cases.getQuestions(caseId),
        ]);
        if (!(await verify()) || !accessCurrent(epoch) || serial !== request.current) return;
        setItem(caseView);
        const params = new URLSearchParams(window.location.search);
        const isEditing = params.get("edit") === "1";
        setEditing(isEditing);
        setResult(questions);
        const requested = Number(params.get("question"));
        const unanswered = questions.questions.findIndex((q) => !q.answerState);
        const initial = !loaded.current;
        loaded.current = true;
        setIndex((previous) =>
          initial &&
          params.has("question") &&
          Number.isInteger(requested) &&
          requested >= 0 &&
          requested < questions.questions.length &&
          !questions.processing
            ? requested
            : questions.processing || questions.failed || (!initial && !poll)
              ? initial
                ? Math.max(0, questions.questions.length - 1)
                : previous
              : unanswered >= 0
                ? unanswered
                : initial
                  ? 0
                  : previous,
        );
        if (
          questions.complete &&
          !questions.processing &&
          !questions.failed &&
          !isEditing &&
          caseView.schemaVersion === "2" &&
          (caseView.stage === "summary" || caseView.stage === "intake")
        )
          window.location.replace(`/cases/${encodeURIComponent(caseId)}/summary`);
      } catch (cause) {
        if (alive(epoch)) report(cause);
      } finally {
        if (alive(epoch)) setLoading(false);
      }
    },
    [caseId, verify, ticket, accessCurrent, alive, report],
  );
  useEffect(() => {
    if (version) void load();
  }, [load, version]);
  useEffect(() => {
    setValue(question?.answer ?? "");
    setAnswerState(question?.answerState);
    if (question?.id) {
      const url = new URL(window.location.href);
      url.searchParams.set("question", String(index));
      window.history.replaceState(null, "", url);
    }
  }, [question?.id, question?.answer, question?.answerState, index]);
  useEffect(() => {
    if (question?.id && !waiting) heading.current?.focus();
  }, [question?.id, waiting]);
  useEffect(() => {
    if (!result?.processing || busy) return;
    const timer = window.setTimeout(() => void load(true), 2500);
    return () => window.clearTimeout(timer);
  }, [result, busy, load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (value !== (question?.answer ?? "") || answerState !== question?.answerState)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [value, answerState, question]);
  function prepareNext() {
    setPreparing(true);
    setEditing(false);
    // Returning from summary is an edit only until the user submits the final answer.
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", url);
  }
  async function advance() {
    if (!result || pending.current || result.processing) return;
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    prepareNext();
    setError(null);
    try {
      if (!(await verify()) || !accessCurrent(epoch)) return;
      const next = await api.cases.advance(caseId, { expectedRevision: result.revision });
      if (!(await verify()) || !accessCurrent(epoch)) return;
      setResult(next);
      if (next.complete) window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
      else {
        const unanswered = next.questions.findIndex((q) => !q.answerState);
        if (!next.processing && unanswered >= 0) setIndex(unanswered);
        setNotice("");
      }
    } catch (cause) {
      if (alive(epoch)) report(cause);
    } finally {
      if (alive(epoch)) {
        setBusy(false);
        setPreparing(false);
        pending.current = false;
      }
    }
  }
  async function save(move: boolean, state = answerState) {
    if (
      !result ||
      !question ||
      !state ||
      (state === "answered" && !value.trim()) ||
      pending.current ||
      result.processing
    )
      return;
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      if (!(await verify()) || !accessCurrent(epoch)) return;
      const next = await api.cases.saveAnswers(caseId, {
        expectedRevision: result.revision,
        answers: [
          state === "answered"
            ? { questionId: question.id, state, value: value.trim() }
            : { questionId: question.id, state },
        ],
      });
      if (!(await verify()) || !accessCurrent(epoch)) return;
      setResult(next);
      setAnswerState(state);
      setNotice("답변이 저장됐어요. 내 사건에서 다시 이어갈 수 있어요.");
      if (move && index < next.questions.length - 1) setIndex(index + 1);
      else if (move) {
        prepareNext();
        const advanced = await api.cases.advance(caseId, { expectedRevision: next.revision });
        if (!(await verify()) || !accessCurrent(epoch)) return;
        setResult(advanced);
        if (advanced.complete)
          window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
        else {
          const unanswered = advanced.questions.findIndex((q) => !q.answerState);
          if (!advanced.processing && unanswered >= 0) setIndex(unanswered);
        }
      }
    } catch (cause) {
      if (alive(epoch)) report(cause);
    } finally {
      if (alive(epoch)) {
        setBusy(false);
        setPreparing(false);
        pending.current = false;
      }
    }
  }
  return (
    <div className="intake-flow intake-detail-flow">
      <BackToCases />
      <IntakeProgress step={1} />
      {loading && !result && !error ? (
        <StatePanel variant="loading" title="저장한 질문을 불러오고 있어요." />
      ) : null}
      {error ? <ErrorPanel error={error} retry={() => void load()} disabled={busy} /> : null}
      {ready && item && result ? (
        <section className="intake-card intake-question-card">
          <div className="intake-assistant-heading">
            <BrandMark size={32} />
            <div>
              <p className="intake-eyebrow">사건을 더 정확하게 정리해요</p>
              <p className="intake-case-caption">{item.title}</p>
            </div>
          </div>
          {item.schemaVersion === "1" ? (
            <StatePanel
              variant="pending"
              title="이 사건은 기존 기록이에요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}`}>
                  기존 기록 열기
                </ButtonLink>
              }
            />
          ) : item.stage === "active" || item.stage === "archived" ? (
            <StatePanel
              variant="pending"
              title="확인한 사건을 이어서 정리할 수 있어요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}`}>사건 열기</ButtonLink>
              }
            />
          ) : result.complete && !editing && !waiting ? (
            <StatePanel
              variant="pending"
              title="질문 정리가 끝났어요. 요약을 확인해 주세요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}/summary`}>
                  요약 확인하기
                </ButtonLink>
              }
            />
          ) : !question ? (
            <>
              <div className="intake-question-intro">
                <span className="intake-tag">추가 질문은 최대 2개</span>
                <h1>{waiting ? "필요한 내용만 확인할게요" : "몇 가지만 더 알려주세요"}</h1>
                <p className="intake-muted">
                  말씀해 주신 상황에 꼭 필요한 질문을 골라요. 답변을 마치면 사건 요약을 볼 수
                  있어요.
                </p>
                <blockquote className="intake-narrative-preview">{item.title}</blockquote>
              </div>
              {waiting ? (
                <PreparationStatus title={statusTitle} />
              ) : result.failed ? (
                <StatePanel
                  variant="error"
                  title="질문을 준비하지 못했어요"
                  description="입력한 상황은 저장되어 있어요. 이어서 준비할게요."
                  action={
                    <Button onClick={() => void advance()} disabled={locked}>
                      다시 준비하기
                    </Button>
                  }
                />
              ) : (
                <Button
                  className="intake-primary-action"
                  onClick={() => void advance()}
                  disabled={locked}
                >
                  질문 시작하기 <ArrowRight size={16} aria-hidden="true" />
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="intake-question-top">
                <p>
                  질문 {index + 1} / 최대 {limit}
                </p>
                <span className="intake-question-remaining">
                  {index + 1 >= limit
                    ? "마지막 질문이에요"
                    : limit > 2
                      ? "저장된 질문을 확인해 주세요"
                      : "최대 두 번만 여쭤볼게요"}
                </span>
              </div>
              <progress max={limit} value={savedCount} aria-label="저장한 질문 수" />
              <h1 ref={heading} tabIndex={-1} id="question-heading">
                {question.text}
              </h1>
              <p className="intake-muted">
                기억나는 만큼만 알려주세요. 확실하지 않으면 모름을 선택해도 괜찮아요.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(true);
                }}
              >
                {question.kind === "choice" ? (
                  <fieldset
                    className="intake-options"
                    disabled={locked}
                    aria-labelledby="question-heading"
                  >
                    <legend className="sr-only">답변 선택</legend>
                    {question.options?.map((option) => (
                      <label
                        key={option}
                        className={answerState === "answered" && value === option ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option}
                          checked={answerState === "answered" && value === option}
                          onChange={() => {
                            setValue(option);
                            setAnswerState("answered");
                          }}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <>
                    <label className="ui-label" htmlFor="question-answer">
                      답변
                    </label>
                    <Textarea
                      id="question-answer"
                      value={answerState === "answered" ? value : ""}
                      maxLength={1000}
                      disabled={locked}
                      onChange={(event) => {
                        setValue(event.target.value);
                        setAnswerState("answered");
                      }}
                      placeholder="기억나는 만큼 적어주세요."
                    />
                  </>
                )}
                <div className="intake-secondary-actions">
                  <Button
                    variant={answerState === "unknown" ? "secondary" : "outline"}
                    disabled={locked}
                    onClick={() => {
                      setAnswerState("unknown");
                      void save(true, "unknown");
                    }}
                  >
                    모름
                  </Button>
                  <Button
                    variant={answerState === "skipped" ? "secondary" : "ghost"}
                    disabled={locked}
                    onClick={() => {
                      setAnswerState("skipped");
                      void save(true, "skipped");
                    }}
                  >
                    건너뛰기
                  </Button>
                </div>
                {answerState === "unknown" || answerState === "skipped" ? (
                  <p className="intake-muted">
                    저장한 답변: {answerState === "unknown" ? "모름" : "건너뛰기"}
                  </p>
                ) : null}
                {waiting ? <PreparationStatus title={statusTitle} saved /> : null}
                {result.failed && !waiting ? (
                  <StatePanel
                    variant="error"
                    title="이어서 준비하지 못했어요"
                    description="방금 답변은 저장되어 있어요. 다시 시도해 주세요."
                    action={
                      <Button
                        onClick={() => (dirty ? void save(true) : void advance())}
                        disabled={
                          busy ||
                          (dirty && (!answerState || (answerState === "answered" && !value.trim())))
                        }
                      >
                        {dirty ? "답변 저장하고 다시 준비하기" : "다시 준비하기"}
                      </Button>
                    }
                  />
                ) : null}
                <div className="intake-actions intake-question-navigation">
                  <Button
                    variant="outline"
                    disabled={locked || index === 0}
                    onClick={() => {
                      setIndex(index - 1);
                      setNotice("");
                    }}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    이전 질문
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      locked || !answerState || (answerState === "answered" && !value.trim())
                    }
                    onClick={() => void save(false)}
                  >
                    <Save size={16} aria-hidden="true" />
                    답변 저장
                  </Button>
                </div>
                <div className="intake-question-footer">
                  <Button
                    className="intake-primary-action"
                    type="submit"
                    disabled={
                      locked || !answerState || (answerState === "answered" && !value.trim())
                    }
                  >
                    {waiting
                      ? summarizing
                        ? "요약을 정리하고 있어요"
                        : "다음 질문을 준비하고 있어요"
                      : busy
                        ? "답변을 저장하고 있어요"
                        : index + 1 >= limit || (editing && index === result.questions.length - 1)
                          ? "저장하고 요약 보기"
                          : "저장하고 다음 질문"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                </div>
              </form>
              <p className="intake-save-notice" role="status">
                {waiting ? "" : notice}
              </p>
              <Button variant="ghost" onClick={() => setExit(true)} disabled={busy}>
                나중에 이어하기
              </Button>
              {exit ? (
                <div
                  className="intake-exit"
                  role="dialog"
                  aria-modal="false"
                  aria-labelledby="exit-title"
                >
                  <h2 id="exit-title">내 사건에서 다시 이어갈 수 있어요</h2>
                  <p>
                    저장 버튼을 누른 답변은 유지돼요. 현재 수정한 내용은 답변 저장 후 이동해 주세요.
                  </p>
                  <div className="intake-actions">
                    <ButtonLink href="/cases">목록으로 이동</ButtonLink>
                    <Button variant="outline" onClick={() => setExit(false)}>
                      계속 답하기
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PreparationStatus({ title, saved = false }: { title: string; saved?: boolean }) {
  return (
    <div className="intake-preparation" role="status" aria-live="polite" aria-atomic="true">
      <span className="intake-preparation-icon">
        <LoaderCircle size={20} aria-hidden="true" />
      </span>
      <div>
        {saved ? (
          <span className="intake-preparation-saved">
            <Check size={13} aria-hidden="true" />
            답변 저장 완료
          </span>
        ) : null}
        <p>{title}</p>
        <span>준비되면 자동으로 이어져요. 잠시만 기다려 주세요.</span>
      </div>
    </div>
  );
}
