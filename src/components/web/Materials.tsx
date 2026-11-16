import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FolderPlus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  errorMessage,
  type FileUploadProgress,
  type FileView,
} from "../../client/api";
import { browserSessionScope } from "../../client/api/context";
import { queryKeys } from "../../client/query/resources";
import { useWebSession } from "../../client/query/session";
import type { V2FileObservation } from "../../contracts/v2";
import { downloadBlob } from "../reports/download";
import { Button, Dialog, Empty, formatBytes, Loading, Problem, SectionTitle } from "./Primitives";

type UploadItem = {
  key: string;
  file: File;
  status: "waiting" | "uploading" | "complete" | "failed";
  progress?: FileUploadProgress;
  message?: string;
};
type MaterialCommand =
  | { kind: "upload"; items: UploadItem[] }
  | { kind: "retry" | "original" | "remove"; file: FileView };
const statusLabels: Record<FileView["status"], string> = {
  uploading: "올리는 중",
  processing: "내용 확인 중",
  ready: "검토 가능",
  failed: "처리 실패",
  waiting: "처리 대기",
};
const stages: Record<FileUploadProgress["stage"], string> = {
  checking_access: "이용 상태 확인",
  hashing: "파일 확인",
  preparing: "업로드 준비",
  uploading: "파일 전송",
  checking: "전송 확인",
  confirming: "저장 확인",
};

export function Materials({
  caseId,
  onChanged,
}: {
  caseId: string;
  onChanged: () => Promise<void>;
}) {
  const { owner, session } = useWebSession();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [consent, setConsent] = useState(false);
  const [review, setReview] = useState<FileView | null>(null);
  const [removing, setRemoving] = useState<FileView | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const mounted = useRef(true);
  const current = useRef({ owner, caseId });
  current.current = { owner, caseId };
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const files = useQuery({
    queryKey: queryKeys.files(owner, caseId),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const value = await api.files.list(caseId, { metadataOnly: true });
      signal.throwIfAborted();
      return value;
    },
    enabled: Boolean(owner),
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      query.state.data?.some((file) => file.status === "processing")
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  });
  const updateUpload = (key: string, change: Partial<UploadItem>) =>
    setUploads((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const command = useMutation({
    mutationFn: async (action: MaterialCommand) => {
      const generation = browserSessionScope.snapshot();
      const operationOwner = owner;
      const apiOwner = session?.user?.id;
      const live = () =>
        mounted.current &&
        current.current.owner === operationOwner &&
        current.current.caseId === caseId &&
        browserSessionScope.isCurrent(generation);
      const assertLive = () => {
        if (!live()) throw new ApiError("UNAUTHENTICATED", "이용 계정 또는 사건이 변경됐어요.");
      };
      if (!operationOwner || !apiOwner) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
      const synchronize = async () => {
        if (!live()) return;
        try {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.files(operationOwner, caseId),
          });
          if (live()) await onChanged();
        } catch (error) {
          if (live()) setRefreshError(error);
        }
      };
      setNotice("");
      setRefreshError(null);
      if (action.kind === "upload") {
        if (!consent)
          throw new ApiError("VALIDATION_ERROR", "자료의 AI 자동 처리 안내를 확인해 주세요.");
        for (const item of action.items) {
          if (item.status === "complete") continue;
          assertLive();
          updateUpload(item.key, { status: "uploading", message: "" });
          let accepted: FileView;
          try {
            accepted = await api.files.upload(
              caseId,
              item.file,
              (progress) => {
                if (live()) updateUpload(item.key, { progress });
              },
              { metadataOnly: true },
            );
          } catch (error) {
            if (!live()) throw error;
            updateUpload(item.key, { status: "failed", message: errorMessage(error) });
            if (
              error instanceof ApiError &&
              ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code)
            )
              throw error;
            continue;
          }
          assertLive();
          // Acknowledgement precedes refresh. A failed refresh must never upload this file again.
          updateUpload(item.key, { status: "complete", message: `${accepted.name} 저장 완료` });
          await synchronize();
        }
        assertLive();
        setNotice("각 자료의 저장 결과를 확인해 주세요. 처리 중인 자료는 완료되면 갱신돼요.");
        return;
      }
      assertLive();
      if (action.kind === "original") {
        const blob = await api.files.original(caseId, action.file.id);
        assertLive();
        const verified = await api.session.get();
        assertLive();
        if (verified.user?.id !== apiOwner)
          throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
        downloadBlob(blob, action.file.name);
        setNotice("원본 다운로드를 요청했어요.");
      } else if (action.kind === "retry") {
        await api.files.retry(
          caseId,
          action.file.id,
          () => {
            if (live()) setNotice("자료 처리 요청을 접수했어요.");
          },
          { metadataOnly: true },
        );
        assertLive();
        await synchronize();
      } else {
        await api.files.remove(caseId, action.file.id);
        assertLive();
        setRemoving(null);
        setNotice("자료를 삭제했어요. 리포트에 반영된 내용도 다시 확인해 주세요.");
        await synchronize();
      }
    },
  });
  function run(action: MaterialCommand) {
    if (lock.current || command.isPending) return;
    lock.current = true;
    command.mutate(action, {
      onSettled: () => {
        lock.current = false;
      },
    });
  }
  function selectFiles(selected: FileList | null) {
    if (!selected) return;
    const additions = Array.from(selected).map((file) => ({
      key: crypto.randomUUID(),
      file,
      status: "waiting" as const,
    }));
    setUploads((items) => [
      ...items,
      ...additions.filter(
        (addition) =>
          !items.some(
            (item) =>
              item.status !== "complete" &&
              item.file.name === addition.file.name &&
              item.file.size === addition.file.size &&
              item.file.lastModified === addition.file.lastModified,
          ),
      ),
    ]);
    if (input.current) input.current.value = "";
  }
  const remaining = uploads.filter((item) => item.status !== "complete");
  return (
    <section className="web-material">
      <SectionTitle label="MATERIALS" title="이야기의 근거를 모아요">
        <Button
          variant="secondary"
          disabled={command.isPending}
          onClick={() => input.current?.click()}
        >
          <FolderPlus size={17} />
          자료 선택
        </Button>
      </SectionTitle>
      <p className="web-resource-intro">
        계약서, 사진, 대화 기록처럼 사건과 관련된 자료를 보관하고 내용을 확인하세요.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="사건 자료 선택"
        disabled={command.isPending}
        onChange={(event) => selectFiles(event.target.files)}
      />
      {uploads.length > 0 && (
        <section className="web-material-upload" aria-label="선택한 자료 업로드">
          <div className="web-material-upload__heading">
            <strong>선택한 자료 {uploads.length}개</strong>
            {uploads.some((item) => item.status === "complete") && (
              <Button
                variant="ghost"
                disabled={command.isPending}
                onClick={() =>
                  setUploads((items) => items.filter((item) => item.status !== "complete"))
                }
              >
                저장 완료 항목 닫기
              </Button>
            )}
          </div>
          <ul className="web-material-queue">
            {uploads.map((item) => (
              <li key={item.key}>
                <FileText size={19} aria-hidden="true" />
                <div>
                  <strong>{item.file.name}</strong>
                  <small>
                    {formatBytes(item.file.size)} ·{" "}
                    {item.status === "complete"
                      ? "저장 완료"
                      : item.status === "failed"
                        ? "저장 확인 필요"
                        : item.status === "uploading"
                          ? stages[item.progress?.stage ?? "preparing"]
                          : "업로드 전"}
                  </small>
                  {item.progress && item.status === "uploading" && (
                    <progress
                      aria-label={`${item.file.name} 전송 진행률`}
                      max={Math.max(1, item.progress.totalBytes)}
                      value={item.progress.completedBytes}
                    />
                  )}
                  {item.message && (
                    <p className={item.status === "failed" ? "web-material-error" : ""}>
                      {item.message}
                    </p>
                  )}
                </div>
                {!command.isPending && item.status !== "complete" && (
                  <Button
                    variant="ghost"
                    aria-label={`${item.file.name} 선택 취소`}
                    onClick={() =>
                      setUploads((items) => items.filter((entry) => entry.key !== item.key))
                    }
                  >
                    <X size={17} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {remaining.length > 0 && (
            <>
              <label className="web-resource-check">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={command.isPending}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  자료의 텍스트·이미지·음성을 AI가 자동으로 처리하는 데 동의합니다.{" "}
                  <a href="/policies/ai" target="_blank" rel="noopener noreferrer">
                    AI 이용 고지
                  </a>
                </span>
              </label>
              <p className="web-resource-caption">
                다른 사람의 자료는 업로드 권한을 확인해 주세요. AI가 읽지 못하거나 잘못 읽은 내용은
                원본과 대조해 주세요.
              </p>
              <Button
                disabled={!consent || command.isPending}
                onClick={() => run({ kind: "upload", items: remaining })}
              >
                <Upload size={17} />
                {command.isPending && command.variables?.kind === "upload"
                  ? "자료를 저장하고 있어요…"
                  : `${remaining.length}개 자료 ${remaining.some((item) => item.status === "failed") ? "다시 " : ""}업로드`}
              </Button>
            </>
          )}
        </section>
      )}
      {command.error && <Problem error={command.error} />}
      {Boolean(refreshError) && (
        <Problem
          error={refreshError}
          retry={() => {
            setRefreshError(null);
            void files.refetch();
          }}
        />
      )}
      {notice && (
        <p className="web-resource-notice" role="status">
          {notice}
        </p>
      )}
      {files.isPending ? (
        <Loading>사건 자료를 불러오고 있어요.</Loading>
      ) : files.error ? (
        <Problem error={files.error} retry={() => void files.refetch()} />
      ) : files.data.length === 0 ? (
        <Empty
          title="자료를 하나씩 더해 보세요"
          action={
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <Upload size={17} />첫 자료 추가하기
            </Button>
          }
        >
          사진이나 문서가 없어도 대화를 이어갈 수 있어요. 필요한 자료를 찾으면 여기에 모아 두세요.
        </Empty>
      ) : (
        <ul className="web-material-list">
          {files.data.map((file) => (
            <li className="web-material-card" key={file.id}>
              <div className="web-material-card__icon">
                <FileText size={22} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="web-material-card__body">
                <div>
                  <h3>{file.name}</h3>
                  <span className={`web-material-status web-material-status--${file.status}`}>
                    {statusLabels[file.status]}
                  </span>
                </div>
                <p>
                  {formatBytes(file.sizeBytes)}
                  {file.coverage ? ` · ${file.coverage}` : ""}
                </p>
                {file.status === "failed" && (
                  <p>자동 처리를 완료하지 못했어요. 원본을 확인하거나 다시 처리할 수 있어요.</p>
                )}
                <div className="web-resource-actions">
                  <Button
                    variant="secondary"
                    disabled={command.isPending || file.status === "uploading"}
                    onClick={() => setReview(file)}
                  >
                    내용 확인
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={command.isPending}
                    aria-label={`${file.name} 원본 다운로드`}
                    onClick={() => run({ kind: "original", file })}
                  >
                    <Download size={16} />
                    원본
                  </Button>
                  {(file.canRetry || file.canStartProcessing) && (
                    <Button
                      variant="ghost"
                      disabled={command.isPending}
                      onClick={() => run({ kind: "retry", file })}
                    >
                      <RefreshCw size={16} />
                      다시 처리
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={command.isPending}
                    aria-label={`${file.name} 삭제`}
                    onClick={() => setRemoving(file)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {review && (
        <MaterialReview
          key={review.id}
          caseId={caseId}
          file={review}
          onClose={() => setReview(null)}
        />
      )}
      {removing && (
        <Dialog
          title="자료를 삭제할까요?"
          onClose={() => {
            if (!command.isPending) setRemoving(null);
          }}
        >
          <p>
            <strong>{removing.name}</strong>
          </p>
          <p>
            이 자료의 원본과 처리 결과를 삭제해요. 이미 리포트에 반영된 문장은 별도로 확인해 주세요.
          </p>
          {command.error && <Problem error={command.error} />}
          <div className="web-resource-actions">
            <Button
              variant="secondary"
              disabled={command.isPending}
              onClick={() => setRemoving(null)}
            >
              취소
            </Button>
            <Button
              variant="danger"
              disabled={command.isPending}
              onClick={() => run({ kind: "remove", file: removing })}
            >
              {command.isPending ? "삭제 중…" : "자료 삭제"}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function observationPosition(position: V2FileObservation["position"]) {
  switch (position.kind) {
    case "document":
      return `${position.page}쪽${position.paragraph ? ` · ${position.paragraph}번째 문단` : ""}${position.table ? ` · 표 ${position.table.index}` : ""}`;
    case "image":
      return "이미지 관찰";
    case "audio":
      return `${Math.floor(position.startSeconds / 60)}:${String(Math.floor(position.startSeconds % 60)).padStart(2, "0")}–${Math.floor(position.endSeconds / 60)}:${String(Math.floor(position.endSeconds % 60)).padStart(2, "0")}`;
    case "video":
      return `영상 ${position.timestampSeconds.toFixed(1)}초`;
  }
}

function MaterialReview({
  caseId,
  file,
  onClose,
}: {
  caseId: string;
  file: FileView;
  onClose: () => void;
}) {
  const { owner } = useWebSession();
  const review = useInfiniteQuery({
    queryKey: [...queryKeys.files(owner, caseId), "review", file.id],
    initialPageParam: -1,
    queryFn: async ({ pageParam, signal }) => {
      signal.throwIfAborted();
      const result = await api.files.review(caseId, file.id, pageParam);
      signal.throwIfAborted();
      return result;
    },
    getNextPageParam: (last) => last.nextAfterOrdinal ?? undefined,
    enabled: Boolean(owner),
  });
  const first = review.data?.pages[0];
  return (
    <Dialog title={file.name} onClose={onClose}>
      <p className="web-resource-caption">
        AI가 읽은 내용을 원본과 대조해 주세요. 처리 결과가 사실이나 원본의 진정성을 보장하지는
        않아요.
      </p>
      {review.isPending ? (
        <Loading>자료 내용을 불러오고 있어요.</Loading>
      ) : review.error ? (
        <Problem error={review.error} retry={() => void review.refetch()} />
      ) : (
        <>
          {first?.coverage && (
            <p className="web-resource-notice">
              처리 범위:{" "}
              {(first.coverage.category === "audio"
                ? first.coverage.audio.status
                : first.coverage.status) === "complete"
                ? "전체 범위 처리"
                : "일부만 처리됨 · 누락된 내용을 원본에서 확인해 주세요"}
            </p>
          )}
          {first?.pendingReview && (
            <p className="web-resource-notice">
              이전에 시작한 교정 저장이 남아 있어요. 현재 표시된 내용과 저장 상태를 확인해 주세요.
            </p>
          )}
          {first?.recovery && <p className="web-resource-notice">{first.recovery.message}</p>}
          <ol className="web-material-observations">
            {review.data?.pages
              .flatMap((page) => page.observations)
              .map((observation) => (
                <li key={observation.value.id}>
                  <div>
                    <span>{observationPosition(observation.value.position)}</span>
                    <span>
                      {observation.value.userEdited
                        ? "사용자 교정"
                        : observation.value.certainty === "uncertain"
                          ? "확인 필요"
                          : "추출한 관찰"}
                      {!observation.value.included && " · 사용 제외"}
                    </span>
                  </div>
                  <p>{observation.value.text}</p>
                </li>
              ))}
          </ol>
          {!review.data?.pages.some((page) => page.observations.length) && (
            <p className="web-resource-caption">
              현재 확인할 수 있는 추출 내용이 없어요. 처리 상태와 원본을 확인해 주세요.
            </p>
          )}
          {review.hasNextPage && (
            <Button
              variant="secondary"
              disabled={review.isFetchingNextPage}
              onClick={() => void review.fetchNextPage()}
            >
              {review.isFetchingNextPage ? "불러오는 중…" : "다음 내용 불러오기"}
            </Button>
          )}
        </>
      )}
      <div className="web-resource-actions">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}
