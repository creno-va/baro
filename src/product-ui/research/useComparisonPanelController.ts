import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../client/api/errors";
import { precedentComparisonApi } from "../../client/api/precedent-comparison";
import type { useCustomerAccess } from "../../components/intake/useCustomerAccess";
import { opaqueIdSchema } from "../../contracts";
import type { V2PrecedentComparisonState } from "../../contracts/v2/precedent-comparison";
import type {
  V2PrecedentResearchContext,
  V2PrecedentSearchResponse,
} from "../../contracts/v2/precedent-research";

const terminal = new Set(["completed", "failed", "cancelled", "superseded"]);
export function useComparisonPanelController({
  caseId,
  context,
  selected,
  sourceId,
  sourceNeedsRefresh,
  access,
  onSettled,
  onRefreshSources,
  heading,
  originalLink,
  children,
  fullText,
}: {
  caseId: string;
  context: V2PrecedentResearchContext;
  selected: V2PrecedentSearchResponse["items"][number] | null;
  sourceId: string | null;
  sourceNeedsRefresh: boolean;
  access: ReturnType<typeof useCustomerAccess>;
  onSettled: () => void;
  onRefreshSources: () => void;
  heading: ReactNode;
  originalLink: ReactNode;
  children: ReactNode;
  fullText?: string | undefined;
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
  const attemptedRevision = useRef<number | null>(null);
  const key = `baro-precedent-comparison:${caseId}:${sourceId ?? "none"}`;
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
        if (remembered) setJobId((current) => current ?? remembered);
        else if (latest?.kind === "chat_response") {
          const value = await precedentComparisonApi.get(caseId, latest.id, controller.signal);
          if (controller.signal.aborted || !boundary.current.current(ticket)) return;
          const sameSource = value.comparison?.source.citation.sourceId === sourceId;
          const sameAdmission =
            attemptedRevision.current !== null &&
            value.job.target.kind === "workspace" &&
            value.job.target.workspaceRevision === attemptedRevision.current + 1;
          if (sameSource || (sameAdmission && !terminal.has(value.job.status))) {
            setState(value);
            setError(null);
            setJobId(latest.id);
            remember(latest.id);
          }
        }
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
  }, [caseId, key, sourceId, remember, access.version]);
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
        if (value.comparison && value.comparison.source.citation.sourceId !== sourceId) {
          done = true;
          remember(null);
          setJobId(null);
          setState(null);
          setError(null);
          return;
        }
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
  }, [caseId, jobId, sourceId, remember, access.version]);
  const pending = starting || (!!jobId && (!state || !terminal.has(state.job.status)));
  const sourceExpired = !!selected && selected.readToken === expiredToken;
  async function start() {
    if (!selected || pending || sourceExpired || sourceNeedsRefresh) return;
    const controller = new AbortController();
    startController.current = controller;
    const ticket = access.ticket();
    attemptedRevision.current = context.workspaceRevision;
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
  const comparison =
    state?.comparison && state.comparison.source.citation.sourceId === sourceId
      ? state.comparison
      : null;
  const refreshRequired = sourceExpired || (sourceNeedsRefresh && !comparison);
  const comparisonRevisionCurrent =
    !!comparison &&
    (context.workspaceRevision === comparison.basedOnWorkspaceRevision ||
      (context.workspaceRevision >= comparison.publishedWorkspaceRevision &&
        comparison.basedOnWorkspaceRevision >=
          (context.researchRevision ?? context.workspaceRevision - 2)));
  const comparisonStale =
    !!comparison &&
    (state?.stale ||
      comparison.summaryRevision !== context.summaryRevision ||
      !comparisonRevisionCurrent);
  const needsResearch = refreshRequired || comparisonStale;
  const incomplete = !!state && !pending && state.job.status !== "completed";
  const unreadable = !!error && !comparison;
  return {
    caseId,
    context,
    selected,
    sourceId,
    sourceNeedsRefresh,
    access,
    onRefreshSources,
    heading,
    originalLink,
    children,
    fullText,
    state,
    error,
    pending,
    sourceExpired,
    comparison,
    refreshRequired,
    comparisonStale,
    needsResearch,
    incomplete,
    unreadable,
    setError,
    start,
  };
}
export type ComparisonPanelProps = Parameters<typeof useComparisonPanelController>[0];
export type ComparisonPanelController = ReturnType<typeof useComparisonPanelController>;
