import { ArrowRight, Check, Pencil, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { CaseView } from "../../client/api/types";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { BackToCases, ErrorPanel, IntakeProgress } from "./common";

export function SummaryReview({ caseId }: { caseId: string }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = useRef(false);
  const dirty = !!item && summary !== item.summary;
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.cases.get(caseId);
      setItem(next);
      setSummary(next.summary);
      setChecked(false);
      setConfirming(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!item || pending.current || !summary.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const next = await api.cases.saveSummary(caseId, {
        expectedRevision: item.revision,
        summary: summary.trim(),
      });
      setItem(next);
      setSummary(next.summary);
      setChecked(false);
      setNotice("수정한 요약이 저장됐어요.");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  async function confirm() {
    if (!item || !checked || dirty || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await api.cases.confirmSummary(caseId, { expectedRevision: item.revision });
      setItem(next);
      window.location.assign(`/cases/${encodeURIComponent(caseId)}`);
    } catch (cause) {
      setError(cause);
      setConfirming(false);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return (
    <div className="intake-flow">
      <BackToCases />
      <IntakeProgress step={2} />
      {loading && !item ? (
        <StatePanel variant="loading" title="저장한 요약을 불러오고 있어요." />
      ) : null}
      {error ? <ErrorPanel error={error} retry={() => void load()} disabled={busy} /> : null}
      {item ? (
        <section className="intake-card" aria-busy={busy}>
          <div className="intake-assistant-heading">
            <BrandMark size={32} />
            <p className="intake-eyebrow">지금까지 나눈 이야기</p>
          </div>
          <h1>이렇게 정리해 봤어요.</h1>
          <p className="intake-muted">
            틀리거나 빠진 내용, 불리한 사실도 수정해 주세요. 이 요약은 사실 정리이며 법률 판단이
            아니에요.
          </p>
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
              <label htmlFor="case-summary" className="ui-label">
                <Pencil size={16} aria-hidden="true" />
                요약 편집
              </label>
              <Textarea
                id="case-summary"
                value={summary}
                onChange={(event) => {
                  setSummary(event.target.value);
                  setChecked(false);
                  setConfirming(false);
                }}
                maxLength={5000}
                disabled={busy}
                aria-describedby="summary-help"
              />
              <p id="summary-help" className="intake-count">
                {[...summary].length.toLocaleString()} / 5,000자 ·{" "}
                {dirty ? "아직 저장하지 않은 수정이 있어요" : "저장한 요약"}
              </p>
              <div className="intake-actions">
                <Button
                  variant="outline"
                  onClick={() => void save()}
                  disabled={busy || !dirty || !summary.trim()}
                >
                  <Save size={16} aria-hidden="true" />
                  수정 내용 저장
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSummary(item.summary);
                    setChecked(false);
                    setConfirming(false);
                  }}
                  disabled={busy || !dirty}
                >
                  수정 취소
                </Button>
                <ButtonLink
                  variant="ghost"
                  href={`/cases/${encodeURIComponent(caseId)}/intake?question=0&edit=1`}
                >
                  질문으로 돌아가기
                </ButtonLink>
              </div>
              <p className="intake-save-notice" role="status">
                {notice}
              </p>
              <label className="intake-confirm-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setChecked(event.target.checked);
                    setConfirming(false);
                  }}
                  disabled={busy || dirty}
                />
                <span>저장한 요약을 읽고, 내가 제공한 사실과 맞는지 확인했어요.</span>
              </label>
              {confirming ? (
                <div
                  className="intake-exit"
                  role="dialog"
                  aria-modal="false"
                  aria-labelledby="confirm-title"
                >
                  <h2 id="confirm-title">이 요약으로 사건 정리를 이어갈까요?</h2>
                  <p>이제 BARO와 대화하며 자료, 사건의 흐름, 다음 할 일을 함께 정리할 수 있어요.</p>
                  <div className="intake-actions">
                    <Button onClick={() => void confirm()} disabled={busy}>
                      <Check size={18} aria-hidden="true" />
                      {busy ? "확인 중…" : "확인하고 사건 열기"}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={busy || dirty || !checked || !summary.trim()}
                >
                  요약 확인하고 계속
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
