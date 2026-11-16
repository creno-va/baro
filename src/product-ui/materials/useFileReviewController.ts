import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { FileReviewProgress, FileReviewView } from "../../client/api/types";
import { confirmAction } from "../../client/confirm";
import { useCustomerAccess } from "../../components/intake/useCustomerAccess";
import { coverageRows } from "./coverage";
import type { FileReviewProps, ReviewDraft, ReviewObservationRow } from "./types";

/** The original per-file read/write lifecycle, independent of its visual tree. */
export function useFileReviewController({
  caseId,
  fileId,
  canEdit,
  onChanged,
  onError,
  onDirtyChange,
  onBusyChange,
  refreshVersion,
}: FileReviewProps) {
  const fieldPrefix = useId();
  const [review, setReview] = useState<FileReviewView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { text: string; included: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [loadingAfter, setLoadingAfter] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const saved = useRef(review);
  saved.current = review;
  const draftDirty = useRef(false);
  const batchedReviewPending = useRef(false);
  draftDirty.current = Object.keys(drafts).length > 0;
  const report = useCallback(
    (cause: unknown) => {
      if ((cause as { batchedReviewPending?: boolean })?.batchedReviewPending)
        batchedReviewPending.current = true;
      const completed = (cause as { completedReviewEdits?: number })?.completedReviewEdits;
      if (completed)
        setNotice(
          `${completed}개 교정은 저장했어요. 남은 교정은 아직 저장하지 못했으며 입력은 그대로 남아 있어요.`,
        );
      setError(cause);
      return onError(cause);
    },
    [onError],
  );
  const [limit, setLimit] = useState(100);
  const serial = useRef(0),
    locked = useRef(false);
  const readRequest = useRef<number | null>(null);
  const failedReadAfter = useRef<number | null>(null);
  const purge = useCallback(() => {
    ++serial.current;
    setReview(null);
    batchedReviewPending.current = false;
    setError(null);
    setDrafts({});
    locked.current = false;
    setBusy(false);
    readRequest.current = null;
    failedReadAfter.current = null;
    setLoadingAfter(null);
  }, []);
  const { ready, canMutate, version, verify, ticket, current, alive } = useCustomerAccess(
    purge,
    report,
    true,
  );
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!draftDirty.current && !locked.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const canWrite = canMutate && canEdit && (error as { code?: string })?.code !== "CONFLICT";
  const load = useCallback(
    async (after = -1, replace = false, afterWrite = false) => {
      // Read requests are independent of the mutation lock. Only a mutation's
      // own completed-write refresh may load while that lock is held.
      if (readRequest.current !== null || (locked.current && !afterWrite)) return;
      if (batchedReviewPending.current && draftDirty.current && !replace) return;
      if (replace) batchedReviewPending.current = false;
      const request = ++serial.current;
      readRequest.current = request;
      failedReadAfter.current = null;
      setLoadingAfter(after);
      let epoch = ticket();
      try {
        if (!(await verify()) || request !== serial.current) return;
        epoch = ticket();
        const next = await api.files.review(caseId, fileId, after);
        if (!(await verify()) || !current(epoch) || request !== serial.current) return;
        if (
          !replace &&
          (after >= 0 || draftDirty.current) &&
          saved.current &&
          (saved.current.file.revision !== next.file.revision ||
            saved.current.workspaceRevision !== next.workspaceRevision)
        ) {
          throw new ApiError("CONFLICT", "자료가 변경됐어요. 최신 내용을 확인해 주세요.");
        }
        setError(null);
        if (replace) setDrafts({});
        setReview((old) =>
          after < 0
            ? old &&
              !replace &&
              (draftDirty.current ||
                (old.file.revision === next.file.revision &&
                  old.workspaceRevision === next.workspaceRevision))
              ? { ...next, observations: old.observations, nextAfterOrdinal: old.nextAfterOrdinal }
              : next
            : { ...next, observations: [...(old?.observations ?? []), ...next.observations] },
        );
      } catch (cause) {
        if (alive(epoch) && request === serial.current) {
          failedReadAfter.current = after;
          report(cause);
        }
      } finally {
        if (readRequest.current === request) {
          readRequest.current = null;
          setLoadingAfter(null);
        }
      }
    },
    [caseId, fileId, verify, ticket, current, alive, report],
  );
  const refresh = version ? `${version}:${refreshVersion ?? ""}` : "";
  useEffect(() => {
    if (refresh && !locked.current) void load();
  }, [refresh, load]);
  useEffect(
    () => () => {
      ++serial.current;
      readRequest.current = null;
    },
    [],
  );
  async function run(action: (epoch: number) => Promise<void>, write = true) {
    if (locked.current || readRequest.current !== null || (write && !canWrite)) return;
    locked.current = true;
    failedReadAfter.current = null;
    setBusy(true);
    setNotice("");
    const epoch = ticket();
    ++serial.current;
    try {
      if ((await verify(false, write)) && current(epoch)) await action(epoch);
    } catch (cause) {
      if (alive(epoch)) report(cause);
    } finally {
      if (alive(epoch)) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function progress(result: FileReviewProgress, epoch: number) {
    while (result.status === "saving" && current(epoch)) {
      const pending = result;
      setReview((old) => (old ? { ...old, pendingReview: pending } : old));
      if (!(await verify(false, true)) || !current(epoch)) return;
      result = await api.files.continueReview(caseId, fileId, result.reviewId);
    }
    if (!current(epoch)) return;
    setReview((old) =>
      old ? { ...old, pendingReview: result.status === "ready" ? null : result } : old,
    );
    if (result.status === "ready") {
      batchedReviewPending.current = false;
      setDrafts({});
      setNotice("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.");
      await load(-1, true, true);
      if (current(epoch)) await onChanged();
    }
  }
  const rows = review?.coverage ? coverageRows(review.coverage) : [];
  const photo =
    review?.coverage?.category === "image" ||
    review?.observations.some(({ value }) => value.position.kind === "image");
  const partial =
    review?.coverage?.category === "audio"
      ? review.coverage.audio.status === "partial"
      : review?.coverage?.status === "partial";
  async function retry() {
    const confirmEpoch = ticket();
    const replace = (error as { code?: string })?.code === "CONFLICT";
    if (
      replace &&
      draftDirty.current &&
      !(await confirmAction("저장하지 않은 교정 내용을 버리고 최신 내용을 불러올까요?"))
    )
      return;
    if (!current(confirmEpoch)) return;
    void load(replace ? -1 : (failedReadAfter.current ?? -1), replace);
  }
  function updateDraft(value: ReviewObservationRow["value"], next: ReviewDraft) {
    setDrafts((old) => {
      const copy = { ...old };
      if (next.text === value.text && next.included === value.included) delete copy[value.id];
      else copy[value.id] = next;
      return copy;
    });
  }
  function loadMore() {
    if (review) void load(review.nextAfterOrdinal ?? -1);
  }
  function continueSave() {
    if (!review) return;
    void run(async (epoch) =>
      progress(
        await api.files.continueReview(caseId, fileId, review.pendingReview?.reviewId ?? ""),
        epoch,
      ),
    );
  }
  function discardPending() {
    if (!review) return;
    void run(async (epoch) => {
      await api.files.discardReview(caseId, fileId, review.pendingReview?.reviewId ?? "");
      if (current(epoch)) {
        setDrafts({});
        await load(-1, false, true);
      }
    }, false);
  }
  function saveDrafts() {
    if (!review) return;
    void run(async (epoch) => {
      const result = await api.files.saveReview(
        caseId,
        fileId,
        {
          expectedRevision: review.file.revision,
          edits: Object.entries(drafts).map(([observationId, value]) => ({
            observationId,
            ...value,
          })),
        },
        review.workspaceRevision,
      );
      await progress(result, epoch);
    });
  }
  return {
    fieldPrefix,
    review,
    drafts,
    busy,
    loadingAfter,
    notice,
    error,
    ready,
    canMutate,
    canEdit,
    canWrite,
    dirty,
    rows,
    photo,
    partial,
    limit,
    setLimit,
    retry,
    updateDraft,
    loadMore,
    continueSave,
    discardPending,
    saveDrafts,
  };
}
export type FileReviewController = ReturnType<typeof useFileReviewController>;
