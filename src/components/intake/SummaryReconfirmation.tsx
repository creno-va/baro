import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { CaseView, FileView } from "../../client/api/types";
import { startForegroundPolling } from "../../client/foreground-poll";
import { accessHref } from "../../client/return-path";
import type {
  V2CaseContext,
  V2SummaryReconciliation,
  V2SummaryReconciliationCancel,
  V2SummaryReconciliationConfirm,
  V2SummaryReconciliationRequest,
} from "../../contracts/v2";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Textarea } from "../ui/form";
import { LoadingContent } from "../ui/loading";
import { StatePanel } from "../ui/state-panel";
import { CaseMaterials } from "../workspace/CaseMaterials";
import { CaseContextNote } from "./CaseContextNote";
import { BackToCases, ErrorPanel } from "./common";
import { SummaryChanges, SummaryReading } from "./SummaryReading";
import { useCustomerAccess } from "./useCustomerAccess";

export type SummaryReconfirmationProps = {
  caseId: string;
  embedded?: boolean;
  onConfirmed?: (item: CaseView) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};
type Mutation =
  | { kind: "request"; input: V2SummaryReconciliationRequest }
  | { kind: "proposal"; input: V2SummaryReconciliationConfirm }
  | { kind: "cancel"; input: V2SummaryReconciliationCancel }
  | {
      kind: "initial";
      revision: number;
      summaryRevision: number | null;
      alreadyConfirmed: boolean;
    };
type Completion =
  | { kind: "proposal"; proposalId: string; summaryRevision: number }
  | { kind: "initial"; revision: number; summaryRevision: number | null };
function matches(item: CaseView, state: V2SummaryReconciliation, intent: Completion) {
  if (item.stage !== "active") return false;
  if (intent.kind === "initial")
    return (
      item.revision === intent.revision &&
      (item.summaryDetails?.revision ?? null) === intent.summaryRevision
    );
  return (
    state.status === "confirmed" &&
    state.proposal?.id === intent.proposalId &&
    state.confirmedWorkspaceRevision === item.revision &&
    state.confirmedSummaryRevision === intent.summaryRevision &&
    item.summaryDetails?.revision === intent.summaryRevision
  );
}

/** Remounting also revokes all pending responses when a host switches cases. */
export function SummaryReconfirmation(props: SummaryReconfirmationProps) {
  return <SummaryReconfirmationScene key={props.caseId} {...props} />;
}
function SummaryReconfirmationScene({
  caseId,
  embedded = false,
  onConfirmed,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: SummaryReconfirmationProps) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [state, setState] = useState<V2SummaryReconciliation | null>(null);
  const [context, setContext] = useState<V2CaseContext | null>(null);
  const [files, setFiles] = useState<FileView[]>([]);
  const [materialsError, setMaterialsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<"correction" | "addition" | null>(null);
  const [explanation, setExplanation] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [returnHref, setReturnHref] = useState(`/cases/${encodeURIComponent(caseId)}`);
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const fieldId = useId();
  const headingId = useId();
  const revision = useRef<CaseView | null>(null);
  revision.current = item;
  const pending = useRef(false);
  const request = useRef(0);
  const failed = useRef<Mutation | null>(null);
  const completion = useRef<Completion | null>(null);
  const requestIntent = useRef<V2SummaryReconciliationRequest | null>(null);
  const draft = useRef("");
  draft.current = explanation;
  const focusTarget = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onConfirmed, onDirtyChange, onBusyChange });
  callbacks.current = { onConfirmed, onDirtyChange, onBusyChange };
  const access = useCustomerAccess(
    () => {
      ++request.current;
      pending.current = false;
      failed.current = null;
      completion.current = null;
      requestIntent.current = null;
      revision.current = null;
      draft.current = "";
      setItem(null);
      setState(null);
      setContext(null);
      setFiles([]);
      setExplanation("");
      setKind(null);
      setConfirming(false);
      setBusy(false);
      setNotice("");
      setError(null);
    },
    setError,
    true,
  );
  const { ready, canMutate, ticket, current, alive, verify, version, deny } = access;
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("from");
    setReturnHref(
      ["files", "timeline", "actions", "precedents"].includes(tab ?? "") ? `${base}/${tab}` : base,
    );
  }, [base]);
  useEffect(() => {
    callbacks.current.onDirtyChange?.(explanation.trim().length > 0);
  }, [explanation]);
  useEffect(() => {
    callbacks.current.onBusyChange?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      callbacks.current.onDirtyChange?.(false);
      callbacks.current.onBusyChange?.(false);
    },
    [],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draft.current.trim()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const finish = useCallback(
    (next: CaseView) => {
      completion.current = null;
      failed.current = null;
      if (callbacks.current.onConfirmed) callbacks.current.onConfirmed(next);
      else window.location.assign(returnHref);
    },
    [returnHref],
  );
  const report = useCallback(
    (cause: unknown) => {
      if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string })?.code ?? ""))
        deny();
      setError(cause);
    },
    [deny],
  );
  const readSnapshot = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [next, reconciliation, contextView] = await Promise.all([
        api.cases.get(caseId),
        api.rework.getReconciliation(caseId, { expectedOwner: access.ownerId() ?? "" }),
        api.rework.getContext(caseId, { expectedOwner: access.ownerId() ?? "" }).catch(() => null),
      ]);
      if (next.revision === reconciliation.workspaceRevision) {
        if (
          reconciliation.status === "proposed" &&
          reconciliation.proposal &&
          next.summaryDetails &&
          JSON.stringify(reconciliation.proposal.before) !== JSON.stringify(next.summaryDetails)
        )
          throw new ApiError(
            "CONFLICT",
            "변경안의 기준과 현재 정리가 달라요. 최신 내용을 확인해 주세요.",
          );
        return {
          next,
          reconciliation,
          context: contextView?.workspaceRevision === next.revision ? contextView.context : null,
        };
      }
    }
    throw new ApiError(
      "CONFLICT",
      "다른 화면에서 사건 내용이 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
    );
  }, [caseId, access.ownerId]);
  const accept = useCallback((snapshot: Awaited<ReturnType<typeof readSnapshot>>) => {
    revision.current = snapshot.next;
    setItem(snapshot.next);
    setState(snapshot.reconciliation);
    setContext(snapshot.context);
    const saved = requestIntent.current;
    if (
      saved &&
      snapshot.reconciliation.request?.input.explanation === saved.explanation &&
      snapshot.reconciliation.request.input.kind === saved.kind &&
      snapshot.reconciliation.request.input.expectedRevision === saved.expectedRevision
    ) {
      requestIntent.current = null;
      setExplanation("");
      setKind(null);
      failed.current = null;
    }
  }, []);
  const load = useCallback(
    async (replace = false) => {
      if (pending.current) return;
      const serial = ++request.current;
      let epoch = ticket();
      setLoading(true);
      try {
        if (!(await verify()) || serial !== request.current) return;
        epoch = ticket();
        const [snapshot, materials] = await Promise.all([
          readSnapshot(),
          api.files.list(caseId, { metadataOnly: true }).then(
            (files) => ({ files, failed: false }),
            () => ({ files: [] as FileView[], failed: true }),
          ),
        ]);
        if (!(await verify()) || !current(epoch) || serial !== request.current) return;
        if (
          !replace &&
          draft.current.trim() &&
          revision.current &&
          revision.current.revision !== snapshot.next.revision &&
          !requestIntent.current
        )
          throw new ApiError(
            "CONFLICT",
            "다른 화면에서 사건 내용이 바뀌었어요. 작성한 설명은 남겨뒀어요. 최신 정리를 확인한 뒤 다시 요청해 주세요.",
          );
        accept(snapshot);
        setFiles(materials.files);
        setMaterialsError(materials.failed);
        setError(null);
        const intent = completion.current;
        if (intent) {
          if (matches(snapshot.next, snapshot.reconciliation, intent)) finish(snapshot.next);
          else if (
            snapshot.next.stage === "active" &&
            snapshot.reconciliation.status !== "pending" &&
            snapshot.reconciliation.status !== "running"
          ) {
            completion.current = null;
            throw new ApiError(
              "CONFLICT",
              "확인 이후 사건 내용이 달라졌어요. 최신 정리를 다시 확인해 주세요.",
            );
          }
        }
        if (replace) failed.current = null;
      } catch (cause) {
        if (alive(epoch) && serial === request.current) report(cause);
      } finally {
        if (alive(epoch) && serial === request.current) setLoading(false);
      }
    },
    [ticket, verify, readSnapshot, caseId, current, accept, finish, alive, report],
  );
  useEffect(() => {
    if (version) void load();
  }, [version, load]);
  useEffect(() => {
    if (state?.status !== "pending" && state?.status !== "running") return;
    return startForegroundPolling(() => load(), 2000);
  }, [state?.status, load]);
  async function mutate(operation: Mutation): Promise<boolean> {
    if (pending.current || !canMutate) return false;
    pending.current = true;
    ++request.current;
    setBusy(true);
    setError(null);
    setNotice("");
    setLoading(false);
    const epoch = ticket();
    const owner = access.ownerId() ?? "";
    let acknowledged = false;
    try {
      if (!(await verify(false, true)) || !current(epoch)) return false;
      failed.current = operation;
      if (operation.kind === "request") {
        requestIntent.current = operation.input;
        await api.rework.requestReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else if (operation.kind === "proposal") {
        completion.current = {
          kind: "proposal",
          proposalId: operation.input.proposalId,
          summaryRevision: operation.input.summaryRevision + 1,
        };
        await api.rework.confirmReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else if (operation.kind === "cancel") {
        await api.rework.cancelReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else {
        completion.current = {
          kind: "initial",
          revision: operation.revision + (operation.alreadyConfirmed ? 0 : 1),
          summaryRevision: operation.summaryRevision,
        };
        if (!operation.alreadyConfirmed)
          await api.cases.confirmSummary(caseId, { expectedRevision: operation.revision });
      }
      acknowledged = true;
      failed.current = null;
      if (!(await verify()) || !current(epoch)) return false;
      const snapshot = await readSnapshot();
      if (!(await verify()) || !current(epoch)) return false;
      accept(snapshot);
      if (operation.kind === "request") {
        setExplanation("");
        setKind(null);
        requestIntent.current = null;
        setNotice("변경안을 요청했어요. 확인하고 확정할 때까지 기존 정리는 그대로예요.");
      } else if (operation.kind === "cancel") {
        setExplanation("");
        setKind(null);
        setNotice("변경 요청을 취소했어요. 기존 정리는 그대로예요.");
        focusTarget.current?.focus();
      } else {
        setConfirming(false);
        const intent = completion.current;
        if (!intent || !matches(snapshot.next, snapshot.reconciliation, intent)) {
          completion.current = null;
          throw new ApiError("CONFLICT", "사건 내용이 바뀌었어요. 최신 정리를 확인해 주세요.");
        }
        finish(snapshot.next);
      }
      return true;
    } catch (cause) {
      if (alive(epoch)) {
        if (acknowledged) failed.current = null;
        report(cause);
      }
      return false;
    } finally {
      if (alive(epoch)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const activeRequest =
    !!state && ["pending", "running", "proposed", "failed", "stale"].includes(state.status);
  const locked = busy || loading || !canMutate || (error as { code?: string })?.code === "CONFLICT";
  const proposal = state?.status === "proposed" ? state.proposal : null;
  const requestChange = () => {
    if (!item || !kind || !explanation.trim() || [...explanation.trim()].length > 5000) return;
    void mutate({
      kind: "request",
      input: {
        expectedRevision: item.revision,
        summaryRevision: item.summaryDetails?.revision ?? 1,
        kind,
        explanation: explanation.trim(),
      },
    });
  };
  const cancel = () =>
    state?.request && item
      ? mutate({
          kind: "cancel",
          input: { expectedRevision: item.revision, requestId: state.request.id },
        })
      : Promise.resolve(false);
  const explainAgain = async () => {
    const previous = state?.request;
    if (!previous) return;
    if (state.status === "failed" || (await cancel())) {
      setKind(previous.input.kind);
      setExplanation(previous.input.explanation);
    }
  };
  return (
    <div className={embedded ? "summary-reconfirmation--embedded" : "intake-flow"}>
      {!embedded && (
        <nav className="intake-scene-nav" aria-label="사건 정리 탐색">
          {item?.stage === "active" ? (
            <ButtonLink variant="ghost" href={returnHref}>
              <ArrowLeft size={16} aria-hidden="true" />
              작업 공간으로 돌아가기
            </ButtonLink>
          ) : (
            <BackToCases />
          )}
          <span>사건 정리 재확인</span>
        </nav>
      )}
      {loading && !item && !error && (
        <LoadingContent layout="detail" title="저장한 사건 정리를 불러오고 있어요." />
      )}
      {Boolean(error) && (
        <ErrorPanel
          error={error}
          disabled={busy}
          retry={() =>
            void (failed.current && (error as { code?: string }).code !== "CONFLICT"
              ? mutate(failed.current)
              : load(true))
          }
        />
      )}
      {item && ready && (
        <section
          className="intake-scene intake-summary-scene intake-scene-arrival"
          aria-labelledby={headingId}
          aria-busy={busy}
        >
          {!embedded && (
            <header className="intake-scene-heading">
              <span className="intake-scene-emblem" aria-hidden="true">
                <BrandMark size={48} />
              </span>
              <h1 id={headingId}>이야기를 이렇게 정리했어요</h1>
              <p>다르거나 빠진 내용을 알려주세요. 변경안을 함께 확인한 뒤 반영해요.</p>
            </header>
          )}
          {embedded && <h2 id={headingId}>사건 정리를 다시 확인해요</h2>}
          {context ? (
            <CaseContextNote context={context} />
          ) : (
            <p role="status">사건 입장 정보를 불러오지 못했어요.</p>
          )}
          {item.schemaVersion === "1" || item.stage === "archived" ? (
            <>
              <p className="summary-reading-overview">{item.summary}</p>
              <StatePanel
                variant="pending"
                title="저장한 사건을 읽을 수 있어요."
                action={<ButtonLink href={base}>사건 열기</ButtonLink>}
              />
            </>
          ) : !["summary", "active"].includes(item.stage) ? (
            <StatePanel
              variant="pending"
              title="먼저 질문을 마치고 정리를 준비해 주세요."
              action={<ButtonLink href={`${base}/intake`}>질문 이어가기</ButtonLink>}
            />
          ) : (
            <div className="summary-editor-layout">
              <aside className="summary-materials-column">
                <CaseMaterials caseId={caseId} files={files} facts={item.summaryDetails?.facts} />
                {materialsError && (
                  <p role="status">
                    자료 목록을 불러오지 못했어요.{" "}
                    <a href={`${base}/files`}>자료 화면에서 다시 확인</a>
                  </p>
                )}
              </aside>
              <div className="summary-edit-column">
                {item.summaryDetails ? (
                  <SummaryReading
                    summary={item.summaryDetails}
                    context={item.intakeQuestions}
                    base={base}
                    files={files}
                  />
                ) : (
                  <p className="summary-reading-overview">{item.summary}</p>
                )}
                {!canMutate && (
                  <p>
                    읽을 수 있는 저장본이에요. 변경·확인하려면{" "}
                    <a href={accessHref("consent")}>최신 동의 확인</a>이 필요해요.
                  </p>
                )}
                {proposal && (
                  <>
                    <SummaryChanges
                      proposal={proposal}
                      base={base}
                      context={item.intakeQuestions}
                      files={files}
                    />
                    <div className="summary-review-actions">
                      <Button
                        loading={busy}
                        disabled={locked}
                        onClick={() =>
                          void mutate({
                            kind: "proposal",
                            input: {
                              expectedRevision: item.revision,
                              proposalId: proposal.id,
                              summaryRevision: proposal.baseSummaryRevision,
                            },
                          })
                        }
                      >
                        <Check size={18} aria-hidden="true" />
                        변경안 확정하기
                      </Button>
                      <Button variant="outline" disabled={locked} onClick={() => void cancel()}>
                        변경안 취소
                      </Button>
                      <Button variant="ghost" disabled={locked} onClick={() => void explainAgain()}>
                        다시 설명하기
                      </Button>
                    </div>
                  </>
                )}
                {state && ["pending", "running"].includes(state.status) && (
                  <StatePanel
                    variant="pending"
                    title="변경안을 준비하고 있어요"
                    description="기존 정리는 그대로예요. 이 화면을 닫았다가 다시 와도 이어서 확인할 수 있어요."
                    action={
                      <Button variant="outline" disabled={locked} onClick={() => void cancel()}>
                        요청 취소
                      </Button>
                    }
                  />
                )}
                {state && ["failed", "stale"].includes(state.status) && (
                  <StatePanel
                    variant="error"
                    title={
                      state.status === "stale"
                        ? "사건 내용이 바뀌어 변경안을 다시 확인해야 해요."
                        : "변경안을 준비하지 못했어요."
                    }
                    description="기존 정리와 요청한 설명은 남아 있어요."
                    action={
                      <div className="summary-review-actions">
                        <Button disabled={locked} onClick={() => void explainAgain()}>
                          다시 설명하기
                        </Button>
                        <Button variant="outline" disabled={locked} onClick={() => void cancel()}>
                          요청 취소
                        </Button>
                      </div>
                    }
                  />
                )}
                {!activeRequest && (
                  <div className="summary-review-actions">
                    <Button
                      ref={focusTarget}
                      disabled={locked || !item.summary.trim()}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.currentTarget.focus();
                        setConfirming(true);
                      }}
                    >
                      맞아요
                      <ArrowRight size={18} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        setKind("correction");
                      }}
                    >
                      다른 부분이 있어요
                    </Button>
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        setKind("addition");
                      }}
                    >
                      빠진 내용이 있어요
                    </Button>
                  </div>
                )}
                <p className="intake-scene-notice" role="status">
                  {notice}
                </p>
                {onCancel && (
                  <Button variant="ghost" disabled={busy} onClick={onCancel}>
                    재확인 닫기
                  </Button>
                )}
                <p className="intake-scene-notice">AI가 정리한 내용이며, 법률 판단은 아니에요.</p>
              </div>
            </div>
          )}
        </section>
      )}
      <Dialog
        open={kind !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setKind(null);
            setExplanation("");
          }
        }}
        title={kind === "correction" ? "어떤 부분이 다른가요?" : "어떤 내용이 빠졌나요?"}
        description="설명은 변경 요청으로 저장돼요. AI가 사실과 출처를 검토한 변경안을 확인한 뒤 반영할 수 있어요."
      >
        <form
          className="summary-reconciliation-form"
          onSubmit={(event) => {
            event.preventDefault();
            requestChange();
          }}
        >
          <label htmlFor={fieldId}>
            {kind === "correction" ? "다른 부분을 알려주세요" : "빠진 내용을 알려주세요"}
          </label>
          <Textarea
            id={fieldId}
            value={explanation}
            disabled={busy}
            onChange={(event) => setExplanation(event.target.value)}
            aria-describedby={`${fieldId}-help`}
          />
          <p id={`${fieldId}-help`}>
            정확히 모르는 부분은 모른다고 적어주세요. 이 설명만으로 기존 사실이나 출처를 덮어쓰지
            않아요. {[...explanation.trim()].length.toLocaleString()} / 5,000자
          </p>
          {Boolean(error) && <p role="alert">저장하지 못했어요. 작성한 설명을 남겨뒀어요.</p>}
          <div className="summary-review-actions">
            <Button
              type="submit"
              loading={busy}
              disabled={locked || !explanation.trim() || [...explanation.trim()].length > 5000}
            >
              변경안 요청하기
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setKind(null);
                setExplanation("");
              }}
            >
              취소
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
        title="이 내용으로 계속할까요?"
        description="확인한 사실과 미확인 내용을 바탕으로 사건 정리를 이어가요."
      >
        <div className="summary-confirm-actions">
          <Button
            loading={busy}
            disabled={locked || !item}
            onClick={() =>
              item &&
              void mutate({
                kind: "initial",
                revision: item.revision,
                summaryRevision: item.summaryDetails?.revision ?? null,
                alreadyConfirmed: item.stage === "active" && !item.summaryNeedsConfirmation,
              })
            }
          >
            확인하고 계속
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            취소
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
