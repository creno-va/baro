import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { QuestionsResult } from "../../client/api/cases";
import type { CaseView, QuestionView } from "../../client/api/types";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";
import { useSceneTransition } from "./useSceneTransition";

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
  const { leaving, transition } = useSceneTransition();
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
  const locked = busy || waiting || leaving;
  const displayed = useRef({ index, id: question?.id });
  displayed.current = { index, id: question?.id };
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
        const requested = Number(params.get("question"));
        const unanswered = questions.questions.findIndex((q) => !q.answerState);
        const initial = !loaded.current;
        loaded.current = true;
        const previous = displayed.current.index;
        const nextIndex =
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
                  : previous;
        if (
          questions.complete &&
          !questions.processing &&
          !questions.failed &&
          !isEditing &&
          caseView.schemaVersion === "2" &&
          (caseView.stage === "summary" || caseView.stage === "intake")
        )
          window.location.replace(`/cases/${encodeURIComponent(caseId)}/summary`);
        else {
          const show = () => {
            setResult(questions);
            setIndex(nextIndex);
          };
          if (
            !initial &&
            !questions.processing &&
            displayed.current.id !== questions.questions[nextIndex]?.id
          )
            await transition(show, () => accessCurrent(epoch) && serial === request.current);
          else show();
        }
      } catch (cause) {
        if (alive(epoch)) report(cause);
      } finally {
        if (alive(epoch)) setLoading(false);
      }
    },
    [caseId, verify, ticket, accessCurrent, alive, report, transition],
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
    if (question?.id && !waiting) heading.current?.focus({ preventScroll: true });
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
  async function showNext(next: QuestionsResult, epoch: number) {
    if (next.complete && !next.processing) {
      window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
      return;
    }
    const unanswered = next.questions.findIndex((q) => !q.answerState);
    if (!next.processing && unanswered >= 0 && next.questions[unanswered]?.id !== question?.id) {
      await transition(
        () => {
          setResult(next);
          setIndex(unanswered);
        },
        () => accessCurrent(epoch),
      );
    } else setResult(next);
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
      await showNext(next, epoch);
      setNotice("");
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
      if (move && index < next.questions.length - 1) {
        await transition(
          () => {
            setIndex(index + 1);
            setNotice("");
          },
          () => accessCurrent(epoch),
        );
      } else if (move) {
        prepareNext();
        const advanced = await api.cases.advance(caseId, { expectedRevision: next.revision });
        if (!(await verify()) || !accessCurrent(epoch)) return;
        await showNext(advanced, epoch);
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
      <nav className="intake-scene-nav" aria-label="사건 정리 탐색">
        <BackToCases />
        <span>{question ? `질문 ${index + 1} / 최대 ${limit}` : "질문 최대 2개"}</span>
      </nav>
      {loading && !result && !error ? (
        <StatePanel variant="loading" title="저장한 질문을 불러오고 있어요." />
      ) : null}
      {error ? (
        <ErrorPanel error={error} retry={() => void load()} disabled={busy || leaving} />
      ) : null}
      {ready && item && result ? (
        <section className="intake-scene" data-transition={leaving ? "leaving" : "idle"}>
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
          ) : (
            <div
              className="intake-scene-content"
              key={question?.id ?? "initial"}
              data-waiting={waiting}
            >
              <header className="intake-scene-heading">
                <span className="intake-scene-emblem" aria-hidden="true">
                  <BrandMark size={48} />
                </span>
                <h1 ref={heading} tabIndex={-1} id="question-heading">
                  {question?.text ?? "필요한 내용만 확인할게요"}
                </h1>
                <p>
                  {question
                    ? index + 1 >= limit
                      ? "마지막 질문이에요. 기억나는 만큼만 알려주세요."
                      : "기억나는 만큼만 편하게 알려주세요."
                    : "말씀해 주신 상황에서 질문을 고르고 있어요."}
                </p>
              </header>
              {!question ? (
                waiting ? (
                  <PreparationStatus title={statusTitle} />
                ) : result.failed ? (
                  <StatePanel
                    variant="error"
                    title="질문을 준비하지 못했어요"
                    description="입력한 상황은 저장되어 있어요."
                    action={
                      <Button onClick={() => void advance()} disabled={locked}>
                        다시 준비하기
                      </Button>
                    }
                  />
                ) : (
                  <Button
                    className="intake-scene-primary"
                    onClick={() => void advance()}
                    disabled={locked}
                  >
                    질문 시작하기 <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                )
              ) : (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(true);
                    }}
                  >
                    <div className="intake-scene-composer">
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
                              className={
                                answerState === "answered" && value === option ? "selected" : ""
                              }
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
                          <label className="sr-only" htmlFor="question-answer">
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
                            placeholder="여기에 편하게 적어주세요."
                          />
                        </>
                      )}
                      {answerState === "unknown" || answerState === "skipped" ? (
                        <p className="intake-scene-answer-state">
                          {answerState === "unknown" ? "모름" : "건너뛰기"}으로 저장했어요.
                        </p>
                      ) : null}
                      <div className="intake-scene-options">
                        <Button
                          variant="ghost"
                          disabled={locked}
                          onClick={() => {
                            setAnswerState("unknown");
                            void save(true, "unknown");
                          }}
                        >
                          모름
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={locked}
                          onClick={() => {
                            setAnswerState("skipped");
                            void save(true, "skipped");
                          }}
                        >
                          건너뛰기
                        </Button>
                      </div>
                    </div>
                    <div className="intake-scene-action">
                      {waiting ? (
                        <PreparationStatus title={statusTitle} saved />
                      ) : (
                        <Button
                          className="intake-scene-primary"
                          type="submit"
                          disabled={
                            locked || !answerState || (answerState === "answered" && !value.trim())
                          }
                        >
                          {busy
                            ? "답변을 저장하고 있어요"
                            : index + 1 >= limit ||
                                (editing && index === result.questions.length - 1)
                              ? "저장하고 요약 보기"
                              : "저장하고 다음 질문"}
                          <ArrowRight size={18} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    {result.failed && !waiting ? (
                      <StatePanel
                        variant="error"
                        title="이어서 준비하지 못했어요"
                        description="방금 답변은 저장되어 있어요."
                        action={
                          <Button
                            onClick={() => (dirty ? void save(true) : void advance())}
                            disabled={
                              locked ||
                              (dirty &&
                                (!answerState || (answerState === "answered" && !value.trim())))
                            }
                          >
                            {dirty ? "답변 저장하고 다시 준비하기" : "다시 준비하기"}
                          </Button>
                        }
                      />
                    ) : null}
                    <p className="intake-scene-notice" role="status">
                      {waiting ? "" : notice}
                    </p>
                    <details className="intake-scene-management">
                      <summary>답변 관리</summary>
                      <div className="intake-scene-tools">
                        <Button
                          variant="ghost"
                          disabled={locked || index === 0}
                          onClick={() => {
                            const epoch = ticket();
                            void transition(
                              () => {
                                setIndex(index - 1);
                                setNotice("");
                              },
                              () => accessCurrent(epoch),
                            );
                          }}
                        >
                          <ArrowLeft size={15} aria-hidden="true" />
                          이전 질문
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={
                            locked || !answerState || (answerState === "answered" && !value.trim())
                          }
                          onClick={() => void save(false)}
                        >
                          <Save size={15} aria-hidden="true" />
                          답변 저장
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setExit(true)}
                          disabled={busy || leaving}
                        >
                          나중에 이어하기
                        </Button>
                      </div>
                    </details>
                  </form>
                  <Dialog
                    open={exit}
                    onOpenChange={setExit}
                    title="내 사건에서 다시 이어갈 수 있어요"
                    description="수정 중인 답변은 저장한 뒤 이동해 주세요."
                  >
                    <div className="intake-actions">
                      <ButtonLink href="/cases">목록으로 이동</ButtonLink>
                      <Button variant="outline" onClick={() => setExit(false)}>
                        계속 답하기
                      </Button>
                    </div>
                  </Dialog>
                </>
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PreparationStatus({ title, saved = false }: { title: string; saved?: boolean }) {
  return (
    <div className="intake-scene-status" role="status" aria-live="polite" aria-atomic="true">
      <div>
        {saved ? (
          <span className="intake-scene-saved">
            <Check size={13} aria-hidden="true" />
            답변 저장 완료
          </span>
        ) : null}
        <p>
          {title}
          <span className="intake-scene-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    </div>
  );
}
