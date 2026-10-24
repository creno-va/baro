import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../client/api/core";
import { precedentComparisonApi } from "../../client/api/precedent-comparison";
import { workspaceProgressText } from "../../client/api/workspace-progress";
import { opaqueIdSchema } from "../../contracts";
import {
  PRECEDENT_COMPARISON_CRITERIA,
  type V2PrecedentComparisonState,
} from "../../contracts/v2/precedent-comparison";
import type {
  V2PrecedentResearchContext,
  V2PrecedentSearchResponse,
} from "../../contracts/v2/precedent-research";
import type { useCustomerAccess } from "../intake/useCustomerAccess";
import { Button } from "../ui/button";

const terminal = new Set(["completed", "failed", "cancelled", "superseded"]);
const labels = { yes: "Y · 일치", no: "N · 다름", unknown: "확인 불가" };
export function PrecedentComparisonPanel({
  caseId,
  context,
  selected,
  access,
  onSettled,
}: {
  caseId: string;
  context: V2PrecedentResearchContext;
  selected: V2PrecedentSearchResponse["items"][number] | null;
  access: ReturnType<typeof useCustomerAccess>;
  onSettled: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<V2PrecedentComparisonState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const startController = useRef<AbortController | null>(null);
  const boundary = useRef(access);
  boundary.current = access;
  const settled = useRef("");
  const completed = useRef(onSettled);
  completed.current = onSettled;
  const key = `baro-precedent-comparison:${caseId}`;
  useEffect(() => () => startController.current?.abort(), []);
  const remember = useCallback(
    (id: string | null) => {
      try {
        if (id) sessionStorage.setItem(key, id);
        else sessionStorage.removeItem(key);
      } catch {
        /* Opaque hint only. */
      }
    },
    [key],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A successful foreground access check retries read-only recovery.
  useEffect(() => {
    const controller = new AbortController();
    const ticket = boundary.current.ticket();
    void (async () => {
      let remembered: string | null = null;
      try {
        const parsed = opaqueIdSchema.safeParse(sessionStorage.getItem(key));
        remembered = parsed.success ? parsed.data : null;
      } catch {
        /* Server remains authoritative. */
      }
      try {
        const latest = remembered
          ? null
          : await precedentComparisonApi.latest(caseId, controller.signal);
        if (controller.signal.aborted || !boundary.current.current(ticket)) return;
        if (remembered || latest?.kind === "chat_response")
          setJobId((current) => current ?? remembered ?? latest?.id ?? null);
      } catch (cause) {
        if (
          !controller.signal.aborted &&
          boundary.current.current(ticket) &&
          cause instanceof ApiError &&
          ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(cause.code)
        )
          boundary.current.deny();
      }
    })();
    return () => {
      controller.abort();
    };
  }, [caseId, key, access.version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restart polling with a fresh owner ticket after foreground verification.
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    const ticket = boundary.current.ticket();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let done = false;
    const poll = async () => {
      if (running || done || controller.signal.aborted) return;
      if (document.hidden) {
        timer = setTimeout(() => void poll(), 1800);
        return;
      }
      running = true;
      try {
        const value = await precedentComparisonApi.get(caseId, jobId, controller.signal);
        if (controller.signal.aborted || !boundary.current.current(ticket)) return;
        setState(value);
        setError(null);
        remember(jobId);
        done = terminal.has(value.job.status);
        if (done && settled.current !== jobId) {
          settled.current = jobId;
          completed.current();
        }
      } catch (cause) {
        if (controller.signal.aborted || !boundary.current.alive(ticket)) return;
        if (
          cause instanceof ApiError &&
          ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(cause.code)
        ) {
          done = true;
          boundary.current.deny();
          return;
        }
        if (cause instanceof ApiError && cause.code === "NOT_FOUND") {
          done = true;
          remember(null);
          setJobId(null);
          setState(null);
          return;
        }
        setError(cause);
      } finally {
        running = false;
        if (!done && !controller.signal.aborted) timer = setTimeout(() => void poll(), 1800);
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [caseId, jobId, remember, access.version]);
  const pending = starting || (!!jobId && (!state || !terminal.has(state.job.status)));
  async function start() {
    if (!selected || pending) return;
    const controller = new AbortController();
    startController.current = controller;
    const ticket = access.ticket();
    setStarting(true);
    setError(null);
    try {
      if (!(await access.verify(false, true)) || !access.current(ticket)) return;
      const receipt = await precedentComparisonApi.start(
        caseId,
        {
          expectedRevision: context.workspaceRevision,
          summaryRevision: context.summaryRevision,
          readToken: selected.readToken,
        },
        controller.signal,
      );
      if (!controller.signal.aborted && access.current(ticket)) {
        setState(null);
        setJobId(receipt.jobId);
        remember(receipt.jobId);
      }
    } catch (cause) {
      if (!controller.signal.aborted && access.alive(ticket)) {
        if (
          cause instanceof ApiError &&
          ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(cause.code)
        )
          access.deny();
        setError(cause);
        if (cause instanceof ApiError && ["CONFLICT", "NOT_FOUND"].includes(cause.code))
          completed.current();
      }
    } finally {
      if (!controller.signal.aborted && access.alive(ticket)) setStarting(false);
    }
  }
  if (!access.ready) return null;
  const comparison = state?.comparison;
  return (
    <section className="precedent-document precedent-comparison" aria-label="유사 판례 비교">
      <h3>내 사건과 얼마나 비슷한가요?</h3>
      <p>판례를 선택하면 사건의 사실과 8개 항목을 비교해요. 모르는 내용은 추측하지 않아요.</p>
      <Button
        className="precedent-primary"
        disabled={!selected || pending || !access.canMutate}
        onClick={() => void start()}
      >
        {pending ? "비교하고 있어요" : "선택한 판례와 내 사건 비교"}
      </Button>
      {!!error && (
        <p role="alert">{errorMessage(error)} 처리 중인 작업과 저장한 내용은 유지돼요.</p>
      )}
      {pending && (
        <p role="status">
          {state ? workspaceProgressText(state.job) : "비교를 준비하고 있어요."} 대화 탭에서도 처리
          상태를 확인할 수 있어요.
        </p>
      )}
      {state && !pending && state.job.status !== "completed" && (
        <p role="status">
          비교를 완료하지 못했어요. 최신 요약과 판례를 다시 확인한 뒤 비교해 주세요.
        </p>
      )}
      {comparison && (
        <>
          <h4>확인한 항목 일치율 {comparison.percentage}%</h4>
          <progress value={comparison.percentage} max={100} aria-label="확인한 항목 일치율" />
          <p>
            전체 8개 중 {comparison.matchedCount}개 일치 · {comparison.knownCount}개 비교 가능 ·{" "}
            {8 - comparison.knownCount}개 확인 불가
          </p>
          <p className="precedent-scope">
            이 비율은 사실 항목의 일치 정도이며 판결 결과나 승소 가능성을 뜻하지 않아요. 포함된 사건
            사실과 판결문 발췌 범위만 비교했어요.
          </p>
          {state.stale && (
            <p role="status" className="precedent-notice">
              비교 이후 사건이나 확인한 원문 상태가 바뀌었어요. 최신 요약과 판례로 다시 비교해
              주세요.
            </p>
          )}
          {comparison.factsPartial && (
            <p className="precedent-scope">저장된 사실 중 일부가 이번 비교에 포함되지 않았어요.</p>
          )}
          <p>
            비교한 판례:{" "}
            <a href={comparison.source.citation.url} target="_blank" rel="noopener noreferrer">
              {comparison.source.citation.title} · {comparison.source.citation.caseNumber}
            </a>
          </p>
          <p className="precedent-metadata">
            {new Date(comparison.checkedAt).toLocaleString("ko-KR")}에 비교
          </p>
          <ol aria-label="판례 비교 항목">
            {comparison.metrics.map((metric) => (
              <li key={metric.criterion}>
                <details className="precedent-card">
                  <summary>
                    {PRECEDENT_COMPARISON_CRITERIA[metric.criterion]} · {labels[metric.verdict]}
                  </summary>
                  <p>{metric.explanation}</p>
                  {!!metric.caseEvidence.length && (
                    <div>
                      <strong>내 사건 근거</strong>
                      {metric.caseEvidence.map((e) => (
                        <blockquote key={`${e.factId}:${e.text}`}>{e.text}</blockquote>
                      ))}
                    </div>
                  )}
                  {!!metric.precedentEvidence.length && (
                    <div>
                      <strong>판례 원문 근거</strong>
                      {metric.precedentEvidence.map((e) => (
                        <blockquote key={`${e.startUtf16}:${e.endUtf16}`}>{e.text}</blockquote>
                      ))}
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
