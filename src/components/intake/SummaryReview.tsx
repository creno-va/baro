import { ArrowRight, Check, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { CaseView } from "../../client/api/types";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";

export function SummaryReview({ caseId }: { caseId: string }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const acknowledged = useRef(false);
  const draftDirty = useRef(false);
  const pending = useRef(false);
  const request = useRef(0);
  const confirmation = useRef<HTMLInputElement>(null);
  const focusAfterSave = useRef(false);
  const savedItem = useRef(item);
  savedItem.current = item;
  const failedOperation = useRef<"save" | "confirm" | null>(null);
  const access = useCustomerAccess(() => {
    ++request.current;
    acknowledged.current = false;
    setRecovering(false);
    setItem(null);
    setSummary("");
    setChecked(false);
    setConfirming(false);
    setBusy(false);
    setNotice("");
    setError(null);
    pending.current = false;
    focusAfterSave.current = false;
    failedOperation.current = null;
  }, setError);
  const { ticket, current, alive, verify, ready, version, deny } = access;
  const dirty = !!item && summary !== item.summary;
  draftDirty.current = dirty;
  useEffect(() => {
    if (focusAfterSave.current && ready && !busy && !dirty) {
      focusAfterSave.current = false;
      confirmation.current?.focus();
    }
  }, [ready, busy, dirty]);
  const load = useCallback(
    async (replaceDraft = false) => {
      // A background refresh must not advance the revision of a lost-response
      // retry. Explicit conflict recovery may replace that original request.
      if (pending.current || (failedOperation.current && !replaceDraft)) return;
      const serial = ++request.current;
      let epoch = ticket();
      setLoading(true);
      setError(null);
      try {
        if (!(await verify()) || serial !== request.current) return;
        epoch = ticket();
        const next = await api.cases.get(caseId);
        // An earlier focus read must not replace a newer read or completed write.
        if (serial !== request.current) return;
        if (!(await verify()) || !current(epoch) || serial !== request.current) return;
        if (
          !replaceDraft &&
          !acknowledged.current &&
          draftDirty.current &&
          savedItem.current?.revision !== next.revision
        )
          throw new ApiError(
            "CONFLICT",
            "다른 화면에서 요약이 바뀌었어요. 최신 내용을 확인해 주세요.",
          );
        failedOperation.current = null;
        const replace = replaceDraft || acknowledged.current;
        acknowledged.current = false;
        setRecovering(false);
        const changed = savedItem.current?.revision !== next.revision;
        setItem(next);
        setSummary((draft) =>
          !replace && savedItem.current && draft !== savedItem.current.summary
            ? draft
            : next.summary,
        );
        if (changed) {
          setChecked(false);
          setConfirming(false);
        }
      } catch (cause) {
        if (alive(epoch) && serial === request.current) {
          if (
            ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
              (cause as { code?: string }).code ?? "",
            )
          )
            deny();
          setError(cause);
        }
      } finally {
        if (alive(epoch) && serial === request.current) setLoading(false);
      }
    },
    [caseId, ticket, current, alive, verify, deny],
  );
  useEffect(() => {
    if (version) void load();
  }, [load, version]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!item || pending.current || !summary.trim()) return;
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      if (!(await verify()) || !current(epoch)) return;
      failedOperation.current = "save";
      const next = await api.cases.saveSummary(caseId, {
        expectedRevision: item.revision,
        summary: summary.trim(),
      });
      // The API acknowledged the write. A failed session check must recover by
      // reading, rather than submitting this revision again.
      acknowledged.current = true;
      failedOperation.current = null;
      setRecovering(true);
      if (!(await verify()) || !current(epoch)) return;
      acknowledged.current = false;
      setRecovering(false);
      failedOperation.current = null;
      focusAfterSave.current = true;
      setItem(next);
      setSummary(next.summary);
      setChecked(false);
      setNotice("수정한 요약이 저장됐어요.");
    } catch (cause) {
      if (alive(epoch)) {
        if (
          ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
            (cause as { code?: string }).code ?? "",
          )
        )
          deny();
        setError(cause);
      }
    } finally {
      if (alive(epoch)) {
        setBusy(false);
        pending.current = false;
      }
    }
  }
  async function confirm() {
    if (!item || !checked || dirty || pending.current) return;
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await verify()) || !current(epoch)) return;
      failedOperation.current = "confirm";
      const next = await api.cases.confirmSummary(caseId, { expectedRevision: item.revision });
      acknowledged.current = true;
      failedOperation.current = null;
      setRecovering(true);
      if (!(await verify()) || !current(epoch)) return;
      acknowledged.current = false;
      setRecovering(false);
      failedOperation.current = null;
      setItem(next);
      window.location.assign(`/cases/${encodeURIComponent(caseId)}`);
    } catch (cause) {
      if (alive(epoch)) {
        if (
          ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
            (cause as { code?: string }).code ?? "",
          )
        )
          deny();
        setError(cause);
      }
      if (alive(epoch)) setConfirming(false);
    } finally {
      if (alive(epoch)) {
        setBusy(false);
        pending.current = false;
      }
    }
  }
  return (
    <div className="intake-flow">
      <nav className="intake-scene-nav" aria-label="사건 정리 탐색">
        <BackToCases />
        <span>요약 확인</span>
      </nav>
      {loading && !item && !error ? (
        <StatePanel variant="loading" title="저장한 요약을 불러오고 있어요." />
      ) : null}
      {error ? (
        <ErrorPanel
          error={error}
          retry={() =>
            void ((error as { code?: string }).code === "CONFLICT"
              ? load(true)
              : failedOperation.current === "save"
                ? save()
                : failedOperation.current === "confirm"
                  ? confirm()
                  : load())
          }
          disabled={busy}
        />
      ) : null}
      {item && ready ? (
        <section
          className="intake-scene intake-summary-scene intake-scene-arrival"
          aria-busy={busy}
          aria-labelledby="summary-heading"
        >
          <header className="intake-scene-heading">
            <span className="intake-scene-emblem" aria-hidden="true">
              <BrandMark size={48} />
            </span>
            <h1 id="summary-heading">이야기를 이렇게 정리했어요</h1>
            <p>내용이 맞는지 확인하고, 필요한 부분만 고쳐주세요.</p>
          </header>
          {item.schemaVersion === "1" || item.stage === "active" || item.stage === "archived" ? (
            <StatePanel
              variant="pending"
              title="저장한 사건을 이어서 확인할 수 있어요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}`}>
                  사건 열기
                  <ArrowRight size={16} aria-hidden="true" />
                </ButtonLink>
              }
            />
          ) : item.stage !== "summary" ? (
            <StatePanel
              variant="pending"
              title="먼저 질문을 마치고 요약을 준비해 주세요."
              action={
                <ButtonLink href={`/cases/${encodeURIComponent(caseId)}/intake`}>
                  질문 이어가기
                </ButtonLink>
              }
            />
          ) : (
            <>
              <div className="intake-scene-composer">
                <label htmlFor="case-summary" className="sr-only">
                  요약 편집
                </label>
                <Textarea
                  id="case-summary"
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value);
                    setChecked(false);
                    setConfirming(false);
                    setNotice("");
                  }}
                  maxLength={5000}
                  disabled={busy || recovering || (error as { code?: string })?.code === "CONFLICT"}
                  aria-describedby="summary-help"
                />
                <p id="summary-help" className="intake-count">
                  {[...summary].length.toLocaleString()} / 5,000자
                </p>
              </div>
              {dirty ? (
                <div className="intake-scene-tools">
                  <Button
                    variant="outline"
                    onClick={() => void save()}
                    disabled={
                      busy ||
                      recovering ||
                      !summary.trim() ||
                      (error as { code?: string })?.code === "CONFLICT"
                    }
                  >
                    <Save size={16} aria-hidden="true" />
                    {busy && failedOperation.current === "save" ? "저장 중…" : "수정 내용 저장"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSummary(item.summary);
                      setChecked(false);
                      setConfirming(false);
                      setNotice("");
                    }}
                    disabled={busy}
                  >
                    수정 취소
                  </Button>
                </div>
              ) : null}
              <p className="intake-scene-notice" role="status">
                {dirty ? "수정 내용을 저장하면 계속할 수 있어요." : notice}
              </p>
              <label className="intake-confirm-check">
                <input
                  ref={confirmation}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setChecked(event.target.checked);
                    setConfirming(false);
                  }}
                  disabled={busy || dirty}
                />
                <span>요약이 내가 이야기한 사실과 맞는지 확인했어요.</span>
              </label>
              <Button
                className="intake-scene-primary"
                onClick={() => setConfirming(true)}
                disabled={
                  busy ||
                  recovering ||
                  dirty ||
                  !checked ||
                  !summary.trim() ||
                  (error as { code?: string })?.code === "CONFLICT"
                }
              >
                요약 확인하고 계속
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
              <Dialog
                open={confirming}
                onOpenChange={setConfirming}
                title="이제 사건 정리를 시작할까요?"
              >
                <div className="intake-actions">
                  <Button onClick={() => void confirm()} disabled={busy}>
                    <Check size={18} aria-hidden="true" />
                    {busy ? "확인 중…" : "확인하고 사건 열기"}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                    취소
                  </Button>
                </div>
              </Dialog>
              <div className="intake-scene-tools">
                <ButtonLink
                  variant="ghost"
                  href={`/cases/${encodeURIComponent(caseId)}/intake?question=0&edit=1`}
                >
                  이전 답변 수정하기
                </ButtonLink>
              </div>
              <p className="intake-scene-notice">AI가 정리한 내용이며, 법률 판단은 아니에요.</p>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
