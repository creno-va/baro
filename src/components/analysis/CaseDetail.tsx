import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type Answer,
  analysisStatusResponseSchema,
  answersForQuestionsSchema,
  caseDetailResponseSchema,
  type CaseDetail as Detail,
  errorResponseSchema,
  type Question,
} from "../../contracts";
import { statusLabels } from "../intake/CaseList";

const terminal = new Set(["completed", "out_of_scope", "urgent_redirect", "failed"]);
const delays = [1000, 2000, 4000, 8000, 15000];
const stages: Record<string, string> = {
  queued: "분석 대기",
  screening: "입력 확인",
  retrieving: "공식 자료 확인",
  generating: "결과 정리",
  validating: "결과 점검",
  waiting_for_answers: "추가 질문 대기",
  completed: "분석 완료",
  failed: "분석 실패",
  superseded: "최신 입력 확인",
};
async function safeError(response: Response) {
  const body = errorResponseSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.error : null;
}
function Questions({
  questions,
  revision,
  busy,
  onSubmit,
}: {
  questions: Question[];
  revision: number;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState("");
  function value(id: string) {
    const answer = answers[id];
    return answer?.status === "answered" ? answer.value : "";
  }
  function choose(questionId: string, status: "answered" | "unknown" | "skipped", value = "") {
    setAnswers((current) => ({
      ...current,
      [questionId]: status === "answered" ? { questionId, status, value } : { questionId, status },
    }));
  }
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = answersForQuestionsSchema(questions).safeParse({
      inputRevision: revision,
      answers: questions.map((q) => answers[q.id]),
    });
    if (!body.success) {
      setError("각 질문에 답변, 모름 또는 건너뛰기를 선택해 주세요.");
      return;
    }
    setError("");
    await onSubmit(body.data);
  }
  return (
    <section className="case-panel">
      <h2>확인이 필요한 내용</h2>
      <p>{questions.length} / 최대 5개 · 질문은 한 묶음만 제공돼요.</p>
      <p>질문이 생성된 뒤 24시간 안에 답해 주세요. 시간이 지나면 새 사건을 입력할 수 있어요.</p>
      <form onSubmit={(event) => void submit(event)}>
        {questions.map((question, index) => (
          <fieldset key={question.id} disabled={busy} aria-describedby="question-error">
            <legend>
              {index + 1}. {question.prompt}
            </legend>
            <label>
              답변 방식
              <select
                aria-label={`${index + 1}번 답변 방식`}
                value={answers[question.id]?.status ?? ""}
                onChange={(event) => {
                  const status = event.target.value;
                  if (status === "answered" || status === "unknown" || status === "skipped")
                    choose(question.id, status);
                }}
              >
                <option value="">선택해 주세요</option>
                <option value="answered">답변하기</option>
                <option value="unknown">모름</option>
                <option value="skipped">건너뛰기</option>
              </select>
            </label>
            {answers[question.id]?.status === "answered" &&
              (question.answerType === "choice" ? (
                <label>
                  답변
                  <select
                    aria-label={`${index + 1}번 답변`}
                    value={value(question.id)}
                    onChange={(event) => choose(question.id, "answered", event.target.value)}
                  >
                    <option value="">선택해 주세요</option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  답변
                  <textarea
                    aria-label={`${index + 1}번 답변`}
                    maxLength={1000}
                    value={value(question.id)}
                    onChange={(event) => choose(question.id, "answered", event.target.value)}
                  />
                </label>
              ))}
          </fieldset>
        ))}
        <p id="question-error" role="alert">
          {error}
        </p>
        <button className="primary" disabled={busy} type="submit">
          {busy ? "답변 저장 중" : "답변 보내기"}
        </button>
      </form>
    </section>
  );
}
function ResultView({ result }: { result: NonNullable<Detail["result"]> }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  if (result.kind !== "guidance")
    return (
      <section className="case-panel">
        <h2>{result.kind === "urgent_redirect" ? "안전 확인이 우선이에요" : "지원 범위 안내"}</h2>
        <p>{result.message}</p>
        {result.notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
        <a href="/">지원 범위와 한계 보기</a>
      </section>
    );
  return (
    <>
      <section className="case-panel" aria-labelledby="result-summary">
        <h2 id="result-summary">상황 정리</h2>
        <p>
          AI가 만든 일반 정보이며 법률 자문이 아니에요. 고지 버전 {result.noticeVersion} · 기준일{" "}
          {result.asOfDate}
        </p>
        {result.notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
        <h3>사용자가 알려준 내용</h3>
        <ul>
          {result.summary.userStatements.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <h3>AI가 정리한 내용</h3>
        <ul>
          {result.summary.organizedByAi.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <h3>확인 필요</h3>
        <ul>
          {result.summary.unknowns.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
      <section className="case-panel">
        <h2>시간 순서</h2>
        <ol>
          {result.timeline.map((entry) => (
            <li key={`${entry.date}-${entry.event}-${entry.source}`}>
              <span>{entry.date ?? "날짜 확인 필요"}</span> · {entry.event}
              <p className="case-muted">
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
      </section>
      <section className="case-panel">
        <h2>살펴볼 쟁점</h2>
        {result.issues.map((issue) => (
          <article key={issue.id}>
            <h3>{issue.title}</h3>
            <p>{issue.explanation}</p>
            <p>불확실성: {issue.uncertainty}</p>
            {issue.citationIds.map((id) => (
              <a key={id} href={`#source-${id}`}>
                연결된 공식 근거 확인
              </a>
            ))}
          </article>
        ))}
      </section>
      <section className="case-panel">
        <h2>자료 체크리스트</h2>
        <p>체크는 이 화면에서만 유지되며 법적 완료를 뜻하지 않아요.</p>
        {result.evidenceChecklist.map((item) => (
          <label className="evidence-choice" key={item.id}>
            <input
              type="checkbox"
              checked={!!checked[item.id]}
              onChange={(event) =>
                setChecked((current) => ({ ...current, [item.id]: event.target.checked }))
              }
            />
            <span>
              {item.label} ·{" "}
              {item.status === "provided"
                ? "제공됨"
                : item.status === "missing"
                  ? "없음"
                  : "확인 필요"}
              <small>{item.why}</small>
            </span>
          </label>
        ))}
      </section>
      <section className="case-panel">
        <h2>다음에 확인할 일</h2>
        {result.nextSteps.map((item) => (
          <article key={item.id}>
            <h3>{item.label}</h3>
            <p>{item.purpose}</p>
            <p>주의: {item.caution}</p>
            {item.citationIds.map((id) => (
              <a key={id} href={`#source-${id}`}>
                연결된 공식 근거 확인
              </a>
            ))}
          </article>
        ))}
      </section>
      <section className="case-panel">
        <h2>공식 출처</h2>
        <p>
          시행일과 실제 사건에 적용되는 시점은 다를 수 있어요. 원문과 적용 여부를 확인해 주세요.
        </p>
        <ul>
          {result.citations.map((citation) => (
            <li id={`source-${citation.id}`} key={citation.id}>
              <a href={citation.url} target="_blank" rel="noopener noreferrer">
                {citation.lawName} {citation.article} 공식 원문 (새 탭)
              </a>
              <p>
                시행일 {citation.effectiveDate} · 확인일 {citation.verifiedAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
export function CaseDetail({ caseId }: { caseId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleted, setDeleted] = useState(false),
    [consent, setConsent] = useState(false);
  const current = useRef<Detail | null>(null),
    pending = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    keys = useRef(new Map<string, string>()),
    refreshSignal = useRef<(() => void) | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (deleted) heading.current?.focus();
  }, [deleted]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const ticket = ++sequence.current;
      const response = await fetch(`/api/cases/${caseId}`, { signal: signal ?? null });
      if (response.status === 401) {
        window.location.assign("/login?error=session_expired");
        return null;
      }
      if (!response.ok) {
        const problem = await safeError(response);
        throw new Error(problem?.message ?? "사건을 불러오지 못했어요. 다시 확인해 주세요.");
      }
      const body = caseDetailResponseSchema.safeParse(await response.json());
      if (!body.success) throw new Error("상태를 확인하지 못했어요. 다시 확인해 주세요.");
      if (ticket !== sequence.current || signal?.aborted) return null;
      current.current = body.data;
      setDetail(body.data);
      setStage(statusLabels[body.data.status]);
      return body.data;
    },
    [caseId],
  );
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      index = 0,
      controller: AbortController | undefined;
    async function poll() {
      if (disposed || document.hidden || deleted) return;
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      try {
        const data = await load(requestController.signal);
        if (!data || disposed) return;
        setError("");
        if (!terminal.has(data.status)) {
          const response = await fetch(`/api/cases/${caseId}/analysis`, {
            signal: requestController.signal,
          });
          if (response.ok) {
            const status = analysisStatusResponseSchema.safeParse(await response.json());
            if (
              status.success &&
              !requestController.signal.aborted &&
              current.current?.analysisId === status.data.analysisId
            )
              setStage(stages[status.data.status] ?? "상태 확인");
          }
        }
      } catch (cause) {
        if (requestController.signal.aborted || disposed) return;
        setError(cause instanceof Error ? cause.message : "상태 확인에 실패했어요.");
      }
      if (
        !disposed &&
        !document.hidden &&
        (!current.current || !terminal.has(current.current.status))
      )
        timer = setTimeout(() => void poll(), delays[Math.min(index++, delays.length - 1)]);
    }
    function visibility() {
      if (timer) clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) {
        index = 0;
        void poll();
      }
    }
    refreshSignal.current = visibility;
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility);
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      refreshSignal.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", visibility);
    };
  }, [caseId, load, deleted]);
  async function mutate(action: "answers" | "retry" | "delete", body?: unknown) {
    if (pending.current || !detail) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setConsent(false);
    const signature = JSON.stringify({ action, body }),
      key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    try {
      const response = await fetch(
        `/api/cases/${caseId}${action === "delete" ? "" : `/${action}`}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          headers: {
            "idempotency-key": key,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (response.status === 401) {
        window.location.assign("/login?error=session_expired");
        return;
      }
      if (!response.ok) {
        const problem = await safeError(response);
        if (problem?.code === "CONSENT_REQUIRED") setConsent(true);
        if (response.status === 409) await load();
        throw new Error(problem?.message ?? "저장하지 못했어요. 다시 시도해 주세요.");
      }
      if (action === "delete") {
        setDeleted(true);
        current.current = null;
      } else {
        const data = await load();
        if (data && !terminal.has(data.status)) refreshSignal.current?.();
      }
      heading.current?.focus();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "요청을 완료하지 못했어요. 같은 요청으로 다시 시도해 주세요.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <section className="case-panel">
        <h1 ref={heading} tabIndex={-1}>
          사건과 관련 분석을 삭제했어요.
        </h1>
        <a className="button-link" href="/cases">
          내 사건으로
        </a>
      </section>
    );
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        {detail?.title ?? "사건 확인"}
      </h1>
      <p className="status-text" aria-live="polite" aria-atomic="true">
        {busy ? "요청을 저장하고 있어요." : stage || "사건을 불러오고 있어요."}
      </p>
      {error && (
        <section className="case-panel">
          <p role="alert" className="error-text">
            {error}
          </p>
          {consent ? (
            <a href="/consent">필수 동의 확인</a>
          ) : (
            <button type="button" onClick={() => refreshSignal.current?.()}>
              최신 상태 다시 확인
            </button>
          )}
        </section>
      )}
      {detail?.status === "needs_clarification" && (
        <Questions
          key={detail.analysisId}
          questions={detail.questions}
          revision={detail.inputRevision}
          busy={busy}
          onSubmit={(body) => mutate("answers", body)}
        />
      )}
      {detail && !terminal.has(detail.status) && detail.status !== "needs_clarification" && (
        <section className="case-panel">
          <h2>{stage}</h2>
          <p>화면을 떠나도 입력은 저장돼요. 내 사건에서 다시 확인할 수 있어요.</p>
        </section>
      )}
      {detail?.result && <ResultView key={detail.analysisId} result={detail.result} />}
      {detail?.status === "failed" && (
        <section className="case-panel">
          <h2>분석을 완료하지 못했어요</h2>
          <p>
            {detail.error?.code === "LEGAL_SOURCE_UNAVAILABLE"
              ? "공식 자료를 확인하지 못해 결과를 만들지 않았어요."
              : detail.error?.message}
          </p>
          {detail.error?.retryable ? (
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() => void mutate("retry", { inputRevision: detail.inputRevision })}
            >
              분석 다시 시도
            </button>
          ) : (
            <a href="/cases/new">새 사건 입력</a>
          )}
        </section>
      )}
      {detail && (
        <section className="case-panel">
          <h2>사건 삭제</h2>
          {confirmDelete ? (
            <>
              <p>사건 입력과 관련 분석·결과를 삭제해요. 되돌릴 수 없어요.</p>
              <button type="button" disabled={busy} onClick={() => void mutate("delete")}>
                사건 삭제 확인
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                취소
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
              사건 삭제
            </button>
          )}
        </section>
      )}
      <a href="/cases">내 사건으로</a>
    </>
  );
}
