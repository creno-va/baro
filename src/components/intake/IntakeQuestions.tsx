import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { QuestionsResult } from "../../client/api/cases";
import { ApiError } from "../../client/api/core";
import type { CaseView, QuestionView } from "../../client/api/types";
import { startForegroundPolling } from "../../client/foreground-poll";
import { accessHref } from "../../client/return-path";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { LoadingContent } from "../ui/loading";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";
import { useSceneTransition } from "./useSceneTransition";

type AnswerSnapshot = {
  questionId: string;
  value: string;
  state: NonNullable<QuestionView["answerState"]>;
  revision: number;
};

export function IntakeQuestions({ caseId }: { caseId: string }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [result, setResult] = useState<QuestionsResult | null>(null);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [answerState, setAnswerState] = useState<QuestionView["answerState"]>();
  const [busy, setBusy] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const [customQuestionId, setCustomQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const { leaving, transition } = useSceneTransition();
  const pending = useRef(false);
  const failedOperation = useRef<
    { kind: "advance" } | ({ kind: "save"; move: boolean } & AnswerSnapshot) | null
  >(null);
  const loaded = useRef(false);
  const caseSnapshot = useRef<CaseView | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef(0);
  const drafts = useRef(new Map<string, { value: string; state: QuestionView["answerState"] }>());
  const draftSnapshot = useRef<{ dirty: boolean; revision: number } | null>(null);
  const acknowledgedRevision = useRef<number | null>(null);
  const inputSnapshot = useRef<{
    questionId?: string | undefined;
    value: string;
    state: QuestionView["answerState"];
  }>({ value: "", state: undefined });
  const preservedInput = useRef<typeof inputSnapshot.current | null>(null);
  const preserveQuestionOnRecovery = useRef<string | null>(null);
  const moveAfterSave = useRef<string | null>(null);
  const {
    ready,
    canMutate,
    version,
    verify,
    ticket,
    current: accessCurrent,
    alive,
    deny,
  } = useCustomerAccess(
    () => {
      ++request.current;
      draftSnapshot.current = null;
      drafts.current.clear();
      acknowledgedRevision.current = null;
      setItem(null);
      setResult(null);
      setValue("");
      setAnswerState(undefined);
      setIndex(0);
      inputSnapshot.current = { value: "", state: undefined };
      preservedInput.current = null;
      preserveQuestionOnRecovery.current = null;
      moveAfterSave.current = null;
      setEditing(false);
      setPreparing(false);
      setRecovering(false);
      loaded.current = false;
      caseSnapshot.current = null;
      setError(null);
      setBusy(false);
      setAutoSaving(false);
      setComposing(false);
      setCustomQuestionId(null);
      pending.current = false;
      failedOperation.current = null;
    },
    setError,
    true,
  );
  const report = useCallback(
    (cause: unknown) => {
      if ((cause as { code?: string }).code === "CONFLICT") setRecovering(false);
      if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string }).code ?? ""))
        deny();
      setError(cause);
    },
    [deny],
  );
  const question = result?.questions[index];
  const customAnswer =
    question?.kind === "choice" &&
    (customQuestionId === question.id ||
      (answerState === "answered" && !question.options?.includes(value)));
  inputSnapshot.current = { questionId: question?.id, value, state: answerState };
  const answerTooLong = answerState === "answered" && [...value.trim()].length > 1000;
  const dirty =
    answerState !== question?.answerState ||
    (answerState === "answered" && value.trim() !== (question?.answer ?? ""));
  draftSnapshot.current = result
    ? { dirty: dirty || drafts.current.size > 0, revision: result.revision }
    : null;
  const rounds = result?.rounds ?? [];
  const round = rounds.find(
    (candidate) => question && candidate.questionIds.includes(question.id),
  ) ?? {
    ordinal: 1,
    questionIds: result?.questions.map((q) => q.id) ?? [],
  };
  const roundLimit = Math.max(result?.roundLimit ?? 2, ...rounds.map((r) => r.ordinal));
  const roundIndex = question ? round.questionIds.indexOf(question.id) : 0;
  const lastInRound = roundIndex === round.questionIds.length - 1;
  const cleanSavedAnswer =
    !dirty && !!question?.answerState && !error && !failedOperation.current && !recovering;
  const canNavigateSavedAnswer = cleanSavedAnswer && !!result?.questions[index + 1];
  const canAdvanceSavedAnswer =
    cleanSavedAnswer &&
    !!result &&
    !result.failed &&
    !result.complete &&
    index === result.questions.length - 1 &&
    drafts.current.size === 0;
  const requiresAdvanceRetry = !!error && failedOperation.current?.kind === "advance" && !dirty;
  const finalQuestion =
    index === (result?.questions.length ?? 0) - 1 &&
    (rounds.length >= roundLimit || result?.processingStage === "summary" || editing);
  const waiting = preparing || recovering || Boolean(result?.processing);
  const locked =
    !canMutate || busy || waiting || leaving || (error as { code?: string })?.code === "CONFLICT";
  const displayed = useRef({ index, id: question?.id });
  displayed.current = { index, id: question?.id };
  const summarizing =
    result?.processingStage === "summary" ||
    (rounds.length >= roundLimit && result?.questions.every((q) => q.answerState));
  const statusTitle =
    result?.processingMessage ??
    (summarizing ? "사건 요약을 정리하고 있어요" : "다음 질문을 준비하고 있어요");
  const failureTitle =
    result?.failure === "POLICY_REJECTED" || result?.failure === "MODEL_SCHEMA_INVALID"
      ? "AI가 다음 질문이나 요약을 준비하지 못했어요."
      : "다음 내용을 준비하지 못했어요.";
  const failureDescription =
    "저장한 답변은 그대로 남아 있어요. " +
    (result?.canPrepareSummary
      ? "다시 시도하면 추가 질문 없이 저장한 답변으로 요약을 준비해요."
      : result?.retryable
        ? "다시 시도하거나 나중에 이어갈 수 있어요."
        : "지금은 같은 내용으로 다시 시도할 수 없어요. 답변을 수정하거나 나중에 이어갈 수 있어요.");
  const recoveryActions = (
    <div className="intake-actions">
      <Button
        onClick={() => (dirty ? void save(true) : void advance())}
        disabled={
          locked ||
          autoSaving ||
          (!result?.retryable && !result?.canPrepareSummary && !dirty) ||
          (dirty &&
            (!answerState || (answerState === "answered" && (!value.trim() || answerTooLong))))
        }
      >
        다시 시도
      </Button>
      <Button
        variant="outline"
        disabled={
          busy ||
          autoSaving ||
          waiting ||
          leaving ||
          (dirty &&
            (locked ||
              !answerState ||
              (answerState === "answered" && (!value.trim() || answerTooLong))))
        }
        onClick={() => void resumeLater()}
      >
        나중에 이어하기
      </Button>
    </div>
  );
  const load = useCallback(
    async (poll = false, replaceDraft = false) => {
      if (pending.current || (failedOperation.current && !replaceDraft)) return;
      let epoch = ticket();
      const serial = ++request.current;
      setLoading(true);
      setError(null);
      try {
        if (!(await verify()) || serial !== request.current) return;
        epoch = ticket();
        let [caseView, questions] = await Promise.all([
          poll && caseSnapshot.current ? caseSnapshot.current : api.cases.get(caseId),
          api.cases.getQuestions(caseId),
        ]);
        // A read started before a save/advance cannot restore its old answers.
        if (serial !== request.current) return;
        // The pending view can be reused, but completion must reflect stage
        // changes made in another tab before exposing editable questions.
        if (poll && caseSnapshot.current && !questions.processing)
          caseView = await api.cases.get(caseId);
        if (
          serial !== request.current ||
          !(await verify()) ||
          !accessCurrent(epoch) ||
          serial !== request.current
        )
          return;
        if (
          !replaceDraft &&
          draftSnapshot.current?.dirty &&
          draftSnapshot.current.revision !== questions.revision &&
          acknowledgedRevision.current !== questions.revision
        )
          throw new ApiError(
            "CONFLICT",
            "다른 화면에서 답변이 바뀌었어요. 작성 중인 답변은 남겨뒀어요. 최신 내용을 불러오면 저장된 답변으로 바뀝니다.",
          );
        failedOperation.current = null;
        caseSnapshot.current = caseView;
        setItem(caseView);
        const params = new URLSearchParams(window.location.search);
        const isEditing = params.get("edit") === "1";
        setEditing(isEditing);
        const requested = Number(params.get("question"));
        const unanswered = questions.questions.findIndex((q) => !q.answerState);
        const initial = !loaded.current;
        loaded.current = true;
        const previous = displayed.current.index;
        const recoveredIndex =
          !initial &&
          acknowledgedRevision.current === questions.revision &&
          preserveQuestionOnRecovery.current
            ? questions.questions.findIndex(
                (question) => question.id === preserveQuestionOnRecovery.current,
              )
            : -1;
        const nextIndex =
          initial &&
          params.has("question") &&
          Number.isInteger(requested) &&
          requested >= 0 &&
          requested < questions.questions.length &&
          !questions.processing
            ? requested
            : recoveredIndex >= 0
              ? recoveredIndex
              : questions.processing || questions.failed || (!initial && !poll)
                ? initial
                  ? Math.max(0, questions.questions.length - 1)
                  : previous
                : unanswered >= 0
                  ? unanswered
                  : initial
                    ? Math.max(0, questions.questions.length - 1)
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
            acknowledgedRevision.current = null;
            preserveQuestionOnRecovery.current = null;
            if (moveAfterSave.current !== questions.questions[nextIndex]?.id)
              moveAfterSave.current = null;
            // A postflight failure may be recovered by this read after the
            // server accepted the answer. Clear only drafts it proves saved.
            if (!replaceDraft) {
              for (const saved of questions.questions) {
                const draft = drafts.current.get(saved.id);
                if (
                  draft &&
                  draft.state === saved.answerState &&
                  (draft.state !== "answered" || draft.value.trim() === saved.answer)
                ) {
                  if (inputSnapshot.current.questionId === saved.id)
                    preservedInput.current = inputSnapshot.current;
                  drafts.current.delete(saved.id);
                }
              }
            }
            setResult(questions);
            setIndex(nextIndex);
            setRecovering(false);
            if (replaceDraft) {
              moveAfterSave.current = null;
              preservedInput.current = null;
              drafts.current.clear();
              setValue(questions.questions[nextIndex]?.answer ?? "");
              setAnswerState(questions.questions[nextIndex]?.answerState);
            }
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
        if (alive(epoch) && serial === request.current) report(cause);
      } finally {
        if (alive(epoch) && serial === request.current) setLoading(false);
      }
    },
    [caseId, verify, ticket, accessCurrent, alive, report, transition],
  );
  useEffect(() => {
    if (version) void load();
  }, [load, version]);
  useEffect(() => {
    const preserved = preservedInput.current;
    preservedInput.current = null;
    const draft =
      (question?.id ? drafts.current.get(question.id) : undefined) ??
      (preserved?.questionId === question?.id ? preserved : undefined);
    setValue(draft?.value ?? question?.answer ?? "");
    setAnswerState(draft ? draft.state : question?.answerState);
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
    if (!question?.id) return;
    setCustomQuestionId(null);
    setComposing(false);
  }, [question?.id]);
  useEffect(() => {
    if (customQuestionId === question?.id)
      document.getElementById("question-answer")?.focus({ preventScroll: true });
  }, [customQuestionId, question?.id]);
  useEffect(() => {
    if ((!result?.processing && !recovering) || busy) return;
    return startForegroundPolling(() => load(true), 2500);
  }, [result?.processing, recovering, busy, load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftSnapshot.current?.dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const latestSave = useRef(save);
  latestSave.current = save;
  useEffect(() => {
    if (
      !ready ||
      !canMutate ||
      !question?.id ||
      !dirty ||
      !answerState ||
      (answerState === "answered" && (!value.trim() || answerTooLong)) ||
      busy ||
      autoSaving ||
      composing ||
      waiting ||
      leaving ||
      error ||
      failedOperation.current ||
      (result?.complete && !editing) ||
      item?.stage === "active" ||
      item?.stage === "archived"
    )
      return;
    const timer = window.setTimeout(
      () => void latestSave.current(moveAfterSave.current === question.id, undefined, true),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [
    ready,
    canMutate,
    question?.id,
    dirty,
    answerState,
    value,
    answerTooLong,
    busy,
    autoSaving,
    composing,
    waiting,
    leaving,
    error,
    result?.complete,
    editing,
    item?.stage,
  ]);

  function changeAnswer(nextValue: string, state: QuestionView["answerState"]) {
    if (state !== "answered") {
      setCustomQuestionId(null);
      setComposing(false);
    }
    inputSnapshot.current = { questionId: question?.id, value: nextValue, state };
    if (question) {
      if (
        !pending.current &&
        failedOperation.current?.kind !== "save" &&
        state === question.answerState &&
        (state !== "answered" || nextValue.trim() === question.answer)
      )
        drafts.current.delete(question.id);
      else drafts.current.set(question.id, { value: nextValue, state });
    }
    setValue(nextValue);
    setAnswerState(state);
  }
  function prepareNext() {
    setPreparing(true);
    setEditing(false);
    // Returning from summary is an edit only until the user submits the final answer.
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", url);
  }
  async function verifyCompletion(epoch: number) {
    try {
      if ((await verify()) && accessCurrent(epoch)) return true;
    } catch (cause) {
      if (alive(epoch)) {
        failedOperation.current = null;
        setRecovering(true);
      }
      throw cause;
    }
    if (alive(epoch)) {
      // The write succeeded, but a focus/session check superseded its response.
      // Recover with reads instead of replaying an already accepted mutation.
      failedOperation.current = null;
      setRecovering(true);
    }
    return false;
  }
  async function showNext(next: QuestionsResult, epoch: number) {
    if (next.complete && !next.processing && !next.failed) {
      window.location.assign(`/cases/${encodeURIComponent(caseId)}/summary`);
      return;
    }
    const unanswered = next.questions.findIndex((q) => !q.answerState);
    if (
      !next.processing &&
      !next.failed &&
      unanswered >= 0 &&
      next.questions[unanswered]?.id !== question?.id
    ) {
      await transition(
        () => {
          setResult(next);
          setIndex(unanswered);
        },
        () => accessCurrent(epoch),
      );
    } else setResult(next);
  }
  async function navigateQuestion(nextIndex: number) {
    if (
      !ready ||
      !result ||
      busy ||
      pending.current ||
      waiting ||
      leaving ||
      nextIndex < 0 ||
      nextIndex >= result.questions.length
    )
      return;
    moveAfterSave.current = null;
    if (question) {
      if (dirty) drafts.current.set(question.id, { value, state: answerState });
      else drafts.current.delete(question.id);
    }
    if (
      dirty &&
      canMutate &&
      !error &&
      answerState &&
      (answerState !== "answered" || (value.trim() && !answerTooLong)) &&
      !(await save(false))
    )
      return;
    const epoch = ticket();
    void transition(
      () => {
        setIndex(nextIndex);
      },
      () => accessCurrent(epoch),
    );
  }
  async function resumeLater() {
    if (!ready || pending.current || busy || waiting || leaving) return;
    moveAfterSave.current = null;
    if (dirty) {
      if (!(await save(false)) || drafts.current.size > 0) return;
      // Navigation can run before React commits the acknowledged answer.
      if (draftSnapshot.current) draftSnapshot.current.dirty = false;
    }
    window.location.assign("/app");
  }
  async function advance() {
    if (!canMutate || !result || pending.current || result.processing) return;
    moveAfterSave.current = null;
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    prepareNext();
    setError(null);
    try {
      failedOperation.current = { kind: "advance" };
      if (!(await verify(false, true)) || !accessCurrent(epoch)) return;
      const next = await api.cases.advance(caseId, { expectedRevision: result.revision });
      if (!(await verifyCompletion(epoch))) return;
      failedOperation.current = null;
      await showNext(next, epoch);
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
  async function save(
    move: boolean,
    state = answerState,
    automatic = false,
    replay?: AnswerSnapshot,
  ): Promise<boolean> {
    if (!canMutate || !result || !question || pending.current || result.processing) return false;
    const submittedState = replay?.state ?? state;
    const submittedValue = replay?.value ?? value;
    if (
      !submittedState ||
      (submittedState === "answered" &&
        (!submittedValue.trim() || [...submittedValue.trim()].length > 1000))
    )
      return false;
    const submitted: AnswerSnapshot = replay ?? {
      questionId: question.id,
      value,
      state: submittedState,
      revision: result.revision,
    };
    if (submitted.questionId !== question.id) return false;
    if (automatic && (!dirty || composing || error || waiting || leaving)) return false;
    moveAfterSave.current = move ? question.id : null;
    const latest = inputSnapshot.current;
    const changedSinceSubmission =
      latest.state !== submitted.state ||
      (latest.state === "answered" && latest.value.trim() !== submitted.value.trim());
    preserveQuestionOnRecovery.current =
      automatic || !move || changedSinceSubmission ? question.id : null;
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    if (automatic) setAutoSaving(true);
    else setBusy(true);
    setError(null);
    try {
      failedOperation.current = { kind: "save", move, ...submitted };
      if (!(await verify(false, true)) || !accessCurrent(epoch)) return false;
      const next = await api.cases.saveAnswers(caseId, {
        expectedRevision: submitted.revision,
        answers: [
          submitted.state === "answered"
            ? {
                questionId: submitted.questionId,
                state: submitted.state,
                value: submitted.value.trim(),
              }
            : { questionId: submitted.questionId, state: submitted.state },
        ],
      });
      if (!alive(epoch)) return false;
      // The adapter reads again after saving, so its response can already include
      // a peer edit. Only the next revision with our answer proves this snapshot.
      const savedQuestion = next.questions.find((candidate) => candidate.id === question.id);
      acknowledgedRevision.current =
        next.revision === submitted.revision + 1 &&
        savedQuestion?.answerState === submitted.state &&
        (submitted.state !== "answered" || savedQuestion.answer === submitted.value.trim())
          ? next.revision
          : null;
      if ((automatic || replay) && acknowledgedRevision.current === null)
        throw new ApiError(
          "CONFLICT",
          "다른 화면에서 답변이 바뀌었어요. 작성 중인 답변은 남겨뒀어요. 최신 내용을 확인해 주세요.",
        );
      if (!(await verifyCompletion(epoch))) return false;
      const live = inputSnapshot.current;
      if (live.questionId === question.id) {
        preservedInput.current = live;
        if (
          live.state === savedQuestion?.answerState &&
          (live.state !== "answered" || live.value.trim() === savedQuestion?.answer)
        )
          drafts.current.delete(question.id);
        else drafts.current.set(question.id, { value: live.value, state: live.state });
      }
      acknowledgedRevision.current = null;
      preserveQuestionOnRecovery.current = null;
      failedOperation.current = null;
      setResult(next);
      const shouldMove = move && !drafts.current.has(question.id);
      if (shouldMove) moveAfterSave.current = null;
      if (shouldMove && index < next.questions.length - 1) {
        await transition(
          () => {
            setIndex(index + 1);
          },
          () => accessCurrent(epoch),
        );
      } else if (shouldMove) {
        // The answer is saved. Retry only generation with its new revision.
        failedOperation.current = { kind: "advance" };
        prepareNext();
        const advanced = await api.cases.advance(caseId, { expectedRevision: next.revision });
        if (!(await verifyCompletion(epoch))) return false;
        failedOperation.current = null;
        await showNext(advanced, epoch);
      }
      return true;
    } catch (cause) {
      if (alive(epoch)) report(cause);
      return false;
    } finally {
      if (alive(epoch)) {
        setBusy(false);
        setAutoSaving(false);
        setPreparing(false);
        pending.current = false;
      }
    }
  }
  return (
    <div className="intake-flow intake-detail-flow">
      <nav className="intake-scene-nav" aria-label="사건 정리 탐색">
        <BackToCases />
        <span>
          {question
            ? `${round.ordinal}차 질문 · ${roundIndex + 1} / ${round.questionIds.length}`
            : "질문은 최대 두 차례"}
        </span>
      </nav>
      {loading && !result && !error ? (
        <LoadingContent layout="detail" title="저장한 질문을 불러오고 있어요." />
      ) : null}
      {error ? (
        <ErrorPanel
          error={error}
          retry={() => {
            const operation = failedOperation.current;
            if ((error as { code?: string }).code === "CONFLICT") void load(false, true);
            else if (operation?.kind === "advance") void (dirty ? save(true) : advance());
            else if (operation?.kind === "save")
              void save(operation.move, operation.state, false, operation);
            else void load();
          }}
          disabled={
            busy || leaving || (waiting && (error as { code?: string }).code !== "CONFLICT")
          }
        />
      ) : null}
      {ready && item && result ? (
        <section className="intake-scene" data-transition={leaving ? "leaving" : "idle"}>
          {!canMutate && (
            <p>
              저장한 질문과 답변을 읽을 수 있어요. 변경·AI 처리에는{" "}
              <a href={accessHref("consent")}>최신 동의 확인</a>이 필요해요.
            </p>
          )}
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
                    ? finalQuestion
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
                    className="intake-recovery"
                    variant="error"
                    title={failureTitle}
                    description={failureDescription}
                    action={recoveryActions}
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
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (requiresAdvanceRetry || pending.current) return;
                    if (canNavigateSavedAnswer) {
                      navigateQuestion(index + 1);
                    } else if (canAdvanceSavedAnswer) {
                      void advance();
                    } else if (result.failed && !dirty) {
                      if (result.retryable || result.canPrepareSummary) void advance();
                    } else void save(true);
                  }}
                >
                  <div className="intake-scene-composer">
                    {question.kind === "choice" && (
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
                              !customAnswer && answerState === "answered" && value === option
                                ? "selected"
                                : ""
                            }
                          >
                            <input
                              type="radio"
                              name={question.id}
                              value={option}
                              checked={
                                !customAnswer && answerState === "answered" && value === option
                              }
                              onChange={() => {
                                setCustomQuestionId(null);
                                setComposing(false);
                                changeAnswer(option, "answered");
                              }}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                        <label
                          className={customAnswer && answerState === "answered" ? "selected" : ""}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            value=""
                            checked={customAnswer && answerState === "answered"}
                            aria-controls={customAnswer ? "question-answer" : undefined}
                            onChange={() => {
                              setCustomQuestionId(question.id);
                              changeAnswer(customAnswer ? value : "", "answered");
                            }}
                          />
                          <span>직접 입력</span>
                        </label>
                      </fieldset>
                    )}
                    {(question.kind !== "choice" || customAnswer) && (
                      <>
                        <label className="sr-only" htmlFor="question-answer">
                          {question.kind === "choice" ? "직접 입력 답변" : "답변"}
                        </label>
                        <Textarea
                          id="question-answer"
                          className={
                            question.kind === "choice" ? "intake-choice-custom-input" : undefined
                          }
                          onCompositionStart={() => setComposing(true)}
                          onCompositionEnd={() => setComposing(false)}
                          value={answerState === "answered" ? value : ""}
                          disabled={locked}
                          onChange={(event) => {
                            changeAnswer(event.target.value, "answered");
                          }}
                          placeholder={
                            question.kind === "choice"
                              ? "선택지에 없는 내용을 적어주세요."
                              : "여기에 편하게 적어주세요."
                          }
                        />
                        {answerTooLong && (
                          <p role="alert">
                            답변은 1,000자까지 입력할 수 있어요. 내용을 줄인 뒤 저장해 주세요.
                          </p>
                        )}
                      </>
                    )}
                    {answerState === "unknown" || answerState === "skipped" ? (
                      <p className="intake-scene-answer-state">
                        {busy && failedOperation.current?.kind === "save"
                          ? "답변을 저장하고 있어요."
                          : question.answerState === answerState
                            ? answerState === "unknown"
                              ? "모름으로 저장했어요."
                              : "건너뛰기로 저장했어요."
                            : "아직 저장되지 않았어요. 다시 시도해 주세요."}
                      </p>
                    ) : null}
                    <div className="intake-scene-options">
                      <Button
                        variant="ghost"
                        disabled={locked || autoSaving}
                        onClick={() => {
                          changeAnswer(value, "unknown");
                          void save(true, "unknown");
                        }}
                      >
                        모름
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={locked || autoSaving}
                        onClick={() => {
                          changeAnswer(value, "skipped");
                          void save(true, "skipped");
                        }}
                      >
                        건너뛰기
                      </Button>
                    </div>
                  </div>
                  <div className="intake-scene-action intake-scene-navigation">
                    <Button
                      className="intake-scene-back"
                      variant="outline"
                      disabled={
                        busy ||
                        autoSaving ||
                        waiting ||
                        leaving ||
                        index === 0 ||
                        (error as { code?: string })?.code === "CONFLICT" ||
                        (!!error && failedOperation.current?.kind === "save")
                      }
                      onClick={() => void navigateQuestion(index - 1)}
                    >
                      <ArrowLeft size={18} aria-hidden="true" />
                      이전으로
                    </Button>
                    {waiting ? (
                      <PreparationStatus title={statusTitle} />
                    ) : !canMutate ? (
                      <Button
                        className="intake-scene-primary"
                        type="button"
                        disabled={busy || leaving || index >= result.questions.length - 1}
                        onClick={() => navigateQuestion(index + 1)}
                      >
                        다음 질문
                        <ArrowRight size={18} aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        className="intake-scene-primary"
                        type="submit"
                        disabled={
                          locked ||
                          autoSaving ||
                          requiresAdvanceRetry ||
                          (result.failed &&
                            !result.retryable &&
                            !result.canPrepareSummary &&
                            !dirty &&
                            !canNavigateSavedAnswer) ||
                          !answerState ||
                          (answerState === "answered" && (!value.trim() || answerTooLong))
                        }
                      >
                        {autoSaving
                          ? "자동 저장 중…"
                          : busy
                            ? "답변을 저장하고 있어요"
                            : canNavigateSavedAnswer
                              ? "다음 질문"
                              : canAdvanceSavedAnswer
                                ? finalQuestion
                                  ? "요약 보기"
                                  : "다음 질문 준비하기"
                                : finalQuestion
                                  ? "저장하고 요약 보기"
                                  : lastInRound && round.ordinal < roundLimit
                                    ? `저장하고 ${round.ordinal + 1}차 질문 보기`
                                    : "저장하고 다음 질문"}
                        <ArrowRight size={18} aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {result.failed && !waiting ? (
                    <StatePanel
                      className="intake-recovery"
                      variant="error"
                      title={failureTitle}
                      description={failureDescription}
                      action={recoveryActions}
                    />
                  ) : null}
                </form>
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PreparationStatus({ title }: { title: string }) {
  return (
    <div className="intake-scene-status" role="status" aria-live="polite" aria-atomic="true">
      <div>
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
