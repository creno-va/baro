import { type MouseEvent, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { confirmAction } from "../../client/confirm";
import type { V2CaseContext, V2CaseContextUpdate, V2CaseContextView } from "../../contracts/v2";

type Draft = {
  purpose: V2CaseContext["casePurpose"];
  kind: V2CaseContext["procedure"]["kind"];
  stage: V2CaseContext["procedure"]["stage"];
  description: string;
};
const draftOf = (context: V2CaseContext): Draft => ({
  purpose: context.casePurpose,
  kind: context.procedure.kind,
  stage: context.procedure.stage,
  description: context.procedure.description ?? "",
});
function problem(cause: unknown) {
  const code = (cause as { code?: string })?.code;
  if (code === "VALIDATION_ERROR" || (cause as { name?: string })?.name === "ZodError")
    return "선택한 값과 진행 상황을 확인해 주세요. 설명은 500자까지 저장할 수 있어요.";
  if (["CONFLICT", "STALE_REVISION", "IDEMPOTENCY_CONFLICT"].includes(code ?? ""))
    return "다른 곳에서 사건이 바뀌었어요. 선택한 값은 보존했어요. 최신 기준과 비교한 뒤 다시 저장해 주세요.";
  if (code === "CONSENT_REQUIRED")
    return "변경을 저장하려면 현재 정책 동의가 필요해요. 저장된 내용은 확인할 수 있어요.";
  if (code === "UNAUTHENTICATED" || code === "NOT_FOUND")
    return "사건이나 이용 계정이 바뀌었어요. 현재 계정으로 다시 확인해 주세요.";
  return "저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.";
}

/** Explicit user context, separate from the summary and automatic legal inference. */
export function useContextReviewController({
  caseId,
  context,
  disabled,
  readDisabled,
  access,
  onChanged,
  onSaved,
  onDirtyChange,
  onBusyChange,
}: {
  caseId: string;
  context: V2CaseContext;
  disabled: boolean;
  readDisabled: boolean;
  access: {
    ticket: () => number;
    current: (epoch: number) => boolean;
    verify: (hide?: boolean, write?: boolean) => Promise<boolean>;
  };
  onChanged: () => Promise<unknown>;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [base, setBase] = useState<V2CaseContextView | null>(null),
    [draft, setDraft] = useState<Draft>(draftOf(context));
  const [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [needsReload, setNeedsReload] = useState(false);
  const mounted = useRef(false),
    lock = useRef(false),
    serial = useRef(0),
    epoch = useRef(access.ticket());
  const controller = useRef(new AbortController()),
    owner = useRef<string | null>(null);
  const opened = useRef(false);
  const attempt = useRef<V2CaseContextUpdate | null>(null),
    acknowledged = useRef<V2CaseContextView | null>(null);
  const callbacks = useRef({ onChanged, onSaved, onDirtyChange, onBusyChange });
  callbacks.current = { onChanged, onSaved, onDirtyChange, onBusyChange };
  const changed =
    !!base &&
    JSON.stringify({ ...draft, description: draft.description.trim() }) !==
      JSON.stringify(draftOf(base.context));
  useEffect(() => {
    callbacks.current.onDirtyChange(open && (changed || !!attempt.current));
  }, [open, changed]);
  useEffect(() => {
    callbacks.current.onBusyChange(busy);
  }, [busy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      opened.current = false;
      serial.current++;
      controller.current.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, []);
  const live = () =>
    mounted.current && access.current(epoch.current) && !controller.current.signal.aborted;
  async function authorize(write: boolean) {
    if (!(await access.verify(false, write)) || !live()) return null;
    const session = await api.session.get();
    if (!live() || !session.user || (owner.current && owner.current !== session.user.id))
      return null;
    owner.current = session.user.id;
    return session.user.id;
  }
  async function read(keepDraft: boolean) {
    const request = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const expectedOwner = await authorize(false);
      if (!expectedOwner) return;
      const value = await api.rework.getContext(caseId, {
        expectedOwner,
        signal: controller.current.signal,
      });
      if (!(await authorize(false)) || !live() || request !== serial.current) return;
      setBase(value);
      if (!keepDraft) setDraft(draftOf(value.context));
      setStale(keepDraft);
      setReviewed(false);
      setNeedsReload(false);
      attempt.current = null;
      acknowledged.current = null;
    } catch (cause) {
      if (live() && request === serial.current) setError(problem(cause));
    } finally {
      if (live() && request === serial.current) setLoading(false);
    }
  }
  async function show() {
    if (readDisabled || lock.current || opened.current) return;
    opened.current = true;
    controller.current.abort();
    controller.current = new AbortController();
    epoch.current = access.ticket();
    owner.current = null;
    setOpen(true);
    setBase(null);
    setDraft(draftOf(context));
    setStale(false);
    setReviewed(false);
    setNeedsReload(false);
    await read(false);
  }
  async function close() {
    const confirmEpoch = epoch.current;
    if (!mounted.current || !opened.current) return;
    if (lock.current) return;
    if (!access.current(epoch.current)) {
      opened.current = false;
      controller.current.abort();
      setOpen(false);
      return;
    }
    if (
      (changed || attempt.current) &&
      !(await confirmAction("저장하지 않은 선택이 있어요. 변경을 버리고 닫을까요?"))
    )
      return;
    if (!mounted.current || !access.current(confirmEpoch) || lock.current) return;
    opened.current = false;
    controller.current.abort();
    serial.current++;
    attempt.current = null;
    acknowledged.current = null;
    setOpen(false);
    setError("");
    setLoading(false);
    void callbacks.current.onChanged();
  }
  async function save() {
    if (
      !base ||
      !live() ||
      disabled ||
      lock.current ||
      loading ||
      needsReload ||
      draft.purpose === "unconfirmed" ||
      (stale && !reviewed)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const expectedOwner = await authorize(true);
      if (!expectedOwner) return;
      attempt.current ??= {
        expectedRevision: base.workspaceRevision,
        casePurpose: draft.purpose,
        subjectContext: base.context.subjectContext,
        procedure: {
          kind: draft.kind,
          stage: draft.stage,
          description: draft.description.trim() || null,
        },
      };
      acknowledged.current ??= await api.rework.updateContext(caseId, attempt.current, {
        expectedOwner,
        signal: controller.current.signal,
      });
      if (!(await authorize(false)) || !live()) return;
      const current = await api.rework.getContext(caseId, {
        expectedOwner,
        signal: controller.current.signal,
      });
      if (!(await authorize(false)) || !live()) return;
      if (
        current.workspaceRevision < acknowledged.current.workspaceRevision ||
        JSON.stringify(current.context) !== JSON.stringify(acknowledged.current.context)
      )
        throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
      attempt.current = null;
      acknowledged.current = null;
      setBase(current);
      setDraft(draftOf(current.context));
      opened.current = false;
      setOpen(false);
      callbacks.current.onDirtyChange(false);
      await callbacks.current.onSaved();
    } catch (cause) {
      if (!live()) return;
      if (
        (cause as { code?: string })?.code === "VALIDATION_ERROR" ||
        (cause as { name?: string })?.name === "ZodError"
      ) {
        attempt.current = null;
        acknowledged.current = null;
      }
      if (
        ["CONFLICT", "STALE_REVISION", "IDEMPOTENCY_CONFLICT"].includes(
          (cause as { code?: string })?.code ?? "",
        )
      ) {
        attempt.current = null;
        acknowledged.current = null;
        setStale(true);
        setReviewed(false);
        setNeedsReload(true);
      }
      setError(problem(cause));
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  }
  const frozen = disabled || loading || busy || !!attempt.current;
  function edit(value: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...value }));
    setReviewed(false);
  }
  return {
    open,
    loading,
    busy,
    base,
    draft,
    error,
    stale,
    reviewed,
    needsReload,
    changed,
    frozen,
    readDisabled,
    pendingAttempt: Boolean(attempt.current),
    saveDisabled:
      disabled ||
      loading ||
      busy ||
      !base ||
      needsReload ||
      (!changed && !attempt.current) ||
      draft.purpose === "unconfirmed" ||
      (stale && !reviewed),
    openFrom: (event: MouseEvent<HTMLButtonElement>) => {
      event.currentTarget.focus();
      void show();
    },
    close: () => void close(),
    save: () => void save(),
    reloadBase: () => void read(true),
    retryRead: () => void read(false),
    setPurpose: (purpose: string) => edit({ purpose: purpose as Draft["purpose"] }),
    setKind: (kind: string) => edit({ kind: kind as Draft["kind"] }),
    setStage: (stage: string) => edit({ stage: stage as Draft["stage"] }),
    setDescription: (description: string) => edit({ description }),
    setReviewed,
  };
}

export type ContextReviewController = ReturnType<typeof useContextReviewController>;
export type ConversationContextReviewProps = Parameters<typeof useContextReviewController>[0];
