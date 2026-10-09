import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { FileReviewProgress, FileReviewView } from "../../client/api/types";
import { accessHref } from "../../client/return-path";
import type { V2Coverage } from "../../contracts/v2";
import { ErrorPanel } from "../intake/common";
import { useCustomerAccess } from "../intake/useCustomerAccess";
import { Button } from "../ui/button";
import { positionLabel } from "./source-label";

const status: Record<string, string> = {
  processed: "처리됨",
  silent: "무음",
  low_quality: "품질 저하",
  missing: "미처리",
  failed: "실패",
};
function coverageRows(value: V2Coverage): string[] {
  const audio = (v: {
    intervals: { startSeconds: number; endSeconds: number; status: string }[];
  }) =>
    v.intervals.map((p) => `${p.startSeconds}–${p.endSeconds}초 · ${status[p.status] ?? p.status}`);
  if (value.category === "document")
    return value.pages.map((p) => `${p.page}쪽 · ${status[p.status]}`);
  if (value.category === "image") return [`이미지 · ${status[value.observation]}`];
  if (value.category === "audio") return audio(value.audio);
  return [
    ...value.frames.map(
      (p) => `영상 ${p.timestampSeconds}초 · 프레임 ${p.frameIndex} · ${status[p.status]}`,
    ),
    ...(value.audio ? audio(value.audio).map((p) => `음성 ${p}`) : []),
    ...(value.sceneDetection === "failed"
      ? ["장면 변화 탐지 실패 · 추가 장면이 누락될 수 있어요."]
      : []),
  ];
}
export function FileReview({
  caseId,
  fileId,
  canEdit,
  onChanged,
  onError,
}: {
  caseId: string;
  fileId: string;
  canEdit: boolean;
  onChanged: () => Promise<unknown>;
  onError: (cause: unknown) => unknown;
}) {
  const [review, setReview] = useState<FileReviewView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { text: string; included: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const saved = useRef(review);
  saved.current = review;
  const draftDirty = useRef(false);
  draftDirty.current = Object.keys(drafts).length > 0;
  const report = useCallback(
    (cause: unknown) => {
      setError(cause);
      return onError(cause);
    },
    [onError],
  );
  const [limit, setLimit] = useState(100);
  const serial = useRef(0),
    locked = useRef(false);
  const purge = useCallback(() => {
    ++serial.current;
    setReview(null);
    setError(null);
    setDrafts({});
    locked.current = false;
    setBusy(false);
  }, []);
  const { ready, canMutate, version, verify, ticket, current, alive } = useCustomerAccess(
    purge,
    report,
    true,
  );
  const dirty = Object.keys(drafts).length > 0;
  const canWrite = canMutate && canEdit && (error as { code?: string })?.code !== "CONFLICT";
  const load = useCallback(
    async (after = -1, replace = false) => {
      const request = ++serial.current;
      let epoch = ticket();
      try {
        if (!(await verify())) return;
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
            ? next
            : { ...next, observations: [...(old?.observations ?? []), ...next.observations] },
        );
      } catch (cause) {
        if (alive(epoch) && request === serial.current) report(cause);
      }
    },
    [caseId, fileId, verify, ticket, current, alive, report],
  );
  useEffect(() => {
    if (version && !locked.current) void load();
  }, [version, load]);
  useEffect(
    () => () => {
      ++serial.current;
    },
    [],
  );
  async function run(action: (epoch: number) => Promise<void>, write = true) {
    if (locked.current || (write && !canWrite)) return;
    locked.current = true;
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
      setDrafts({});
      setNotice("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.");
      await load(-1, true);
      if (current(epoch)) await onChanged();
    }
  }
  const rows = review?.coverage ? coverageRows(review.coverage) : [];
  return (
    <section aria-label="자료 내용 검토" aria-busy={busy}>
      <h3>자료 내용 검토</h3>
      {error ? (
        <ErrorPanel
          error={error}
          retry={() => void load(-1, (error as { code?: string })?.code === "CONFLICT")}
          disabled={busy}
        />
      ) : null}
      {!ready || !review ? (
        <p role="status">처리 위치와 저장한 교정 내용을 불러오고 있어요.</p>
      ) : (
        <>
          {!canMutate && (
            <p>
              기존 자료를 읽을 수 있어요. 수정하려면{" "}
              <a href={accessHref("consent")}>최신 동의 확인</a>이 필요해요.
            </p>
          )}
          {canMutate && !canEdit && <p>자료 교정은 사건 요약을 확인한 뒤 진행할 수 있어요.</p>}
          {review.recovery && <p role="status">{review.recovery.message}</p>}
          <details>
            <summary>페이지·시간별 처리 범위 ({rows.length}개)</summary>
            {rows.length ? (
              <ul>
                {rows.slice(0, limit).map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            ) : (
              <p>확인된 처리 범위가 없어요.</p>
            )}
            {rows.length > limit && (
              <Button variant="outline" onClick={() => setLimit(limit + 100)}>
                처리 범위 100개 더 보기 ({rows.length - limit}개 남음)
              </Button>
            )}
          </details>
          {review.observations.map(({ value, original, ordinal }) => {
            const draft = drafts[value.id] ?? value;
            const update = (next: { text: string; included: boolean }) =>
              setDrafts((old) => {
                const copy = { ...old };
                if (next.text === value.text && next.included === value.included)
                  delete copy[value.id];
                else copy[value.id] = next;
                return copy;
              });
            return (
              <fieldset key={value.id} disabled={busy || !canWrite || !!review.pendingReview}>
                <legend>{positionLabel(value.position)}</legend>
                <details>
                  <summary>원본 추출 내용</summary>
                  <p style={{ whiteSpace: "pre-wrap" }}>{original.text}</p>
                </details>
                <label htmlFor={`observation-${ordinal}`}>확인·교정한 내용</label>
                <textarea
                  id={`observation-${ordinal}`}
                  maxLength={5000}
                  value={draft.text}
                  onChange={(e) => update({ text: e.target.value, included: draft.included })}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={draft.included}
                    onChange={(e) => update({ text: draft.text, included: e.target.checked })}
                  />
                  사건 정리와 새 리포트에 포함
                </label>
                {!draft.included && <p>원본은 보관하고 AI 처리·새 리포트에서 제외합니다.</p>}
                {value.userEdited && <p>사용자가 교정한 내용</p>}
              </fieldset>
            );
          })}
          {review.nextAfterOrdinal !== null && (
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() => void load(review.nextAfterOrdinal ?? -1)}
            >
              다음 처리 내용 보기
            </Button>
          )}
          {review.pendingReview ? (
            <div role="status">
              <p>
                {review.pendingReview.status === "conflict"
                  ? "사건이 바뀌었거나 저장 시간이 만료됐어요. 미완료 교정을 취소한 뒤 다시 확인해 주세요."
                  : `교정 저장 중 ${review.pendingReview.completed} / ${review.pendingReview.total}`}
              </p>
              {review.pendingReview.status === "saving" && (
                <Button
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void run(async (epoch) =>
                      progress(
                        await api.files.continueReview(
                          caseId,
                          fileId,
                          review.pendingReview?.reviewId ?? "",
                        ),
                        epoch,
                      ),
                    )
                  }
                >
                  저장 이어가기
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (epoch) => {
                    await api.files.discardReview(
                      caseId,
                      fileId,
                      review.pendingReview?.reviewId ?? "",
                    );
                    if (current(epoch)) {
                      setDrafts({});
                      await load();
                    }
                  }, false)
                }
              >
                미완료 교정 취소
              </Button>
            </div>
          ) : (
            dirty && (
              <Button
                disabled={busy || !canWrite || Object.values(drafts).some((d) => !d.text.trim())}
                onClick={() =>
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
                  })
                }
              >
                교정 내용 저장
              </Button>
            )
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
