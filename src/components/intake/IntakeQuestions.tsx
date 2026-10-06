import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { QuestionsResult } from "../../client/api/cases";
import type { CaseView, QuestionView } from "../../client/api/types";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel, IntakeProgress } from "./common";

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
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = result?.questions[index];
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [current, questions] = await Promise.all([
        api.cases.get(caseId),
        api.cases.getQuestions(caseId),
      ]);
      setItem(current);
      setResult(questions);
      const requested = Number(new URLSearchParams(window.location.search).get("question"));
      const unanswered = questions.questions.findIndex((q) => !q.answerState);
      setIndex(
        new URLSearchParams(window.location.search).has("question") &&
          Number.isInteger(requested) &&
          requested >= 0 &&
          requested < questions.questions.length
          ? requested
          : Math.max(0, unanswered),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setValue(question?.answer ?? "");
    setAnswerState(question?.answerState);
    if (question) {
      const url = new URL(window.location.href);
      url.searchParams.set("question", String(index));
      window.history.replaceState(null, "", url);
      heading.current?.focus();
    }
  }, [question, index]);
  useEffect(() => {
    if (!result?.processing || busy) return;
    const timer = window.setTimeout(() => void load(), 2500);
    return () => window.clearTimeout(timer);
  }, [result?.processing, busy, load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (value !== (question?.answer ?? "") || answerState !== question?.answerState)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [value, answerState, question]);
  async function advance() {
    if (!result || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await api.cases.advance(caseId, { expectedRevision: result.revision });
      setResult(next);
      if (next.complete) window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
      else {
        setIndex(
          Math.max(
            0,
            next.questions.findIndex((q) => !q.answerState),
          ),
        );
        setNotice(
          next.processing
            ? "저장한 내용으로 다음 질문을 준비하고 있어요."
            : "새 질문을 확인해 주세요.",
        );
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  async function save(move: boolean, state = answerState) {
    if (
      !result ||
      !question ||
      !state ||
      (state === "answered" && !value.trim()) ||
      pending.current
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const next = await api.cases.saveAnswers(caseId, {
        expectedRevision: result.revision,
        answers: [
          {
            questionId: question.id,
            state,
            ...(state === "answered" ? { value: value.trim() } : {}),
          },
        ],
      });
      setResult(next);
      setAnswerState(state);
      setNotice("답변이 저장됐어요. 내 사건에서 다시 이어갈 수 있어요.");
      if (move && index < next.questions.length - 1) setIndex(index + 1);
      else if (move) {
        pending.current = false;
        setBusy(false);
        const advanced = await api.cases.advance(caseId, { expectedRevision: next.revision });
        setResult(advanced);
        if (advanced.complete)
          window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
        else {
          setIndex(
            Math.max(
              0,
              advanced.questions.findIndex((q) => !q.answerState),
            ),
          );
        }
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return (
    <div className="intake-flow">
      <BackToCases />
      <IntakeProgress step={1} />
      {loading && !result ? (
        <StatePanel variant="loading" title="저장한 질문을 불러오고 있어요." />
      ) : null}
      {error ? <ErrorPanel error={error} retry={() => void load()} disabled={busy} /> : null}
      {item && result ? (
        <section className="intake-card" aria-busy={busy}>
          <p className="intake-eyebrow">{item.title}</p>
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
          ) : result.complete ? (
            <StatePanel
              variant="pending"
              title="질문 정리가 끝났어요. 요약을 확인해 주세요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}/summary`}>
                  요약 확인하기
                </ButtonLink>
              }
            />
          ) : result.processing ? (
            <StatePanel
              variant="loading"
              title="저장한 답변으로 다음 내용을 준비하고 있어요."
              description="화면을 닫아도 저장한 내용은 유지돼요. 잠시 후 다시 확인할 수 있어요."
              action={
                <Button variant="outline" onClick={() => void load()}>
                  상태 다시 확인
                </Button>
              }
            />
          ) : result.failed ? (
            <StatePanel
              variant="error"
              title="다음 내용을 준비하지 못했어요."
              description="저장한 답변은 남아 있어요. 다시 시도해 주세요."
              action={
                <Button onClick={() => void advance()} disabled={busy}>
                  다시 준비하기
                </Button>
              }
            />
          ) : !question ? (
            <>
              <h1>상황에 맞는 질문을 준비해요</h1>
              <p className="intake-muted">입력한 내용을 바탕으로 필요한 사실을 확인해요.</p>
              <Button onClick={() => void advance()} disabled={busy}>
                질문 준비하기
              </Button>
            </>
          ) : (
            <>
              <div className="intake-question-top">
                <p>
                  질문 {index + 1} / {result.questions.length}
                </p>
                <span className="intake-tag">
                  {result.questions.filter((q) => q.answerState).length}개 저장됨
                </span>
              </div>
              <progress
                max={result.questions.length}
                value={result.questions.filter((q) => q.answerState).length}
                aria-label="저장한 질문 수"
              />
              <h1 ref={heading} tabIndex={-1} id="question-heading">
                {question.text}
              </h1>
              <p className="intake-muted">
                확실하지 않으면 모름을 선택해도 괜찮아요. 나중에 답변을 수정할 수 있어요.
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
                    disabled={busy}
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
                      disabled={busy}
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
                    disabled={busy}
                    onClick={() => {
                      setAnswerState("unknown");
                      void save(true, "unknown");
                    }}
                  >
                    모름
                  </Button>
                  <Button
                    variant={answerState === "skipped" ? "secondary" : "ghost"}
                    disabled={busy}
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
                <div className="intake-actions intake-bottom">
                  <Button
                    variant="outline"
                    disabled={busy || index === 0}
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
                    disabled={busy || !answerState || (answerState === "answered" && !value.trim())}
                    onClick={() => void save(false)}
                  >
                    <Save size={16} aria-hidden="true" />
                    답변 저장
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !answerState || (answerState === "answered" && !value.trim())}
                  >
                    {busy
                      ? "저장 중…"
                      : index === result.questions.length - 1
                        ? "저장하고 다음 단계"
                        : "저장하고 다음 질문"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                </div>
              </form>
              <p className="intake-save-notice" role="status">
                {notice}
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
