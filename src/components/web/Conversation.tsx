import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  CheckCheck,
  FileText,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type WorkspaceView } from "../../client/api";
import { queryKeys } from "../../client/query/resources";
import { useWebSession } from "../../client/query/session";
import type { V2ConversationActionRequest, V2MessageRequest } from "../../contracts/v2";
import { Button, Empty, Loading, Problem, useViewGuard } from "./Primitives";
import type { WebTab } from "./WebApp";

const settledFailure = (error: unknown) =>
  [
    "CONFLICT",
    "STALE_REVISION",
    "VALIDATION_ERROR",
    "IDEMPOTENCY_CONFLICT",
    "QUOTA_EXCEEDED",
    "CONSENT_REQUIRED",
    "INVALID_STATE",
    "REVIEW_REQUIRED",
  ].includes((error as { code?: string })?.code ?? "");

export function Conversation({
  view,
  onChanged,
  setTab,
}: {
  view: WorkspaceView;
  onChanged: () => Promise<void>;
  setTab: (tab: WebTab) => void;
}) {
  const { session, owner } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const sendAttempt = useRef<V2MessageRequest | null>(null);
  const analysisAttempt = useRef<V2ConversationActionRequest | null>(null);
  const pending = view.messages.some((message) => message.status === "pending");
  const progress = useQuery({
    queryKey: queryKeys.progress(owner, view.case.id),
    queryFn: ({ signal }) =>
      api.rework.getConversationProgress(view.case.id, {
        signal,
        expectedOwner: session?.user?.id ?? "",
      }),
    enabled: !!owner && view.case.schemaVersion !== "1",
    refetchInterval: (state) => {
      const value = state.state.data;
      return value &&
        (["pending", "running"].includes(value.state.analysis.status) ||
          value.state.report.status === "pending" ||
          value.reportContinuation)
        ? 2500
        : false;
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const input = {
        expectedRevision: view.case.revision,
        text: draft.trim(),
        selectedFileIds: selected,
      };
      if (
        !sendAttempt.current ||
        sendAttempt.current.text !== input.text ||
        JSON.stringify(sendAttempt.current.selectedFileIds) !== JSON.stringify(selected)
      )
        sendAttempt.current = input;
      return api.workspace.sendMessage(view.case.id, sendAttempt.current);
    },
    onSuccess: (next) => {
      if (!current()) return;
      query.setQueryData(queryKeys.workspace(owner, view.case.id), next);
      sendAttempt.current = null;
      setDraft("");
      setSelected([]);
      void query.invalidateQueries({ queryKey: queryKeys.cases(owner) });
      void query.invalidateQueries({ queryKey: queryKeys.progress(owner, view.case.id) });
    },
    onError: (error) => {
      if (settledFailure(error)) sendAttempt.current = null;
      if (current()) void onChanged();
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.workspace.retryMessage(view.case.id, id),
    onSuccess: (next) => {
      if (current()) query.setQueryData(queryKeys.workspace(owner, view.case.id), next);
    },
  });
  const more = useMutation({
    mutationFn: () => api.workspace.loadMore(view.case.id, "messages"),
    onSuccess: (next) => {
      if (current()) query.setQueryData(queryKeys.workspace(owner, view.case.id), next);
    },
  });
  const analyze = useMutation({
    mutationFn: async () => {
      if (!analysisAttempt.current) {
        const fresh = await api.rework.getConversationProgress(view.case.id, {
          expectedOwner: session?.user?.id ?? "",
        });
        if (!current()) throw new Error("화면이 변경됐어요.");
        analysisAttempt.current = {
          action: "analyze_legal",
          requestId: crypto.randomUUID(),
          expectedRevision: fresh.state.workspaceRevision,
        };
      }
      return api.rework.executeAction(view.case.id, analysisAttempt.current, {
        expectedOwner: session?.user?.id ?? "",
      });
    },
    onSuccess: async () => {
      if (!current()) return;
      analysisAttempt.current = null;
      await query.invalidateQueries({ queryKey: queryKeys.progress(owner, view.case.id) });
      if (current()) await onChanged();
    },
    onError: (error) => {
      if (settledFailure(error)) analysisAttempt.current = null;
    },
  });
  const analysisBusy = ["pending", "running"].includes(progress.data?.state.analysis.status ?? "");
  const readonly = view.case.stage === "archived" || view.case.schemaVersion === "1";
  useEffect(() => {
    if (view.messages.length)
      bottom.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [view.messages.length]);
  return (
    <div className="web-conversation">
      <section className="web-messages" aria-label="사건 대화">
        {view.pagination?.messages && (
          <Button variant="ghost" disabled={more.isPending} onClick={() => more.mutate()}>
            이전 대화 더 보기
            <ArrowDown size={15} />
          </Button>
        )}
        {more.error && <Problem error={more.error} />}
        {!view.messages.length && (
          <Empty title="이제, 하나씩 함께 정리해요">
            확인한 사건 내용을 바탕으로 궁금한 점을 이야기해 주세요.
            <br />
            추가 자료와 중요한 일정도 함께 정리할 수 있어요.
          </Empty>
        )}
        {view.messages.map((message) => (
          <article
            key={message.id}
            className={`web-message web-message--${message.role}`}
            aria-label={message.role === "user" ? "내 메시지" : "BARO의 답변"}
          >
            {message.role === "assistant" && (
              <span className="web-assistant-mark" aria-hidden="true">
                b.
              </span>
            )}
            <div>
              <div className="web-message__label">
                {message.role === "assistant" ? "BARO" : "나"}
              </div>
              <p className="web-message__text">
                {message.text ||
                  (message.status === "pending"
                    ? "답변을 준비하고 있어요."
                    : "답변을 완료하지 못했어요.")}
              </p>
              {message.status === "pending" && (
                <Loading>저장된 내용으로 답변을 준비하고 있어요.</Loading>
              )}
              {message.status === "failed" && (
                <div className="web-notice">
                  <p>답변을 완료하지 못했어요. 보낸 내용은 저장돼 있어요.</p>
                  {message.retryable && (
                    <Button
                      variant="secondary"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(message.id)}
                    >
                      같은 답변 다시 확인
                    </Button>
                  )}
                </div>
              )}
              {message.selectedFileIds?.length ? (
                <span className="web-message__attachment">
                  <Paperclip size={13} />
                  자료 {message.selectedFileIds.length}개 포함
                </span>
              ) : null}
              {message.citations?.length ? (
                <details className="web-sources">
                  <summary>확인한 공식 근거 {message.citations.length}개</summary>
                  {message.citations.map((citation) => (
                    <a
                      key={citation.id}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {citation.title}
                    </a>
                  ))}
                </details>
              ) : null}
              {message.warnings?.map((warning) => (
                <p className="web-notice" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          </article>
        ))}
        {progress.error && <Problem error={progress.error} retry={() => void progress.refetch()} />}
        {progress.data?.state.snapshot && (
          <div className="web-analysis-card">
            <p className="web-eyebrow">법률·판례 확인</p>
            <h2>
              {analysisBusy
                ? "기존 조사 결과 · 새 결과 확인 중"
                : progress.data.state.analysis.status === "stale"
                  ? "사건이 바뀌어 다시 확인해야 해요"
                  : "현재 확인한 공식 근거"}
            </h2>
            {progress.data.state.snapshot.issues.map((issue) => (
              <details key={issue.id}>
                <summary>{issue.title}</summary>
                {issue.requirements.map((requirement) => (
                  <p key={requirement.id}>
                    <strong>{requirement.label}</strong> ·{" "}
                    {requirement.assessment === "supported"
                      ? "자료에서 뒷받침"
                      : requirement.assessment === "conflicting"
                        ? "상반된 내용 확인 필요"
                        : "근거 추가 확인 필요"}
                    {requirement.gaps.map((gap) => (
                      <span className="web-analysis-gap" key={gap}>
                        {gap}
                      </span>
                    ))}
                  </p>
                ))}
              </details>
            ))}
            {progress.data.state.snapshot.citations.map((citation) => (
              <a key={citation.id} href={citation.url} target="_blank" rel="noopener noreferrer">
                <BookOpen size={14} />
                {citation.title}
              </a>
            ))}
            {progress.data.state.snapshot.limitations.map((limitation) => (
              <p className="web-notice" key={limitation}>
                {limitation}
              </p>
            ))}
          </div>
        )}
        {analysisBusy && <Loading>사건 자료와 공식 근거를 확인하고 있어요.</Loading>}
        {analyze.error && <Problem error={analyze.error} />}
        {progress.data?.state.analysis.missingItems.map((item) => (
          <p className="web-notice" key={item}>
            {item}
          </p>
        ))}
        <div ref={bottom} />
      </section>
      <div className="web-composer-area">
        <div className="web-quick-actions">
          <Button variant="ghost" onClick={() => setTab("files")}>
            <Paperclip size={15} />
            자료 추가
          </Button>
          <Button
            variant="ghost"
            disabled={analyze.isPending || analysisBusy || pending || readonly}
            onClick={() => analyze.mutate()}
          >
            <Sparkles size={15} />
            법률·판례 확인
          </Button>
          <Button variant="ghost" onClick={() => setTab("report")}>
            <FileText size={15} />
            리포트
          </Button>
          <Button variant="ghost" onClick={() => setTab("timeline")} aria-label="타임라인">
            <CalendarDays size={16} />
          </Button>
          <Button variant="ghost" onClick={() => setTab("actions")} aria-label="다음 행동">
            <CheckCheck size={16} />
          </Button>
        </div>
        {send.error && <Problem error={send.error} />}
        {retry.error && <Problem error={retry.error} />}
        {readonly ? (
          <p className="web-notice">
            {view.case.schemaVersion === "1"
              ? "이전 버전 사건이에요. 기존 기록은 사건 요약에서 확인할 수 있어요."
              : "보관된 사건의 기록을 확인하고 있어요."}
          </p>
        ) : (
          <form
            className="web-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (lock.current || send.isPending || !draft.trim() || pending) return;
              lock.current = true;
              send.mutate(undefined, {
                onSettled: () => {
                  lock.current = false;
                },
              });
            }}
          >
            <label htmlFor="message" className="web-sr-only">
              사건에 관해 이야기하기
            </label>
            <textarea
              id="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={10000}
              placeholder="이야기를 이어가 주세요. 궁금한 점을 물어봐도 좋아요."
              disabled={send.isPending}
              required
              rows={2}
            />
            <div className="web-composer__footer">
              <Button
                variant="ghost"
                aria-expanded={showFiles}
                onClick={() => setShowFiles(!showFiles)}
              >
                <Paperclip size={17} />
                {selected.length ? `자료 ${selected.length}개 선택` : "자료 선택"}
              </Button>
              <span className="web-composer__hint">최대 10,000자</span>
              <Button
                type="submit"
                aria-label="메시지 보내기"
                disabled={!draft.trim() || send.isPending || pending}
              >
                <ArrowUp size={19} />
              </Button>
            </div>
            {showFiles && (
              <fieldset className="web-file-picker">
                <legend>대화에 포함할 자료</legend>
                {view.files
                  .filter((file) => file.status === "ready")
                  .map((file) => (
                    <label key={file.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(file.id)}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, file.id]
                              : ids.filter((id) => id !== file.id),
                          )
                        }
                      />
                      {file.name}
                    </label>
                  ))}
                <Button variant="ghost" onClick={() => setTab("files")}>
                  자료 추가·검토하기
                </Button>
              </fieldset>
            )}
          </form>
        )}
        <p className="web-composer-disclaimer">
          AI 답변은 틀릴 수 있어요. 중요한 판단과 기한은 공식 원문이나 전문가에게 확인해 주세요.
        </p>
      </div>
    </div>
  );
}
