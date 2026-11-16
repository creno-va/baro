import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type CaseView } from "../../client/api";
import type { AnswersInput } from "../../client/api/cases";
import { queryKeys } from "../../client/query/resources";
import { useWebSession } from "../../client/query/session";
import type { CaseDetail } from "../../contracts/cases";
import { Button, Loading, Problem, SectionTitle, useViewGuard } from "./Primitives";

export function Summary({
  caseId,
  onChanged,
  onComplete,
}: {
  caseId: string;
  onChanged: () => Promise<void>;
  onComplete: () => void;
}) {
  const { owner } = useWebSession();
  const item = useQuery({
    queryKey: queryKeys.case(owner, caseId),
    queryFn: () => api.cases.get(caseId),
    enabled: !!owner,
  });
  if (item.isPending) return <Loading>사건 내용을 확인하고 있어요.</Loading>;
  if (item.error)
    return (
      <div className="web-pane">
        <Problem error={item.error} retry={() => void item.refetch()} />
      </div>
    );
  if (item.data.schemaVersion === "1")
    return (
      <section className="web-pane">
        <SectionTitle label="이전 사건 기록" title={item.data.title} />
        <p className="web-prose">{item.data.summary}</p>
        {item.data.legacyDetail && <LegacyRecord detail={item.data.legacyDetail} />}
        <p className="web-notice">
          기존 기록을 그대로 보존하고 있어요. 새로 정리하려면 새 이야기를 시작해 주세요.
        </p>
      </section>
    );
  return item.data.stage === "intake" ? (
    <Intake
      key={caseId}
      caseId={caseId}
      onChanged={async () => {
        await item.refetch();
        await onChanged();
      }}
    />
  ) : (
    <CaseSummary
      item={item.data}
      onChanged={async () => {
        await item.refetch();
        await onChanged();
      }}
      onComplete={onComplete}
    />
  );
}

function Intake({ caseId, onChanged }: { caseId: string; onChanged: () => Promise<void> }) {
  const { owner } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const key = [...queryKeys.case(owner, caseId), "questions"];
  const questions = useQuery({
    queryKey: key,
    queryFn: () => api.cases.getQuestions(caseId),
    refetchInterval: (result) => (result.state.data?.processing ? 2500 : false),
  });
  const [answers, setAnswers] = useState<
    Record<string, { value: string; state: "answered" | "unknown" | "skipped" }>
  >({});
  const attempt = useRef<
    { kind: "save"; input: AnswersInput } | { kind: "advance"; revision: number } | null
  >(null);
  const [lockedDraft, setLockedDraft] = useState(false);
  const lock = useRef(false);
  const operation = useMutation({
    mutationFn: async (kind: "save" | "advance") => {
      if (!questions.data) throw new Error("질문을 먼저 확인해 주세요.");
      if (!attempt.current)
        attempt.current =
          kind === "advance"
            ? { kind, revision: questions.data.revision }
            : {
                kind,
                input: {
                  expectedRevision: questions.data.revision,
                  answers: questions.data.questions
                    .filter((question) => answers[question.id])
                    .map((question) => {
                      const answer = answers[question.id];
                      return answer?.state === "answered"
                        ? {
                            questionId: question.id,
                            state: "answered" as const,
                            value: answer.value.trim(),
                          }
                        : { questionId: question.id, state: answer?.state ?? "unknown" };
                    }),
                },
              };
      return attempt.current.kind === "advance"
        ? api.cases.advance(caseId, { expectedRevision: attempt.current.revision })
        : api.cases.saveAnswers(caseId, attempt.current.input);
    },
    onSuccess: async (next) => {
      if (!current()) return;
      attempt.current = null;
      setLockedDraft(false);
      setAnswers({});
      query.setQueryData(key, next);
      await onChanged();
    },
    onError: (error) => {
      if (
        ["CONFLICT", "VALIDATION_ERROR", "QUOTA_EXCEEDED"].includes(
          (error as { code?: string })?.code ?? "",
        )
      ) {
        attempt.current = null;
        if (current()) setLockedDraft(false);
      }
    },
  });
  useEffect(() => {
    if (questions.data?.complete && !questions.data.processing) void onChangedRef.current();
  }, [questions.data?.complete, questions.data?.processing]);
  if (questions.isPending) return <Loading>필요한 질문을 불러오고 있어요.</Loading>;
  if (questions.error)
    return (
      <div className="web-pane">
        <Problem error={questions.error} retry={() => void questions.refetch()} />
      </div>
    );
  const result = questions.data;
  const unanswered = result.questions.filter((question) => !question.answerState);
  const waiting = !!result.processing;
  const allAnswered = result.questions.every((question) => !!question.answerState);
  const run = (kind: "save" | "advance") => {
    if (lock.current || operation.isPending) return;
    lock.current = true;
    setLockedDraft(true);
    operation.mutate(kind, {
      onSettled: () => {
        lock.current = false;
      },
    });
  };
  return (
    <section className="web-pane web-intake">
      <SectionTitle label="이야기를 이해하는 중" title="조금만 더 들려주세요" />
      <p className="web-muted">
        한 번에 최대 3개씩, 두 차례 질문해요. 모르는 내용은 그대로 남겨도 괜찮아요.
      </p>
      {waiting ? (
        <Loading>{result.processingMessage || "다음 내용을 준비하고 있어요."}</Loading>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run("save");
          }}
        >
          {result.questions.map((question, index) => {
            const answer = answers[question.id];
            const state = answer?.state ?? question.answerState ?? "answered";
            const value = answer?.value ?? question.answer ?? "";
            return (
              <fieldset
                className="web-question"
                key={question.id}
                disabled={operation.isPending || lockedDraft}
              >
                <legend>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {question.text}
                </legend>
                {question.options?.length ? (
                  <div className="web-options">
                    {question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={value === option ? "is-selected" : ""}
                        onClick={() =>
                          setAnswers((old) => ({
                            ...old,
                            [question.id]: { state: "answered", value: option },
                          }))
                        }
                      >
                        {value === option && <Check size={14} />}
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <label className="web-sr-only" htmlFor={`answer-${question.id}`}>
                  질문 {index + 1}의 답변
                </label>
                <textarea
                  id={`answer-${question.id}`}
                  rows={2}
                  maxLength={1000}
                  disabled={state !== "answered"}
                  placeholder="기억나는 내용을 적어주세요."
                  value={value}
                  onChange={(event) =>
                    setAnswers((old) => ({
                      ...old,
                      [question.id]: { state: "answered", value: event.target.value },
                    }))
                  }
                />
                <div className="web-options">
                  <button
                    type="button"
                    className={state === "unknown" ? "is-selected" : ""}
                    onClick={() =>
                      setAnswers((old) => ({
                        ...old,
                        [question.id]: { state: "unknown", value: "" },
                      }))
                    }
                  >
                    잘 모르겠어요
                  </button>
                  <button
                    type="button"
                    className={state === "skipped" ? "is-selected" : ""}
                    onClick={() =>
                      setAnswers((old) => ({
                        ...old,
                        [question.id]: { state: "skipped", value: "" },
                      }))
                    }
                  >
                    건너뛰기
                  </button>
                  {state !== "answered" && (
                    <button
                      type="button"
                      onClick={() =>
                        setAnswers((old) => ({
                          ...old,
                          [question.id]: { state: "answered", value: "" },
                        }))
                      }
                    >
                      직접 답하기
                    </button>
                  )}
                </div>
              </fieldset>
            );
          })}
          {operation.error && <Problem error={operation.error} />}
          {lockedDraft && !operation.isPending && attempt.current && (
            <p className="web-notice">
              입력과 요청을 보존했어요. 같은 요청의 결과를 다시 확인해 주세요.
            </p>
          )}
          {result.failed && (
            <p className="web-notice">다음 내용을 준비하지 못했어요. 저장된 답변은 보존돼요.</p>
          )}
          <div className="web-inline-actions">
            {(Object.keys(answers).length > 0 || attempt.current?.kind === "save") && (
              <Button
                type="submit"
                disabled={
                  operation.isPending ||
                  Object.values(answers).some(
                    (answer) => answer.state === "answered" && !answer.value.trim(),
                  )
                }
              >
                {operation.isPending
                  ? "저장 중…"
                  : lockedDraft
                    ? "같은 저장 다시 확인"
                    : "답변 저장"}
              </Button>
            )}
            {(allAnswered ||
              !result.questions.length ||
              result.failed ||
              attempt.current?.kind === "advance") && (
              <Button
                disabled={
                  operation.isPending ||
                  Object.keys(answers).length > 0 ||
                  (result.failed && !result.retryable && !result.canPrepareSummary)
                }
                onClick={() => run("advance")}
              >
                {result.questions.length &&
                (result.rounds?.length ?? 0) < (result.roundLimit ?? 2) &&
                !result.canPrepareSummary
                  ? "다음 질문 받기"
                  : "사건 요약 준비하기"}
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
          {unanswered.length > 0 && (
            <p className="web-muted">아직 저장하지 않은 질문 {unanswered.length}개가 있어요.</p>
          )}
        </form>
      )}
    </section>
  );
}

function CaseSummary({
  item,
  onChanged,
  onComplete,
}: {
  item: CaseView;
  onChanged: () => Promise<void>;
  onComplete: () => void;
}) {
  const { owner, session } = useWebSession();
  const current = useViewGuard();
  const [correction, setCorrection] = useState("");
  const [edit, setEdit] = useState(false);
  const query = useQueryClient();
  const reconcileKey = [...queryKeys.case(owner, item.id), "reconciliation"];
  const reconciliation = useQuery({
    queryKey: reconcileKey,
    queryFn: ({ signal }) =>
      api.rework.getReconciliation(item.id, { signal, expectedOwner: session?.user?.id ?? "" }),
    enabled: !!owner,
    refetchInterval: (state) =>
      ["pending", "running"].includes(state.state.data?.status ?? "") ? 2500 : false,
  });
  const request = useMutation({
    mutationFn: () => {
      if (!item.summaryDetails) throw new Error("현재 요약을 먼저 확인해 주세요.");
      return api.rework.requestReconciliation(
        item.id,
        {
          expectedRevision: item.revision,
          summaryRevision: item.summaryDetails.revision,
          kind: "correction",
          explanation: correction.trim(),
        },
        { expectedOwner: session?.user?.id ?? "" },
      );
    },
    onSuccess: (next) => {
      if (current()) {
        query.setQueryData(reconcileKey, next);
        setEdit(false);
        setCorrection("");
      }
    },
  });
  const proposal = reconciliation.data?.proposal;
  const confirm = useMutation({
    mutationFn: async () => {
      if (proposal && reconciliation.data?.status === "proposed")
        return api.rework.confirmReconciliation(
          item.id,
          {
            expectedRevision: reconciliation.data.workspaceRevision,
            proposalId: proposal.id,
            summaryRevision: proposal.baseSummaryRevision,
          },
          { expectedOwner: session?.user?.id ?? "" },
        );
      return api.cases.confirmSummary(item.id, { expectedRevision: item.revision });
    },
    onSuccess: async () => {
      if (!current()) return;
      await query.invalidateQueries({ queryKey: reconcileKey });
      await onChanged();
      if (current()) onComplete();
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const state = reconciliation.data;
      if (!state?.request) throw new Error("변경 요청을 먼저 확인해 주세요.");
      return api.rework.cancelReconciliation(
        item.id,
        { expectedRevision: state.workspaceRevision, requestId: state.request.id },
        { expectedOwner: session?.user?.id ?? "" },
      );
    },
    onSuccess: (next) => {
      if (current()) query.setQueryData(reconcileKey, next);
    },
  });
  const busy =
    request.isPending ||
    confirm.isPending ||
    cancel.isPending ||
    ["pending", "running"].includes(reconciliation.data?.status ?? "");
  return (
    <section className="web-pane web-summary">
      <SectionTitle label="함께 정리한 내용" title="내 이야기가 맞는지 확인해 주세요" />
      <p className="web-prose">
        {item.summary || item.summaryDetails?.overview || "사건 요약을 준비하고 있어요."}
      </p>
      {item.summaryDetails?.facts.length ? (
        <div className="web-facts">
          <h3>확인할 사실</h3>
          {item.summaryDetails.facts.map((fact) => (
            <p key={fact.id}>
              <CheckCircle2 size={17} />
              <span>
                {fact.text}
                {["uncertain", "conflicting"].includes(fact.certainty) && (
                  <small>{fact.certainty === "conflicting" ? "상반된 내용" : "미확인"}</small>
                )}
              </span>
            </p>
          ))}
        </div>
      ) : null}
      {item.summaryDetails?.unknowns.length ? (
        <div className="web-notice">
          <strong>아직 확인하지 못한 내용</strong>
          <ul>
            {item.summaryDetails.unknowns.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reconciliation.error && (
        <Problem error={reconciliation.error} retry={() => void reconciliation.refetch()} />
      )}
      {request.error && <Problem error={request.error} />}
      {confirm.error && <Problem error={confirm.error} />}
      {cancel.error && <Problem error={cancel.error} />}
      {proposal && reconciliation.data?.status === "proposed" && (
        <article className="web-proposal">
          <p className="web-eyebrow">수정 제안 · 아직 적용 전</p>
          <h3>바뀔 내용을 확인해 주세요</h3>
          <p className="web-prose">{proposal.after.overview}</p>
          <h4>수정할 사실</h4>
          <ul>
            {proposal.after.facts.map((fact) => (
              <li key={fact.id}>
                {fact.text} ·{" "}
                {fact.certainty === "conflicting"
                  ? "상반된 내용"
                  : fact.certainty === "uncertain"
                    ? "미확인"
                    : fact.certainty === "observed"
                      ? "자료에서 관찰"
                      : "사용자 진술"}
              </li>
            ))}
          </ul>
          {proposal.after.unknowns.length > 0 && (
            <>
              <h4>미확인 사항</h4>
              <ul>
                {proposal.after.unknowns.map((unknown) => (
                  <li key={unknown}>{unknown}</li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>이전 요약과 비교</summary>
            <p className="web-prose">{proposal.before.overview}</p>
            <ul>
              {proposal.before.facts.map((fact) => (
                <li key={fact.id}>{fact.text}</li>
              ))}
            </ul>
          </details>
          {proposal.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          <div className="web-inline-actions">
            <Button disabled={busy} onClick={() => confirm.mutate()}>
              이 내용으로 수정 확인
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => cancel.mutate()}>
              수정 취소
            </Button>
          </div>
        </article>
      )}
      {["pending", "running"].includes(reconciliation.data?.status ?? "") && (
        <Loading>수정할 내용을 정리하고 있어요.</Loading>
      )}
      {edit && (
        <form
          className="web-correction"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <label htmlFor="correction">어떤 내용을 보완하거나 고칠까요?</label>
          <textarea
            id="correction"
            maxLength={5000}
            required
            value={correction}
            onChange={(event) => setCorrection(event.target.value)}
            rows={4}
          />
          <Button type="submit" disabled={busy || !correction.trim()}>
            수정 내용 정리하기
          </Button>
        </form>
      )}
      <div className="web-inline-actions">
        <Button
          variant="secondary"
          disabled={busy || reconciliation.data?.status === "proposed"}
          onClick={() => setEdit(!edit)}
        >
          <FileText size={16} />
          내용 보완하기
        </Button>
        {item.stage !== "active" && reconciliation.data?.status !== "proposed" && (
          <Button
            disabled={busy || reconciliation.isPending || !item.summary}
            onClick={() => confirm.mutate()}
          >
            이 내용으로 대화 시작
            <ArrowRight size={16} />
          </Button>
        )}
        {item.stage === "active" && (
          <Button onClick={onComplete}>
            대화로 돌아가기
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </section>
  );
}

function LegacyRecord({ detail }: { detail: CaseDetail }) {
  const result = detail.result;
  if (!result)
    return (
      <p className="web-notice">
        {detail.error?.message || "저장된 분석 결과가 없어요. 기존 사건의 입력 기록은 보존돼요."}
      </p>
    );
  if (result.kind !== "guidance")
    return (
      <div className="web-notice">
        <p>{result.message}</p>
        {result.notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
      </div>
    );
  return (
    <div className="web-legacy-record">
      <h3>내가 이야기한 내용</h3>
      <ul>
        {result.summary.userStatements.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <h3>정리한 내용</h3>
      <ul>
        {result.summary.organizedByAi.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {result.summary.unknowns.length > 0 && (
        <>
          <h3>확인할 내용</h3>
          <ul>
            {result.summary.unknowns.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      )}
      {result.issues.map((issue) => (
        <article key={issue.id}>
          <h3>{issue.title}</h3>
          <p className="web-prose">{issue.explanation}</p>
          <p className="web-notice">{issue.uncertainty}</p>
        </article>
      ))}
      {result.nextSteps.map((step) => (
        <article key={step.id}>
          <h3>{step.label}</h3>
          <p>{step.purpose}</p>
          <p className="web-notice">{step.caution}</p>
        </article>
      ))}
      {result.citations.map((citation) => (
        <p key={citation.id}>
          <a href={citation.url} target="_blank" rel="noopener noreferrer">
            {citation.lawName} {citation.article} · 공식 원문
          </a>
        </p>
      ))}
      {result.notices.map((notice) => (
        <p className="web-notice" key={notice}>
          {notice}
        </p>
      ))}
    </div>
  );
}
