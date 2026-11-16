import {
  ArrowRight,
  CheckCheck,
  Clock3,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { accessHref } from "../../client/return-path";
import { BrandMark } from "../../components/ui/brand";
import { CaseWorkspaceFrame } from "../../components/ui/workspace-frame";
import { CaseNavigation } from "../../components/workspace/CaseNavigation";
import { ChatAttachments } from "../../components/workspace/ChatAttachments";
import { ElapsedTime } from "../../components/workspace/ElapsedTime";
import { EvidenceRequirements } from "../../components/workspace/EvidenceRequirements";
import { ProgressiveReply } from "../../components/workspace/ProgressiveReply";
import { uploadProgressLabel } from "../../components/workspace/processing-progress";
import { SourceCards } from "../../components/workspace/SourceCards";
import { referenceLabel, timelineDateLabel } from "../../components/workspace/source-label";
import { TimelineEvidence } from "../../components/workspace/TimelineEvidence";
import { timelineEventLength } from "../../components/workspace/timeline-draft";
import { Button, ButtonLink, Button as ComposerButton } from "../Button";
import { ComposerAddMenu } from "../conversation/ComposerAddMenu";
import { ConversationComposer } from "../conversation/ConversationComposer";
import { Dialog as Modal } from "../Dialog";
import { GlobalProductTheme } from "../GlobalTheme";
import { SelectField } from "../Select";
import { tabLabels } from "./presentation";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
import { WorkspaceContext } from "./WorkspaceContext";
import {
  WorkspaceInput as ControlInput,
  WorkspaceTextarea as ControlTextarea,
  WorkspaceLabel as FieldLabel,
} from "./WorkspaceControls";
import { workspaceFeedback } from "./WorkspaceFeedback";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { workspaceHistory } from "./WorkspaceHistory";
import { WorkspaceMaterials } from "./WorkspaceMaterials";
import { workspacePanes } from "./WorkspacePanes";
export function WorkspaceView({
  controller,
  components,
}: {
  controller: WorkspaceController;
  components: WorkspaceComponents;
}) {
  const {
    conversationClient,
    caseId,
    tab,
    lookupAvailable,
    view,
    progressiveIds,
    incomingActionMessages,
    conversationRequest,
    setConversationRequest,
    setAgentBusy,
    materialsOpen,
    setMaterialsOpen,
    materialsRequest,
    composerMenu,
    composerTrigger,
    conversationState,
    setConversationState,
    openMaterials,
    error,
    busy,
    draft,
    setDraft,
    draftComposing,
    messageTooLong,
    selected,
    setSelected,
    localAttachments,
    setLocalAttachments,
    chatAttachments,
    setChatAttachments,
    queuedSend,
    setQueuedSend,
    queuedUpload,
    conversationRefresh,
    notice,
    setNotice,
    uploadReadbackPending,
    preview,
    deleteFile,
    entry,
    setEntry,
    uploadConsent,
    setUploadConsent,
    setRetryUploads,
    acceptedFileRetries,
    uploadProgress,
    lookupOpen,
    setLookupOpen,
    lookupAttempt,
    uploadInput,
    uploadChooserScope,
    dialog,
    followingChat,
    pauseReplyFollowing,
    chatMessages,
    draftInput,
    ready,
    canMutate,
    verify,
    ticket,
    current,
    readonly,
    privateContent,
    followReply,
    finishReply,
    load,
    run,
    refreshPreparation,
    toggleAction,
    chooseAttachments,
    openUploadChooser,
    openConversationFile,
    send,
    sendLookup,
    upload,
    startEntry,
    closeDialog,
    base,
    readyFiles,
    pendingResponse,
    missingRequirements,
    retryMessage,
  } = controller;
  const { CaseDetail, ConversationAgent, CaseContextPanel, LookupDialog } = components;
  if (view?.case.schemaVersion === "1")
    return (
      <>
        {!ready && (
          <section
            data-product-workspace-error=""
            className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
            role={error ? "alert" : "status"}
          >
            <p>{error?.message ?? "계정을 확인하고 있어요."}</p>
            {error && (
              <Button variant="secondary" onClick={() => void load()}>
                다시 확인
              </Button>
            )}
          </section>
        )}
        {/* Keep legacy drafts mounted during verification; deny() removes view. */}
        <div hidden={!ready} inert={!ready}>
          <CaseDetail caseId={caseId} />
        </div>
      </>
    );

  const historyButton = workspaceHistory(controller);
  const renderConversationPane = workspacePanes(controller, components, historyButton);
  const contextSummary = <WorkspaceContext controller={controller} components={components} />;
  const { errorFeedback, uploadRecovery } = workspaceFeedback({ controller, components });
  const fileViewer = preview ? (
    <WorkspaceFileViewer controller={controller} components={components} />
  ) : null;
  const materialsPanel = <WorkspaceMaterials controller={controller} components={components} />;

  return (
    <div
      data-product-workspace=""
      data-workspace-tab={tab}
      className={`workspace workspace--${tab} m-0 flex h-full min-h-0 min-w-0 w-full max-w-none flex-1 flex-col p-0 text-[var(--pui-text)] [overflow-wrap:anywhere]${tab === "chat" && view && !view.messages.length ? " workspace--empty" : ""}`}
    >
      {/* Keep the chooser's original node attached during temporary access checks. */}
      <ControlInput
        ref={uploadInput}
        id="workspace-upload"
        aria-label={tab === "chat" ? "사진 또는 파일 첨부" : "업로드할 파일 선택"}
        type="file"
        hidden
        multiple
        disabled={!!busy || view?.case.stage !== "active"}
        accept=".txt,.pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx,image/*,audio/*,video/*"
        onChange={(event) => {
          if (
            uploadChooserScope.current &&
            uploadChooserScope.current !== `${caseId}:${ticket()}`
          ) {
            event.currentTarget.value = "";
            return;
          }
          uploadChooserScope.current = null;
          if (tab === "chat") {
            chooseAttachments(Array.from(event.target.files ?? []));
            event.target.value = "";
          } else void upload(event.target.files);
        }}
      />
      <CaseWorkspaceFrame
        kind={tab === "chat" ? "conversation" : "document"}
        header={
          <CaseNavigation
            caseId={caseId}
            title={
              (ready ? view?.case.title : null) ??
              (error ? "사건을 확인할 수 없어요" : "사건을 불러오는 중")
            }
            active={tab}
            fileCount={ready ? view?.files.length : undefined}
          />
        }
        {...(tab === "chat" && view
          ? {
              panel: (
                <CaseContextPanel
                  caseId={caseId}
                  files={ready ? view.files : []}
                  reportStatus={conversationState?.report.status}
                  materials={materialsPanel}
                  viewer={fileViewer}
                  viewingFileId={preview?.id}
                  materialsRequest={materialsRequest}
                  needsEvidence={missingRequirements.length > 0}
                  feedback={
                    materialsOpen && (errorFeedback || uploadRecovery) ? (
                      <>
                        {errorFeedback}
                        {uploadRecovery}
                      </>
                    ) : null
                  }
                  preparation={
                    <EvidenceRequirements
                      requirements={missingRequirements}
                      files={view.files}
                      facts={view.facts ?? []}
                      disabled={
                        readonly ||
                        !!busy ||
                        queuedSend ||
                        !!localAttachments.length ||
                        !!chatAttachments.length
                      }
                      onAdd={openUploadChooser}
                      onReview={openConversationFile}
                    />
                  }
                  onAdd={openUploadChooser}
                  canAdd={!readonly && !busy && !queuedSend}
                  onReview={(file, origin) => openConversationFile(file.id, origin)}
                />
              ),
              panelOpen: materialsOpen,
              onPanelOpenChange: async (open: boolean) => {
                if (!open && preview && !(await closeDialog())) return;
                setMaterialsOpen(open);
              },
            }
          : {})}
      >
        <div
          data-product-workspace-feedback=""
          className="min-h-0 text-sm leading-6 text-[var(--pui-muted)] empty:hidden"
          aria-live="polite"
          aria-atomic="true"
        >
          {notice || (busy === "file-retry" ? "자료 처리 요청을 확인하고 있어요…" : "")}
        </div>
        {!(tab === "chat" && materialsOpen) && errorFeedback}
        {!(tab === "chat" && materialsOpen) && uploadRecovery}
        {!error && !busy && (acceptedFileRetries.length > 0 || uploadReadbackPending) && (
          <Button
            variant="secondary"
            onClick={() =>
              void run("refresh", async (epoch) => {
                const next = await load();
                if (next && current(epoch)) setNotice("접수한 자료의 최신 상태를 확인했어요.");
              })
            }
          >
            접수 상태 다시 확인
          </Button>
        )}
        {!view && !error && (
          <div
            data-product-workspace-loading=""
            className="flex items-center gap-3 rounded-xl bg-[var(--pui-background)] p-5 text-sm text-[var(--pui-muted)]"
            role="status"
          >
            <LoaderCircle
              data-product-workspace-spin=""
              className="animate-spin motion-reduce:animate-none"
            />{" "}
            사건과 저장된 자료를 불러오고 있어요.
          </div>
        )}
        {/* Keep the generic retry control mounted above the private content. Focus
          verification hides that content, but must not swallow a pointer click.
          run() still verifies the latest owner and consent before any request. */}
        {tab === "chat" &&
          view?.messages
            .filter((message) => message.status === "failed" && message.retryable !== false)
            .map((message) => (
              <section
                data-product-workspace-message-failed=""
                className="space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3 text-sm leading-6 text-[var(--pui-muted)]"
                key={message.id}
                aria-label="응답 재시도"
              >
                <p>완료하지 못한 응답이 있어요. 같은 대화에서 다시 시도할 수 있어요.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy || !canMutate || view.case.stage !== "active"}
                  onClick={() => void retryMessage(message.id)}
                >
                  응답 다시 시도
                </Button>
              </section>
            ))}
        {view && (
          // Only the generic file-preview controls survive a focus check. Their
          // private content has the same gate below; all other tabs keep this gate.
          <div
            data-product-workspace-content=""
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            {...(tab === "files" ? {} : privateContent)}
          >
            {!canMutate && (
              <section
                data-product-workspace-error=""
                className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
                {...privateContent}
              >
                <p>
                  저장한 사건·자료는 읽을 수 있어요. 새 대화·수정·처리는 최신 동의 확인 후 사용할 수
                  있어요.
                </p>
                <ButtonLink href={accessHref("consent")}>동의 확인하고 계속하기</ButtonLink>
              </section>
            )}
            {view.case.stage !== "active" && (
              <section
                data-product-workspace-error=""
                className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
                {...privateContent}
              >
                <p>
                  {view.case.stage === "archived"
                    ? "보관된 사건이에요. 저장된 내용을 확인할 수 있어요."
                    : view.messages.length
                      ? "요약이 변경되어 다시 확인이 필요해요. 확인한 뒤 대화를 이어갈 수 있어요."
                      : "대화를 시작하려면 최신 요약을 확인해 주세요."}
                </p>
                {view.case.stage !== "archived" &&
                  (tab === "chat" && view.case.schemaVersion === "2" ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setConversationRequest({
                          id: crypto.randomUUID(),
                          action: "reconfirm_case",
                        })
                      }
                    >
                      요약 확인하기
                    </Button>
                  ) : (
                    <ButtonLink href={`${base}/summary`}>요약 확인하기</ButtonLink>
                  ))}
              </section>
            )}
            <div
              data-product-workspace-grid=""
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-5"
            >
              <section
                data-product-workspace-main=""
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
                aria-label={tabLabels[tab]}
              >
                {tab === "chat" && (
                  <>
                    {!!view.messages.length && (
                      <div data-product-workspace-chat-heading="" className="sr-only">
                        <h2>이어서 대화하기</h2>
                      </div>
                    )}
                    <div
                      ref={chatMessages}
                      data-product-workspace-messages=""
                      className="workspace-messages flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-6 [overflow-anchor:none] [scrollbar-width:thin] sm:px-6 [&>article]:mx-auto [&>article]:w-full [&>article]:max-w-3xl"
                      role="log"
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: The named scroll area must support keyboard scrolling.
                      tabIndex={0}
                      aria-label="사건 대화"
                      aria-live="polite"
                      onScroll={(event) => {
                        const messages = event.currentTarget;
                        followingChat.current =
                          messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 96;
                      }}
                    >
                      {contextSummary}
                      {!view.messages.length && (
                        <div
                          data-product-workspace-chat-welcome=""
                          className="mx-auto grid w-full max-w-2xl gap-3 py-10 text-center [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight [&_p]:text-sm [&_p]:text-[var(--pui-muted)]"
                        >
                          <h2>이제, 하나씩 풀어가요.</h2>
                          <p>더 기억나는 일이나 궁금한 점이 있나요?</p>
                          <div
                            data-product-workspace-suggestions=""
                            className="flex flex-wrap justify-center gap-2"
                          >
                            {["어떤 자료를 준비하면 좋을까요?", "추가로 기억난 일이 있어요"].map(
                              (prompt) => (
                                <Button
                                  key={prompt}
                                  variant="secondary"
                                  disabled={!!busy || readonly}
                                  onClick={() => {
                                    setDraft(prompt);
                                    draftInput.current?.focus();
                                  }}
                                >
                                  {prompt}
                                  <ArrowRight size={15} />
                                </Button>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                      {historyButton("messages", "이전 대화 더 불러오기")}
                      {view.messages.map((message) => (
                        <article
                          data-product-workspace-message=""
                          data-message-role={message.role}
                          className={`workspace-message workspace-message--${message.role} flex min-w-0 flex-col gap-3 text-sm leading-7 ${message.role === "user" ? "ml-auto rounded-2xl bg-[var(--pui-background)] p-4" : "py-2"}`}
                          key={message.id}
                        >
                          <div
                            data-product-workspace-message-label=""
                            className="flex min-w-0 items-center justify-between gap-3 text-xs text-[var(--pui-muted)] [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&_time]:text-[10px]"
                          >
                            <span>
                              {message.role !== "user" && <BrandMark size={25} />}
                              {message.role === "user" ? "나" : "BARO"}
                            </span>
                            <time dateTime={message.createdAt}>
                              {new Date(message.createdAt).toLocaleTimeString("ko-KR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                          </div>
                          {message.role === "assistant" && message.status === "complete" ? (
                            <ProgressiveReply
                              text={message.text}
                              animate={progressiveIds.has(message.id)}
                              onProgress={followReply}
                              onComplete={() => finishReply(message.id)}
                            />
                          ) : (
                            <p>{message.text}</p>
                          )}
                          {!!message.selectedFileIds?.length && (
                            <ul
                              data-product-workspace-message-attachments=""
                              className="m-0 grid list-none gap-2 p-0 [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:gap-2 [&_a]:rounded-xl [&_a]:border [&_a]:border-[var(--pui-border)] [&_a]:px-3 [&_a]:py-2 [&_a]:text-xs [&_span]:min-w-0 [&_span]:[overflow-wrap:anywhere]"
                              aria-label="메시지 첨부 파일"
                            >
                              {message.selectedFileIds.map((id) => (
                                <li key={id}>
                                  <a
                                    href={`${base}/files?file=${encodeURIComponent(id)}`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      openConversationFile(id, event.currentTarget);
                                    }}
                                  >
                                    <Paperclip size={15} />
                                    <span>
                                      {view.files.find((file) => file.id === id)?.name ??
                                        "삭제되었거나 확인할 수 없는 첨부 파일"}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                          {message.role === "assistant" &&
                            message.status === "complete" &&
                            message.references?.some((ref) => ref.kind === "user_material") && (
                              <p
                                data-product-workspace-evidence-notice=""
                                className="rounded-xl bg-[var(--pui-background)] p-3 text-xs leading-6 text-[var(--pui-muted)]"
                              >
                                첨부 자료를 근거로 활용했어요.{" "}
                                {view.case.schemaVersion === "2" ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setConversationRequest({
                                        id: crypto.randomUUID(),
                                        action: "add_material",
                                      })
                                    }
                                  >
                                    이 대화에서 자료 확인
                                  </Button>
                                ) : (
                                  <ButtonLink href={`${base}/files`}>자료 확인</ButtonLink>
                                )}
                              </p>
                            )}
                          {!!message.citations?.length && (
                            <SourceCards citations={message.citations} />
                          )}
                          {message.references?.some((ref) => ref.kind === "user_material") && (
                            <ul
                              data-product-workspace-message-references=""
                              className="m-0 grid list-none gap-1 p-0 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-lg [&_a]:text-xs [&_a]:underline [&_a]:underline-offset-4"
                              aria-label="답변에 사용한 자료"
                            >
                              {message.references
                                .filter((ref) => ref.kind === "user_material")
                                .map((ref) => (
                                  <li key={JSON.stringify(ref)}>
                                    <a
                                      href={`${base}/files?file=${encodeURIComponent(ref.fileId)}`}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        openConversationFile(ref.fileId, event.currentTarget);
                                      }}
                                    >
                                      {view.files.find((f) => f.id === ref.fileId)?.name ??
                                        "참조 자료"}{" "}
                                      · {referenceLabel(ref)}
                                    </a>
                                  </li>
                                ))}
                            </ul>
                          )}
                          {message.status === "pending" && (
                            <span
                              data-product-workspace-status=""
                              className="flex flex-wrap items-center gap-2 text-xs leading-6 text-[var(--pui-muted)]"
                            >
                              <LoaderCircle
                                size={15}
                                data-product-workspace-spin=""
                                className="animate-spin motion-reduce:animate-none"
                              />{" "}
                              응답 준비 중 · 저장된 대화는 유지돼요
                              {message.statusUpdatedAt && (
                                <ElapsedTime
                                  startedAt={message.statusUpdatedAt}
                                  label="· 마지막 상태 변경 후"
                                />
                              )}
                            </span>
                          )}
                          {message.status === "failed" && (
                            <div
                              data-product-workspace-message-failed=""
                              className="space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3 text-sm leading-6 text-[var(--pui-muted)]"
                            >
                              <p>
                                {message.retryable === false
                                  ? "내용을 확인한 뒤 새 메시지를 보내 주세요."
                                  : "같은 대화에서 다시 시도할 수 있어요."}
                              </p>
                            </div>
                          )}
                        </article>
                      ))}
                      {view.case.schemaVersion === "2" && (
                        <ConversationAgent
                          key={`${caseId}:${ticket()}`}
                          workspace={view}
                          client={conversationClient}
                          access={{ ready, canMutate, ticket, current, verify }}
                          incomingMessageIds={incomingActionMessages}
                          refreshKey={conversationRefresh}
                          queuedWork={queuedSend}
                          requestedAction={conversationRequest}
                          disabled={
                            !!busy ||
                            queuedSend ||
                            !!pendingResponse ||
                            view.case.stage === "archived"
                          }
                          onChanged={load}
                          onBusyChange={setAgentBusy}
                          onStateChange={setConversationState}
                          onOpenMaterials={openMaterials}
                          reportHref={`${base}/reports?mode=conversation`}
                          onReviewFile={openConversationFile}
                          onPaneOpen={pauseReplyFollowing}
                          renderPane={renderConversationPane}
                        />
                      )}
                    </div>
                    <GlobalProductTheme className="contents">
                      <ConversationComposer
                        formProps={{
                          onSubmit: (event) => void send(event),
                          onDragOver: (event) => {
                            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                          },
                          onDrop: (event) => {
                            if (event.dataTransfer.files.length) {
                              event.preventDefault();
                              if (!readonly)
                                chooseAttachments(Array.from(event.dataTransfer.files));
                            }
                          },
                          onPaste: (event) => {
                            if (event.clipboardData.files.length) {
                              event.preventDefault();
                              if (!readonly)
                                chooseAttachments(Array.from(event.clipboardData.files));
                            }
                          },
                        }}
                        textareaProps={{
                          ref: draftInput,
                          id: "workspace-message",
                          rows: 1,
                          // Native maxlength counts UTF-16; handlers cap Unicode characters.
                          maxLength: 20000,
                          value: draft,
                          disabled: readonly || busy === "send" || queuedSend,
                          onChange: (event) => {
                            const value = event.target.value;
                            setDraft(
                              draftComposing.current ? value : [...value].slice(0, 10000).join(""),
                            );
                          },
                          onCompositionStart: () => {
                            draftComposing.current = true;
                          },
                          onCompositionEnd: (event) => {
                            draftComposing.current = false;
                            setDraft([...event.currentTarget.value].slice(0, 10000).join(""));
                          },
                          placeholder: "사건에 대해 궁금한 점이나 추가할 내용을 적어 주세요",
                          "aria-invalid": messageTooLong,
                          onKeyDown: (event) => {
                            if (
                              event.key === "Enter" &&
                              (event.metaKey || event.ctrlKey) &&
                              !event.nativeEvent.isComposing &&
                              !draftComposing.current &&
                              event.nativeEvent.keyCode !== 229 &&
                              !busy &&
                              !pendingResponse &&
                              !readonly &&
                              !queuedSend &&
                              (draft.trim() ||
                                selected.length ||
                                localAttachments.length ||
                                chatAttachments.length) &&
                              (!localAttachments.length || uploadConsent) &&
                              !messageTooLong
                            ) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          },
                        }}
                        attachments={
                          <ChatAttachments
                            local={localAttachments}
                            uploaded={chatAttachments}
                            disabled={!!busy || readonly || queuedSend}
                            removeLocal={(file) => {
                              setLocalAttachments((items) => items.filter((item) => item !== file));
                              setRetryUploads((items) => items.filter((item) => item !== file));
                            }}
                            removeUploaded={(id) =>
                              setChatAttachments((items) => items.filter((item) => item.id !== id))
                            }
                          />
                        }
                        uploadConsent={
                          !!localAttachments.length && (
                            <label className="flex min-h-11 items-center gap-2 px-2 text-xs leading-5 text-[var(--pui-muted)]">
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)]"
                                checked={uploadConsent}
                                disabled={!!busy || readonly || queuedSend}
                                onChange={(event) => setUploadConsent(event.target.checked)}
                              />
                              첨부한 파일의 자동 처리에 동의합니다.
                            </label>
                          )
                        }
                        uploadFeedback={
                          (busy === "upload" || queuedSend) && (
                            <div
                              className="flex min-w-0 items-start gap-2 px-2 py-3 text-xs leading-5 text-[var(--pui-muted)]"
                              role="status"
                            >
                              {!uploadProgress &&
                              chatAttachments.length > 0 &&
                              chatAttachments.every((file) => file.status === "ready") ? (
                                <Clock3 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <LoaderCircle
                                  size={16}
                                  className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                {uploadProgress
                                  ? `${uploadProgress.fileName} · ${uploadProgressLabel(uploadProgress.value)}`
                                  : chatAttachments.length > 0 &&
                                      chatAttachments.every((file) => file.status === "ready")
                                    ? "사건과 리포트 준비의 완료 확인을 기다려요. 입력과 자료는 보존돼요."
                                    : "첨부 파일을 처리하고 있어요. 준비되면 메시지를 보내요."}
                                {uploadProgress && (
                                  <ElapsedTime
                                    startedAt={uploadProgress.startedAt}
                                    label=" · 전송 시작 후"
                                  />
                                )}
                                {!busy &&
                                  !chatAttachments.every((file) => file.status === "ready") &&
                                  " 파일 전송은 끝났고, 내용을 읽는 중이에요. 큰 문서나 음성·영상은 더 걸릴 수 있어요."}
                              </span>
                              {!busy && (
                                <ComposerButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    queuedUpload.current = null;
                                    setQueuedSend(false);
                                  }}
                                >
                                  전송 대기 취소
                                </ComposerButton>
                              )}
                            </div>
                          )
                        }
                        mentions={
                          !!selected.length && (
                            <section
                              className="mb-2 flex flex-wrap gap-1.5 px-2"
                              aria-label="멘션한 자료"
                            >
                              {readyFiles
                                .filter((file) => selected.includes(file.id))
                                .map((file) => (
                                  <span
                                    key={file.id}
                                    className="flex max-w-full items-center gap-1 rounded-lg border border-[var(--pui-border)] bg-[var(--pui-background)] pl-2 text-xs text-[var(--pui-text)]"
                                  >
                                    <FileText size={14} className="shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 truncate">{file.name}</span>
                                    <ComposerButton
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`${file.name} 멘션 해제`}
                                      disabled={!!busy || readonly || queuedSend}
                                      onClick={() =>
                                        setSelected((ids) => ids.filter((id) => id !== file.id))
                                      }
                                    >
                                      <X size={13} aria-hidden="true" />
                                    </ComposerButton>
                                  </span>
                                ))}
                            </section>
                          )
                        }
                        addMenu={
                          <ComposerAddMenu ref={composerMenu} triggerRef={composerTrigger}>
                            {(close) => (
                              <>
                                <ComposerButton
                                  type="button"
                                  variant="ghost"
                                  className="w-full justify-start rounded-lg"
                                  disabled={!!busy || readonly || queuedSend}
                                  onClick={() => {
                                    close();
                                    openUploadChooser();
                                  }}
                                >
                                  <Upload size={17} aria-hidden="true" />
                                  자료 추가
                                </ComposerButton>
                                <fieldset
                                  className="border-t border-[var(--pui-border)] pt-2"
                                  disabled={!!busy || readonly || queuedSend}
                                >
                                  <legend className="flex items-center gap-2 px-2 text-xs font-medium text-[var(--pui-muted)]">
                                    <Paperclip size={16} aria-hidden="true" /> 자료 멘션{" "}
                                    {selected.length > 0 && `· ${selected.length}개 선택`}
                                  </legend>
                                  {readyFiles.length ? (
                                    readyFiles.map((file) => (
                                      <label
                                        key={file.id}
                                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--pui-background)]"
                                      >
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)]"
                                          checked={selected.includes(file.id)}
                                          onChange={(event) =>
                                            setSelected((ids) =>
                                              event.target.checked
                                                ? [...new Set([...ids, file.id])]
                                                : ids.filter((id) => id !== file.id),
                                            )
                                          }
                                        />
                                        <span className="min-w-0 [overflow-wrap:anywhere]">
                                          {file.name}
                                        </span>
                                      </label>
                                    ))
                                  ) : (
                                    <p className="px-2 py-3 text-xs leading-5 text-[var(--pui-muted)]">
                                      처리가 완료된 자료를 대화에 연결할 수 있어요.
                                    </p>
                                  )}
                                </fieldset>
                                {lookupAvailable && view.case.schemaVersion === "2" && (
                                  <ComposerButton
                                    type="button"
                                    variant="ghost"
                                    className="w-full justify-start rounded-lg"
                                    aria-label="외부 조회"
                                    title="외부 조회"
                                    disabled={!!busy || readonly || queuedSend || pendingResponse}
                                    onClick={() => {
                                      composerMenu.current?.close();
                                      lookupAttempt.current = null;
                                      setLookupOpen(true);
                                    }}
                                  >
                                    <Search size={17} aria-hidden="true" />
                                    <span>외부 조회</span>
                                  </ComposerButton>
                                )}
                              </>
                            )}
                          </ComposerAddMenu>
                        }
                        sending={busy === "send"}
                        sendDisabled={
                          !!busy ||
                          queuedSend ||
                          (!draft.trim() &&
                            !selected.length &&
                            !localAttachments.length &&
                            !chatAttachments.length) ||
                          (!!localAttachments.length && !uploadConsent) ||
                          messageTooLong ||
                          readonly ||
                          pendingResponse ||
                          chatAttachments.some(
                            (file) => file.status === "failed" || !!file.uploadRejection,
                          )
                        }
                      />
                    </GlobalProductTheme>
                  </>
                )}
                {tab === "files" && materialsPanel}
                {tab === "timeline" && (
                  <>
                    <div
                      data-product-workspace-section-heading=""
                      className="flex flex-wrap items-start justify-between gap-4 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:tracking-tight [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-7 [&_p]:text-[var(--pui-muted)]"
                    >
                      <div>
                        <h2>사건의 흐름</h2>
                        <p>언제 어떤 일이 있었는지 차근차근 정리해요.</p>
                      </div>
                      <div
                        data-product-workspace-section-actions=""
                        className="flex min-w-0 flex-wrap gap-2"
                      >
                        <Button
                          variant="secondary"
                          disabled={!!busy || readonly || !!pendingResponse}
                          aria-busy={busy === "update-timeline" || undefined}
                          onClick={() => void refreshPreparation("timeline")}
                        >
                          <RefreshCw size={17} /> 새로고침
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!!busy || readonly}
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            void startEntry();
                          }}
                        >
                          <Plus size={17} />
                          일정 추가
                        </Button>
                      </div>
                    </div>
                    {!view.timeline.length && (
                      <div
                        data-product-workspace-empty=""
                        className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-[var(--pui-border)] bg-[var(--pui-surface)] px-5 py-10 text-center text-[var(--pui-muted)] [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-[var(--pui-text)] [&_p]:max-w-md [&_p]:text-sm [&_p]:leading-7"
                      >
                        <Clock3 size={32} />
                        <h3>타임라인을 시작하세요</h3>
                        <p>
                          처음 일어난 일부터 추가하세요. 날짜가 기억나지 않으면 비워 둘 수 있어요.
                        </p>
                      </div>
                    )}
                    {historyButton("timeline", "타임라인 더 불러오기")}
                    <ol
                      data-product-workspace-timeline=""
                      className="m-0 grid list-none gap-4 p-0 [&>li]:flex [&>li]:min-w-0 [&>li]:flex-wrap [&>li]:items-start [&>li]:gap-4 [&>li]:rounded-xl [&>li]:border [&>li]:border-[var(--pui-border)] [&>li]:bg-[var(--pui-surface)] [&>li]:p-4 [&_time]:min-w-24 [&_time]:text-xs [&_time]:leading-7 [&_time]:text-[var(--pui-muted)] [&_li>div]:min-w-0 [&_li>div]:flex-1 [&_li>div]:basis-48 [&_h3]:text-base [&_h3]:font-medium [&_p]:mt-1 [&_p]:text-sm [&_p]:leading-7"
                    >
                      {[...view.timeline]
                        .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
                        .map((item) => (
                          <li key={item.id}>
                            <time>{timelineDateLabel(item)}</time>
                            <div>
                              <h3>{item.title}</h3>
                              <p>{item.detail}</p>
                              <TimelineEvidence
                                entry={item}
                                files={view.files}
                                facts={view.facts}
                                base={base}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!!busy || readonly}
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                event.currentTarget.focus();
                                setEntry({
                                  ...item,
                                  expectedRevision: item.revision ?? view.case.revision,
                                });
                              }}
                            >
                              편집
                            </Button>
                          </li>
                        ))}
                    </ol>
                  </>
                )}
                {tab === "actions" && (
                  <>
                    <div
                      data-product-workspace-section-heading=""
                      className="flex flex-wrap items-start justify-between gap-4 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:tracking-tight [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-7 [&_p]:text-[var(--pui-muted)]"
                    >
                      <div>
                        <h2>다음 행동</h2>
                        <p>자료와 대화를 바탕으로 준비할 일을 정리해요.</p>
                      </div>
                      <div
                        data-product-workspace-section-actions=""
                        className="flex min-w-0 flex-wrap gap-2"
                      >
                        <Button
                          variant="secondary"
                          disabled={!!busy || readonly || !!pendingResponse}
                          aria-busy={busy === "update-actions" || undefined}
                          onClick={() => void refreshPreparation("actions")}
                        >
                          <RefreshCw size={17} /> 새로고침
                        </Button>
                      </div>
                    </div>
                    {!!view.actions.length && (
                      <div
                        data-product-workspace-action-status=""
                        className="flex flex-wrap items-center gap-4 rounded-xl bg-[var(--pui-background)] p-4"
                      >
                        <span
                          data-product-workspace-count=""
                          className="text-sm font-medium text-[var(--pui-text)]"
                          aria-live="polite"
                        >
                          {view.actions.filter((action) => action.done).length} /{" "}
                          {view.actions.length} 완료
                        </span>
                        <progress
                          data-product-workspace-action-progress=""
                          className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-[var(--pui-border)] accent-[var(--pui-primary)]"
                          aria-label="다음 행동 완료 현황"
                          max={view.actions.length}
                          value={view.actions.filter((action) => action.done).length}
                        />
                      </div>
                    )}
                    {!view.actions.length && (
                      <div
                        data-product-workspace-empty=""
                        className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-[var(--pui-border)] bg-[var(--pui-surface)] px-5 py-10 text-center text-[var(--pui-muted)] [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-[var(--pui-text)] [&_p]:max-w-md [&_p]:text-sm [&_p]:leading-7"
                      >
                        <CheckCheck size={32} />
                        <h3>준비할 일이 아직 없어요</h3>
                        <p>대화로 사실을 보충하면 다음에 확인할 일을 정리할 수 있어요.</p>
                        <ButtonLink href={base} variant="secondary">
                          대화로 이동
                        </ButtonLink>
                      </div>
                    )}
                    {historyButton("actions", "행동 더 불러오기")}
                    <ul
                      data-product-workspace-action-list=""
                      className="m-0 grid list-none gap-2 p-0 [&_li]:rounded-xl [&_li]:border [&_li]:border-[var(--pui-border)] [&_li]:bg-[var(--pui-surface)] [&_li]:p-3 [&_strong]:block [&_strong]:font-medium [&_small]:mt-1 [&_small]:block [&_small]:text-xs [&_small]:font-normal [&_small]:leading-6 [&_small]:text-[var(--pui-muted)]"
                      aria-busy={!!pendingResponse}
                    >
                      {view.actions.map((action) => (
                        <li key={action.id} className={action.done ? "is-done" : ""}>
                          <FieldLabel>
                            <ControlInput
                              type="checkbox"
                              checked={action.done}
                              disabled={!!busy || readonly || !!pendingResponse}
                              onChange={(event) =>
                                void toggleAction(action.id, event.target.checked)
                              }
                            />
                            <span>
                              <strong>{action.title}</strong>
                              <small>{action.detail}</small>
                              {busy === action.id && (
                                <small role="status">완료 표시를 저장하고 있어요…</small>
                              )}
                            </span>
                          </FieldLabel>
                        </li>
                      ))}
                    </ul>
                    <div
                      data-product-workspace-next=""
                      className="mt-4 space-y-3 rounded-2xl border border-[var(--pui-border)] p-5 [&_h3]:text-base [&_h3]:font-medium [&_p]:text-sm [&_p]:leading-7 [&_p]:text-[var(--pui-muted)]"
                    >
                      <h3>정리한 내용을 다음 단계로</h3>
                      <p>리포트를 검토하고 필요한 준비나 상담을 이어가세요.</p>
                      <div
                        data-product-workspace-buttons=""
                        className="flex min-w-0 flex-wrap items-center gap-2"
                      >
                        <ButtonLink href={`${base}/reports`}>리포트 열기</ButtonLink>
                      </div>
                    </div>
                  </>
                )}
              </section>
              {tab !== "chat" && contextSummary}
            </div>
          </div>
        )}
      </CaseWorkspaceFrame>
      {lookupOpen && (
        <LookupDialog
          key={caseId}
          returnFocusRef={composerTrigger}
          caseId={caseId}
          busy={busy === "lookup"}
          onClose={() => {
            setLookupOpen(false);
            lookupAttempt.current = null;
          }}
          onSubmit={sendLookup}
        />
      )}
      <Modal
        placement="responsive-sheet"
        panelRef={dialog}
        titleId="workspace-dialog-title"
        preserveMounted
        showCloseButton={false}
        headerActions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="닫기"
            disabled={!!busy}
            onClick={closeDialog}
          >
            <X size={20} />
          </Button>
        }
        open={!!((preview && tab !== "chat") || deleteFile || entry)}
        onClose={() => {
          void closeDialog();
        }}
        title={
          deleteFile
            ? "자료 삭제"
            : entry
              ? entry.id
                ? "타임라인 편집"
                : "타임라인 추가"
              : "자료 확인"
        }
        className={`max-h-[calc(var(--workspace-viewport-height,100dvh)-2.5rem)] max-w-[min(64rem,calc(var(--workspace-viewport-width,100vw)-2rem))] overflow-y-auto [--workspace-dialog-padding:24px] max-sm:max-h-[calc(var(--workspace-viewport-height,100dvh)-1.5rem)] max-sm:p-5 max-sm:[--workspace-dialog-padding:20px]${preview ? " pb-0 max-sm:pb-0" : ""}`}
      >
        <WorkspaceDialogContents controller={controller} fileViewer={fileViewer} />
      </Modal>
    </div>
  );
}

export function WorkspaceDialogContents({
  controller,
  fileViewer,
}: {
  controller: WorkspaceController;
  fileViewer: React.ReactNode;
}) {
  const {
    tab,
    deleteFile,
    ready,
    busy,
    view,
    closeDialog,
    deleteSelectedFile,
    error,
    entry,
    saveEntry,
    readonly,
    changeTimelinePrecision,
    timelineRecovery,
    setEntry,
  } = controller;
  return (
    <>
      {tab !== "chat" && fileViewer}
      {deleteFile && ready && (
        <>
          <p>
            <strong>{deleteFile.name}</strong> 원본과 처리 결과를 삭제할까요?
          </p>
          <p>
            이 자료를 포함한 저장 리포트와 서버의 PDF·ZIP 내보내기도 함께 삭제되며 되돌릴 수 없어요.
            필요한 리포트는 먼저 다운로드해 주세요. 이미 저장된 대화 내용과 다운로드한 파일은
            남으므로 다시 검토해 주세요.
          </p>
          <div
            data-product-workspace-buttons=""
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <Button variant="secondary" disabled={!!busy} onClick={closeDialog}>
              취소
            </Button>
            <Button
              variant="danger"
              disabled={!!busy || !ready || view?.case.stage === "archived"}
              onClick={() => void deleteSelectedFile()}
            >
              {busy === "delete" ? "삭제 중" : "자료 삭제 확인"}
            </Button>
          </div>
          {error && (
            <p
              role="alert"
              data-product-workspace-error=""
              className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
            >
              {error.message}
            </p>
          )}
        </>
      )}
      {entry && ready && (
        <form noValidate onSubmit={(event) => void saveEntry(event)}>
          <SelectField
            id="timeline-precision"
            label="날짜를 얼마나 기억하시나요?"
            value={entry.datePrecision ?? (entry.date ? "day" : "unknown")}
            disabled={readonly || !!busy}
            onValueChange={changeTimelinePrecision}
            options={[
              { value: "day", label: "연·월·일" },
              { value: "month", label: "연·월 (일 미상)" },
              { value: "year", label: "연도 (월·일 미상)" },
              { value: "unknown", label: "날짜 미상" },
            ]}
          />
          <FieldLabel htmlFor="timeline-date">날짜 (모르면 비워 두세요)</FieldLabel>
          <ControlInput
            id="timeline-date"
            name="date"
            type={
              entry.datePrecision === "year"
                ? "text"
                : entry.datePrecision === "month"
                  ? "month"
                  : "date"
            }
            inputMode={entry.datePrecision === "year" ? "numeric" : undefined}
            pattern={entry.datePrecision === "year" ? "[0-9]{4}" : undefined}
            disabled={readonly || !!busy || timelineRecovery || entry.datePrecision === "unknown"}
            value={
              entry.datePrecision === "year"
                ? (entry.date ?? "").slice(0, 4)
                : entry.datePrecision === "month"
                  ? (entry.date ?? "").slice(0, 7)
                  : (entry.date ?? "")
            }
            onChange={(event) => setEntry({ ...entry, date: event.target.value })}
          />
          <FieldLabel htmlFor="timeline-title">어떤 일이 있었나요?</FieldLabel>
          <ControlInput
            id="timeline-title"
            name="title"
            required
            disabled={readonly || !!busy || timelineRecovery}
            value={entry.title ?? ""}
            onChange={(event) => setEntry({ ...entry, title: event.target.value })}
          />
          <FieldLabel htmlFor="timeline-detail">상세 내용</FieldLabel>
          <ControlTextarea
            id="timeline-detail"
            name="detail"
            rows={4}
            disabled={readonly || !!busy || timelineRecovery}
            value={entry.detail ?? ""}
            onChange={(event) => setEntry({ ...entry, detail: event.target.value })}
          />
          {timelineEventLength(entry) > 2000 && (
            <p role="alert">일어난 일과 상세 내용은 합쳐서 2,000자까지 입력할 수 있어요.</p>
          )}
          <div
            data-product-workspace-buttons=""
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <Button variant="secondary" disabled={!!busy} onClick={closeDialog}>
              취소
            </Button>
            <Button
              type="submit"
              disabled={!!busy || readonly || timelineEventLength(entry) > 2000}
            >
              {busy === "timeline" ? "저장 중" : "타임라인 저장"}
            </Button>
          </div>
          {error && (
            <p
              role="alert"
              data-product-workspace-error=""
              className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
            >
              {error.message}
            </p>
          )}
        </form>
      )}
    </>
  );
}
