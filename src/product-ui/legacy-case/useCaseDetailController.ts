import { useCallback, useEffect, useRef, useState } from "react";
import { accessHref } from "../../client/return-path";
import {
  analysisStatusResponseSchema,
  caseDetailResponseSchema,
  type CaseDetail as Detail,
  errorResponseSchema,
} from "../../contracts";
import { trackCase } from "../../server/modules/analytics/browser";
import { delays, stages, statusLabels, terminal } from "./presentation";

async function safeError(response: Response) {
  const body = errorResponseSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.error : null;
}
export function useCaseDetailController({ caseId }: { caseId: string }) {
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
      try {
        const response = await fetch(`/api/cases/${caseId}`, { signal: signal ?? null });
        if (ticket !== sequence.current || signal?.aborted) return null;
        if (response.status === 401) {
          window.location.assign(accessHref("login", `/cases/${caseId}`, "session_expired"));
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
        const value = body.data;
        if (value.startedAt)
          void trackCase("analysis_started", caseId, value.analysisId, {
            occurredAt: value.startedAt,
          });
        if (value.status === "needs_clarification")
          void trackCase("clarification_viewed", caseId, value.analysisId, {
            questionCount: value.questions.length,
          });
        else if (value.result)
          void trackCase("analysis_completed", caseId, value.analysisId, {
            ...(value.completedAt ? { occurredAt: value.completedAt } : {}),
            questionCount: value.questionCount ?? 0,
            resultStatus: value.status,
            citationCount: value.result.kind === "guidance" ? value.result.citations.length : 0,
          });
        else if (value.status === "failed")
          void trackCase("analysis_failed", caseId, value.analysisId, {
            ...(value.completedAt ? { occurredAt: value.completedAt } : {}),
            errorCategory:
              value.error?.code === "LEGAL_SOURCE_UNAVAILABLE"
                ? "legal_source"
                : value.error?.code === "ANALYSIS_TIMEOUT"
                  ? "timeout"
                  : "internal",
            retryable: value.error?.retryable ?? false,
          });
        return body.data;
      } catch (cause) {
        // A superseded request must not publish an error after a newer read.
        if (ticket !== sequence.current || signal?.aborted) return null;
        throw cause;
      }
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
      const ticket = sequence.current + 1;
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
              ticket === sequence.current &&
              current.current?.analysisId === status.data.analysisId
            )
              setStage(stages[status.data.status] ?? "상태 확인");
          }
        }
      } catch (cause) {
        if (requestController.signal.aborted || disposed || ticket !== sequence.current) return;
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
        window.location.assign(accessHref("login", `/cases/${caseId}`, "session_expired"));
        return;
      }
      if (!response.ok) {
        const problem = await safeError(response);
        if (problem?.code === "CONSENT_REQUIRED") setConsent(true);
        if (response.status === 409) await load();
        throw new Error(problem?.message ?? "저장하지 못했어요. 다시 시도해 주세요.");
      }
      // Only an acknowledged success ends this request. Lost replies keep its key.
      keys.current.delete(signature);
      if (action === "delete") {
        sequence.current++;
        void trackCase("case_deleted", caseId, detail.analysisId);
        setDeleted(true);
        current.current = null;
      } else {
        if (action === "answers") {
          const value = body as { answers: { status: string }[] };
          void trackCase("clarification_completed", caseId, detail.analysisId, {
            questionCount: value.answers.length,
            unknownCount: value.answers.filter((answer) => answer.status === "unknown").length,
          });
        }
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
  return {
    caseId,
    detail,
    stage,
    error,
    busy,
    confirmDelete,
    deleted,
    consent,
    heading,
    refreshSignal,
    mutate,
    setConfirmDelete,
  };
}
export type CaseDetailController = ReturnType<typeof useCaseDetailController>;
