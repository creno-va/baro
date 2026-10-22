import { ArrowRight, Check, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { CaseView, FileView } from "../../client/api/types";
import { accessHref } from "../../client/return-path";
import type { V2Fact } from "../../contracts/v2";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Textarea } from "../ui/form";
import { StatePanel } from "../ui/state-panel";
import { CaseMaterials } from "../workspace/CaseMaterials";
import { BackToCases, ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";

type ConfirmationReturn = {
  caseId: string;
  workspaceRevision: number;
  summaryRevision: number | null;
  href: string;
};

function matchesConfirmation(item: CaseView, intent: ConfirmationReturn) {
  return (
    item.id === intent.caseId &&
    item.stage === "active" &&
    item.revision === intent.workspaceRevision &&
    (item.summaryDetails?.revision ?? null) === intent.summaryRevision
  );
}

export function SummaryReview({ caseId }: { caseId: string }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [activeEditor, setActiveEditor] = useState(false);
  const editingActive = activeEditor || item?.stage === "active";
  const [files, setFiles] = useState<FileView[]>([]);
  const [materialsError, setMaterialsError] = useState(false);
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const [returnHref, setReturnHref] = useState(base);
  useEffect(() => {
    // Accept a fixed workspace tab only; never navigate to an arbitrary URL.
    const tab = new URLSearchParams(window.location.search).get("from");
    setReturnHref(
      ["files", "timeline", "actions", "precedents"].includes(tab ?? "") ? `${base}/${tab}` : base,
    );
  }, [base]);
  const [summary, setSummary] = useState("");
  const [factEdits, setFactEdits] = useState<
    Record<string, Pick<V2Fact, "text" | "certainty" | "conflictingFactIds">>
  >({});
  const [unknownsDraft, setUnknownsDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const acknowledged = useRef(false);
  const confirmationReturn = useRef<ConfirmationReturn | null>(null);
  const currentCaseId = useRef(caseId);
  if (currentCaseId.current !== caseId) {
    currentCaseId.current = caseId;
    confirmationReturn.current = null;
  }
  useEffect(
    () => () => {
      confirmationReturn.current = null;
    },
    [],
  );
  const draftDirty = useRef(false);
  const pending = useRef(false);
  const request = useRef(0);
  const confirmation = useRef<HTMLInputElement>(null);
  const focusAfterSave = useRef(false);
  const savedItem = useRef(item);
  savedItem.current = item;
  const failedOperation = useRef<"save" | "confirm" | null>(null);
  const access = useCustomerAccess(
    () => {
      ++request.current;
      acknowledged.current = false;
      confirmationReturn.current = null;
      setRecovering(false);
      setItem(null);
      setActiveEditor(false);
      setFiles([]);
      setSummary("");
      setFactEdits({});
      setUnknownsDraft(null);
      setChecked(false);
      setConfirming(false);
      setBusy(false);
      setNotice("");
      setError(null);
      pending.current = false;
      focusAfterSave.current = false;
      failedOperation.current = null;
    },
    setError,
    true,
  );
  const { ticket, current, alive, verify, ready, canMutate, version, deny } = access;
  const dirty =
    !!item &&
    (summary !== item.summary ||
      Object.keys(factEdits).length > 0 ||
      (unknownsDraft !== null &&
        unknownsDraft !== (item.summaryDetails?.unknowns ?? []).join("\n")));
  const summaryTooLong = [...summary.trim()].length > 5000;
  const factTooLong = Object.values(factEdits).some((edit) => [...edit.text].length > 2000);
  draftDirty.current = dirty;
  const locked =
    busy || recovering || !canMutate || (error as { code?: string })?.code === "CONFLICT";
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
      if (replaceDraft) confirmationReturn.current = null;
      const serial = ++request.current;
      let epoch = ticket();
      setLoading(true);
      setError(null);
      try {
        if (!(await verify()) || serial !== request.current) return;
        epoch = ticket();
        const [next, materials] = await Promise.all([
          api.cases.get(caseId),
          api.files.list(caseId, { metadataOnly: true }).then(
            (files) => ({ files, failed: false }),
            () => ({ files: [] as FileView[], failed: true }),
          ),
        ]);
        // An earlier focus read must not replace a newer read or completed write.
        if (serial !== request.current) return;
        if (!(await verify()) || !current(epoch) || serial !== request.current) return;
        if (currentCaseId.current !== caseId) return;
        const intent = confirmationReturn.current;
        confirmationReturn.current = null;
        if (intent && matchesConfirmation(next, intent)) {
          acknowledged.current = false;
          setRecovering(false);
          window.location.assign(intent.href);
          return;
        }
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
        if (next.stage === "active") setActiveEditor(true);
        setFiles(materials.files);
        setMaterialsError(materials.failed);
        if (replace) {
          setFactEdits({});
          setUnknownsDraft(null);
        }
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
          if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string }).code ?? ""))
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
    // A focus refresh can finish while the acknowledged write still blocks reads.
    // Retry its read after the write settles; explicit failures keep manual retry.
    if (recovering && !busy && ready && !error) void load();
  }, [recovering, busy, ready, error, load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!item || pending.current || !summary.trim() || summaryTooLong || factTooLong) return;
    confirmationReturn.current = null;
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      if (!(await verify(false, true)) || !current(epoch)) return;
      if (!canMutate) return;
      failedOperation.current = "save";
      const wasActive = editingActive;
      let next = await api.cases.saveSummary(caseId, {
        expectedRevision: item.revision,
        summary: summary.trim(),
        ...(Object.keys(factEdits).length
          ? { factEdits: Object.entries(factEdits).map(([factId, edit]) => ({ factId, ...edit })) }
          : {}),
        ...(unknownsDraft !== null
          ? {
              unknowns: unknownsDraft
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            }
          : {}),
      });
      // The API acknowledged the write. A failed session check must recover by
      // reading, rather than submitting this revision again.
      acknowledged.current = true;
      failedOperation.current = null;
      setRecovering(true);
      if (!(await verify()) || !current(epoch)) return;
      if (wasActive) {
        // Saving an active summary invalidates its confirmation on the server.
        // The explicit Save and apply action confirms this acknowledged revision.
        setItem(next);
        setSummary(next.summary);
        setFactEdits({});
        setUnknownsDraft(null);
        setChecked(true);
        failedOperation.current = "confirm";
        next = await api.cases.confirmSummary(caseId, { expectedRevision: next.revision });
        acknowledged.current = true;
        failedOperation.current = null;
        if (!(await verify()) || !current(epoch)) return;
      }
      acknowledged.current = false;
      setRecovering(false);
      failedOperation.current = null;
      focusAfterSave.current = true;
      setItem(next);
      setSummary(next.summary);
      setFactEdits({});
      setUnknownsDraft(null);
      setChecked(false);
      setNotice("수정한 요약이 저장됐어요.");
    } catch (cause) {
      if (alive(epoch)) {
        if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string }).code ?? ""))
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
  async function confirm(explicitActiveApply = false) {
    if (!item || (!checked && !explicitActiveApply) || dirty || pending.current) return;
    confirmationReturn.current = null;
    // Confirm's CAS commits exactly one workspace revision. Keep the explicit
    // return intent separate from ordinary saves and active-summary editing.
    const intent: ConfirmationReturn = {
      caseId,
      workspaceRevision: item.revision + 1,
      summaryRevision: item.summaryDetails?.revision ?? null,
      href: returnHref,
    };
    ++request.current;
    setLoading(false);
    const epoch = ticket();
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await verify(false, true)) || !current(epoch)) return;
      failedOperation.current = "confirm";
      const next = await api.cases.confirmSummary(caseId, { expectedRevision: item.revision });
      if (!alive(epoch) || currentCaseId.current !== caseId) return;
      acknowledged.current = true;
      confirmationReturn.current = matchesConfirmation(next, intent) ? intent : null;
      failedOperation.current = null;
      setRecovering(true);
      if (!(await verify()) || !current(epoch) || currentCaseId.current !== caseId) return;
      acknowledged.current = false;
      setRecovering(false);
      failedOperation.current = null;
      if (!confirmationReturn.current) {
        setError(new ApiError("CONFLICT", "사건 내용이 바뀌었어요. 최신 내용을 확인해 주세요."));
        return;
      }
      confirmationReturn.current = null;
      setItem(next);
      window.location.assign(intent.href);
    } catch (cause) {
      if (alive(epoch)) {
        if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string }).code ?? ""))
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
    <div className={`intake-flow${editingActive ? " intake-active-summary" : ""}`}>
      <nav className="intake-scene-nav" aria-label="사건 정리 탐색">
        {editingActive ? (
          <ButtonLink variant="ghost" href={returnHref}>
            작업 공간으로 돌아가기
          </ButtonLink>
        ) : (
          <BackToCases />
        )}
        <span>{editingActive ? "사건 요약 편집" : "요약 확인"}</span>
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
            <h1 id="summary-heading">
              {editingActive ? "사건 요약을 확인해요" : "이야기를 이렇게 정리했어요"}
            </h1>
            <p>
              {editingActive
                ? "저장한 요약과 추가 자료를 확인하고 필요한 부분을 수정하세요."
                : "내용이 맞는지 확인하고, 필요한 부분만 고쳐주세요."}
            </p>
          </header>
          {item.schemaVersion === "1" || item.stage === "archived" ? (
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
          ) : item.stage !== "summary" && item.stage !== "active" ? (
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
                {!canMutate && (
                  <p>
                    저장한 요약을 읽을 수 있어요. 수정·확인하려면{" "}
                    <a href={accessHref("consent")}>최신 동의 확인</a>이 필요해요.
                  </p>
                )}
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
                    disabled={
                      !canMutate ||
                      busy ||
                      recovering ||
                      (error as { code?: string })?.code === "CONFLICT"
                    }
                    aria-describedby="summary-help"
                  />
                  <p id="summary-help" className="intake-count">
                    {[...summary].length.toLocaleString()} / 5,000자
                  </p>
                  {summaryTooLong && <p role="alert">요약은 5,000자까지 입력할 수 있어요.</p>}
                </div>
                {item.summaryDetails && (
                  <details className="summary-facts" open={editingActive || undefined}>
                    <summary>
                      사실별로 검토·수정하기 <span>{item.summaryDetails.facts.length}개 사실</span>
                    </summary>
                    <section aria-label="구조화된 사실 편집">
                      <h2>사실·모순·정보 공백 확인</h2>
                      <p id="fact-certainty-help" className="intake-muted">
                        내가 설명한 내용은 ‘사용자 진술’, 기억이나 근거를 더 확인해야 하면 ‘아직
                        확인하지 못했어요’를 선택하세요.
                      </p>
                      {item.summaryDetails.facts.map((fact) => {
                        const edit = factEdits[fact.id] ?? fact;
                        const update = (change: Partial<typeof edit>) => {
                          setFactEdits((old) => ({
                            ...old,
                            [fact.id]: {
                              text: edit.text,
                              certainty:
                                change.text !== undefined && edit.certainty === "observed"
                                  ? "uncertain"
                                  : edit.certainty,
                              conflictingFactIds: edit.conflictingFactIds,
                              ...change,
                            },
                          }));
                          setChecked(false);
                          setConfirming(false);
                        };
                        return (
                          <fieldset
                            key={fact.id}
                            disabled={locked || fact.attribution === "official_source"}
                          >
                            <legend>
                              {fact.significance === "unfavorable" ? "불리한 사실 · " : ""}
                              {fact.attribution === "official_source"
                                ? "공식 출처 사실 (직접 변경할 수 없음)"
                                : "사용자가 확인할 사실"}
                            </legend>
                            <label htmlFor={`fact-${fact.id}`}>사실 내용</label>
                            <Textarea
                              id={`fact-${fact.id}`}
                              rows={Math.min(8, Math.max(3, Math.ceil(edit.text.length / 40)))}
                              value={edit.text}
                              onChange={(e) => update({ text: e.target.value })}
                            />
                            {[...edit.text].length > 2000 && (
                              <p role="alert">사실 내용은 2,000자까지 입력할 수 있어요.</p>
                            )}
                            <label>
                              확인 상태
                              <select
                                aria-label="확인 상태"
                                aria-describedby="fact-certainty-help"
                                value={edit.certainty}
                                onChange={(e) => {
                                  const certainty = e.target.value as V2Fact["certainty"];
                                  update({
                                    certainty,
                                    conflictingFactIds:
                                      certainty === "conflicting" ? edit.conflictingFactIds : [],
                                  });
                                }}
                              >
                                {fact.attribution === "user_statement" && (
                                  <option value="reported">사용자 진술</option>
                                )}
                                {edit.certainty === "observed" && (
                                  <option value="observed">자료에서 관찰됨</option>
                                )}
                                <option value="uncertain">아직 확인하지 못했어요</option>
                                <option value="conflicting">다른 사실과 모순</option>
                              </select>
                            </label>
                            {edit.certainty === "conflicting" && (
                              <fieldset className="summary-conflicts">
                                <legend>
                                  모순되는 사실 선택 · {edit.conflictingFactIds.length}개 선택
                                </legend>
                                {item.summaryDetails?.facts
                                  .filter((v) => v.id !== fact.id)
                                  .map((v) => (
                                    <label
                                      key={v.id}
                                      data-selected={edit.conflictingFactIds.includes(v.id)}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={edit.conflictingFactIds.includes(v.id)}
                                        onChange={(event) =>
                                          update({
                                            conflictingFactIds: event.target.checked
                                              ? [...edit.conflictingFactIds, v.id]
                                              : edit.conflictingFactIds.filter((id) => id !== v.id),
                                          })
                                        }
                                      />
                                      <span>{v.text}</span>
                                    </label>
                                  ))}
                              </fieldset>
                            )}
                          </fieldset>
                        );
                      })}
                      <label htmlFor="summary-unknowns">확인할 정보 공백 (한 줄에 하나)</label>
                      <Textarea
                        id="summary-unknowns"
                        value={unknownsDraft ?? item.summaryDetails.unknowns.join("\n")}
                        disabled={locked}
                        onChange={(e) => {
                          setUnknownsDraft(e.target.value);
                          setChecked(false);
                          setConfirming(false);
                        }}
                      />
                    </section>
                  </details>
                )}
                {dirty ? (
                  <div className="intake-scene-tools">
                    <Button
                      variant="outline"
                      onClick={() => void save()}
                      disabled={
                        !canMutate ||
                        busy ||
                        recovering ||
                        !summary.trim() ||
                        summaryTooLong ||
                        factTooLong ||
                        (error as { code?: string })?.code === "CONFLICT"
                      }
                    >
                      <Save size={16} aria-hidden="true" />
                      {busy
                        ? "저장 중…"
                        : editingActive
                          ? "수정 내용 저장하고 적용"
                          : "수정 내용 저장"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSummary(item.summary);
                        setFactEdits({});
                        setUnknownsDraft(null);
                        setChecked(false);
                        setConfirming(false);
                        setNotice("");
                      }}
                      disabled={locked}
                    >
                      수정 취소
                    </Button>
                  </div>
                ) : null}
                <p className="intake-scene-notice" role="status">
                  {dirty
                    ? busy
                      ? "수정한 요약을 저장하고 있어요."
                      : "수정 내용을 저장하면 계속할 수 있어요."
                    : notice}
                </p>
                {editingActive ? (
                  <div className="intake-actions">
                    {item.stage === "summary" && (
                      <Button disabled={locked || dirty} onClick={() => void confirm(true)}>
                        저장한 수정 내용 적용
                      </Button>
                    )}
                    <ButtonLink href={returnHref} variant="outline">
                      {dirty ? "저장하지 않고 돌아가기" : "작업 공간으로 돌아가기"}
                    </ButtonLink>
                  </div>
                ) : (
                  <>
                    <label className="intake-confirm-check">
                      <input
                        ref={confirmation}
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setChecked(event.target.checked);
                          setConfirming(false);
                        }}
                        disabled={locked || dirty}
                      />
                      <span>요약이 내가 이야기한 사실과 맞는지 확인했어요.</span>
                    </label>
                    <Button
                      className="intake-scene-primary"
                      onClick={() => setConfirming(true)}
                      disabled={
                        !canMutate ||
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
                        <Button onClick={() => void confirm()} disabled={locked}>
                          <Check size={18} aria-hidden="true" />
                          {busy ? "확인 중…" : "확인하고 사건 열기"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirming(false)}
                          disabled={locked}
                        >
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
                  </>
                )}
                <p className="intake-scene-notice">AI가 정리한 내용이며, 법률 판단은 아니에요.</p>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
