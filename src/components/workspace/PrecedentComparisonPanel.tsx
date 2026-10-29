import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../client/api/core";
import { precedentComparisonApi } from "../../client/api/precedent-comparison";
import { workspaceProgressText } from "../../client/api/workspace-progress";
import { opaqueIdSchema } from "../../contracts";
import type { V2PrecedentComparisonState } from "../../contracts/v2/precedent-comparison";
import type {
  V2PrecedentResearchContext,
  V2PrecedentSearchResponse,
} from "../../contracts/v2/precedent-research";
import type { useCustomerAccess } from "../intake/useCustomerAccess";
import { Button } from "../ui/button";
import { ComparisonResult } from "./ComparisonResult";

const terminal = new Set(["completed", "failed", "cancelled", "superseded"]);
export function PrecedentComparisonPanel({
  caseId,
  context,
  selected,
  sourceId,
  sourceNeedsRefresh,
  onRecovered,
  access,
  onSettled,
  onRefreshSources,
  heading,
  originalLink,
  children,
}: {
  caseId: string;
  context: V2PrecedentResearchContext;
  selected: V2PrecedentSearchResponse["items"][number] | null;
  sourceId: string | null;
  sourceNeedsRefresh: boolean;
  onRecovered: (comparison: V2PrecedentComparisonState["comparison"]) => void;
  access: ReturnType<typeof useCustomerAccess>;
  onSettled: () => void;
  onRefreshSources: () => void;
  heading: ReactNode;
  originalLink: ReactNode;
  children: ReactNode;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<V2PrecedentComparisonState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const startController = useRef<AbortController | null>(null);
  const boundary = useRef(access);
  boundary.current = access;
  const settled = useRef("");
  const completed = useRef(onSettled);
  completed.current = onSettled;
  const recovered = useRef(onRecovered);
  recovered.current = onRecovered;
  useEffect(() => {
    if (state?.comparison) recovered.current(state.comparison);
  }, [state?.comparison]);
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
  const sourceExpired = !!selected && selected.readToken === expiredToken;
  async function start() {
    if (!selected || pending || sourceExpired || sourceNeedsRefresh) return;
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
        // Foreground recovery may already have read this job's completed result
        // while its initial POST acknowledgment was still in flight.
        setState((current) => (current?.job.id === receipt.jobId ? current : null));
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
        if (cause instanceof ApiError && cause.code === "NOT_FOUND")
          setExpiredToken(selected.readToken);
        if (cause instanceof ApiError && ["CONFLICT", "NOT_FOUND"].includes(cause.code))
          completed.current();
      }
    } finally {
      if (!controller.signal.aborted && access.alive(ticket)) setStarting(false);
    }
  }
  if (!access.ready) return null;
  const comparison =
    state?.comparison && state.comparison.source.citation.id === sourceId ? state.comparison : null;
  return (
    <section className="precedent-comparison" aria-label="유사 판례 비교">
      <h3 className="sr-only">사건과 판례 비교</h3>
      <div className="precedent-detail-heading">
        {heading}
        <div className="precedent-detail-actions">
          {originalLink}
          <Button
            className="precedent-primary"
            aria-label="내 사건과 유사도 비교"
            loading={pending}
            disabled={
              !selected || pending || sourceExpired || sourceNeedsRefresh || !access.canMutate
            }
            onClick={() => void start()}
          >
            {pending ? "비교하고 있어요" : comparison ? "다시 비교" : "유사도 비교"}
          </Button>
        </div>
      </div>
      {(sourceExpired || sourceNeedsRefresh) && !pending && (
        <div role={sourceExpired ? "alert" : undefined}>
          <p>
            {sourceExpired
              ? "판례 확인 시간이 지났거나 원문이 바뀌었어요. 다시 검색한 판례를 선택해 주세요."
              : "새 비교를 시작하려면 최신 사건으로 판례를 다시 검색해 주세요."}
          </p>
          <Button
            disabled={pending}
            onClick={() => {
              setError(null);
              onRefreshSources();
            }}
          >
            판례 다시 검색
          </Button>
        </div>
      )}
      {!!error && !sourceExpired && (
        <p role="alert">{errorMessage(error)} 처리 중인 작업과 저장한 내용은 유지돼요.</p>
      )}
      {pending && (
        <p role="status" className="precedent-comparison-status">
          {state ? workspaceProgressText(state.job) : "비교를 준비하고 있어요."}
        </p>
      )}
      {state && !pending && state.job.status !== "completed" && (
        <p role="status">
          비교를 완료하지 못했어요. 최신 요약과 판례를 다시 확인한 뒤 비교해 주세요.
        </p>
      )}
      {comparison && state && (
        <>
          <ComparisonResult key={state.job.id} comparison={comparison} />
          {(state.stale ||
            comparison.summaryRevision !== context.summaryRevision ||
            (context.workspaceRevision !== comparison.basedOnWorkspaceRevision &&
              context.workspaceRevision !== comparison.publishedWorkspaceRevision)) && (
            <p role="status" className="precedent-notice">
              비교 이후 사건이나 확인한 원문 상태가 바뀌었어요. 최신 요약과 판례로 다시 비교해
              주세요.
            </p>
          )}
          {comparison.factsPartial && (
            <p className="precedent-scope">저장된 사실 중 일부가 이번 비교에 포함되지 않았어요.</p>
          )}
          <p className="precedent-comparison-meta">
            {new Date(comparison.checkedAt).toLocaleString("ko-KR")}에 비교
          </p>
        </>
      )}
      {!comparison && children}
    </section>
  );
}
