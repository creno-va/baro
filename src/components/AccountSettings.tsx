import { AlertTriangle, HelpCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client/api";
import type { CaseView } from "../client/api/types";
import { accountDeleted } from "../server/modules/analytics/browser";
import { ConfirmDialog } from "./reports/ConfirmDialog";

const markerKey = "baro.account-reauth.v1";
const superseded = () =>
  Object.assign(new Error("설정 확인 요청이 변경됐어요."), { code: "SETTINGS_READ_SUPERSEDED" });
const isSuperseded = (error: unknown) =>
  (error as { code?: string })?.code === "SETTINGS_READ_SUPERSEDED";
type Access = Awaited<ReturnType<typeof api.account.deletionAccess>>;
export function AccountSettings() {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.account.usage>> | null>(null);
  const [cases, setCases] = useState<CaseView[]>([]);
  const [access, setAccess] = useState<Access | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<CaseView | "account" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(false);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const owner = useRef<string | null>(null);
  const [checking, setChecking] = useState(true);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    lock.current = false;
    owner.current = null;
    setUsage(null);
    setCases([]);
    setAccess(null);
    setReady(false);
    setTarget(null);
    setConfirmation("");
    setNotice("");
    setBusy("");
    setChecking(false);
    sessionStorage.removeItem(markerKey);
  }, []);
  const verifyOwner = useCallback(async () => {
    const sequence = loadSequence.current;
    try {
      const value = await api.account.deletionAccess();
      if (sequence !== loadSequence.current) throw superseded();
      if (owner.current && owner.current !== value.ownerTag) {
        throw new Error("계정이 변경됐어요. 설정을 다시 불러와 삭제할 계정을 확인해 주세요.");
      }
      owner.current = value.ownerTag;
      setAccess(value);
      setReady(value.canDelete);
      return value;
    } catch (error) {
      if (isSuperseded(error) || sequence !== loadSequence.current) throw superseded();
      clearOwnerState();
      throw error;
    }
  }, [clearOwnerState]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setChecking(true);
    setBusy("설정 확인 중…");
    setError("");
    try {
      await verifyOwner();
      const results = await Promise.allSettled([
        api.account.usage(),
        api.cases.list(),
        api.account.deletionAccess(),
      ]);
      if (sequence !== loadSequence.current) return;
      await verifyOwner();
      if (sequence !== loadSequence.current) return;
      const problems: string[] = [];
      if (results[0].status === "fulfilled") setUsage(results[0].value);
      else {
        setUsage(null);
        problems.push("사용량을 확인하지 못했어요.");
      }
      if (results[1].status === "fulfilled") setCases(results[1].value);
      else {
        setCases([]);
        problems.push("사건 목록을 확인하지 못했어요.");
      }
      if (results[2].status === "fulfilled") {
        const value = results[2].value;
        if (value.ownerTag !== owner.current) {
          clearOwnerState();
          throw new Error("계정이 변경됐어요. 설정을 다시 불러와 주세요.");
        }
        setAccess(value);
        const raw = sessionStorage.getItem(markerKey);
        let marker: { ownerTag?: string; startedAt?: number } | null = null;
        try {
          marker = raw ? JSON.parse(raw) : null;
        } catch {
          sessionStorage.removeItem(markerKey);
        }
        const confirmed = value.canDelete;
        setReady(Boolean(confirmed));
        if (marker && marker.ownerTag !== value.ownerTag) {
          sessionStorage.removeItem(markerKey);
          problems.push("다른 계정으로 인증했어요. 삭제할 계정으로 다시 로그인해 주세요.");
        }
      } else {
        setAccess(null);
        setReady(false);
        problems.push("계정 상태를 확인하지 못했어요. 다시 로그인하거나 재시도해 주세요.");
      }
      setError(problems.join(" "));
    } catch (error) {
      if (isSuperseded(error)) return;
      clearOwnerState();
      setError(
        `계정 상태를 확인하지 못했어요. ${error instanceof Error ? error.message : "다시 로그인하거나 재시도해 주세요."}`,
      );
    } finally {
      if (sequence === loadSequence.current) {
        setBusy("");
        setChecking(false);
      }
    }
  }, [verifyOwner, clearOwnerState]);
  useEffect(() => {
    void load();
    const check = () => {
      if (document.visibilityState === "hidden" || lock.current) return;
      const sequence = loadSequence.current;
      setChecking(true);
      void verifyOwner()
        .catch((error: unknown) => {
          if (!isSuperseded(error))
            setError(
              error instanceof Error ? error.message : "계정 접근 상태를 다시 확인해 주세요.",
            );
        })
        .finally(() => {
          if (sequence === loadSequence.current) setChecking(false);
        });
    };
    const leaving = () => {
      ++loadSequence.current;
    };
    const returned = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      lock.current = false;
      setTarget(null);
      setConfirmation("");
      void load();
    };
    window.addEventListener("pageshow", returned);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      ++loadSequence.current;
      window.removeEventListener("pageshow", returned);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, verifyOwner]);
  async function reauthenticate(provider: Access["providers"][number]) {
    if (lock.current || checking || !access) return;
    lock.current = true;
    let sequence = loadSequence.current;
    setBusy("재인증 시작 중…");
    setError("");
    setReady(false);
    try {
      await verifyOwner();
      // Earlier load/focus reads cannot consume the new reauthentication marker.
      sequence = ++loadSequence.current;
      sessionStorage.setItem(
        markerKey,
        JSON.stringify({ ownerTag: access.ownerTag, startedAt: Date.now() }),
      );
      await api.account.reauthenticate(provider);
    } catch (e) {
      if (sequence !== loadSequence.current || isSuperseded(e)) return;
      sessionStorage.removeItem(markerKey);
      setError(e instanceof Error ? e.message : "재인증을 시작하지 못했어요.");
    } finally {
      if (sequence === loadSequence.current) {
        lock.current = false;
        setBusy("");
      }
    }
  }
  async function remove() {
    if (
      lock.current ||
      checking ||
      !target ||
      confirmation !== "DELETE" ||
      (target === "account" && !ready)
    )
      return;
    lock.current = true;
    setBusy("삭제 요청 중…");
    setError("");
    setNotice("");
    try {
      const verified = await verifyOwner();
      if (target === "account" && !verified.canDelete)
        throw Object.assign(new Error("삭제 전 같은 계정으로 다시 인증해 주세요."), {
          code: "REAUTHENTICATION_REQUIRED",
        });
      const sequence = loadSequence.current;
      if (target === "account") {
        await api.account.deleteAccount(confirmation);
        sessionStorage.removeItem(markerKey);
        setDeleted(true);
        setTarget(null);
        await accountDeleted().catch(() => false);
      } else {
        await api.account.deleteCase(target.id, confirmation, target.schemaVersion ?? "2");
        await verifyOwner();
        if (sequence !== loadSequence.current) return;
        setCases(cases.filter((item) => item.id !== target.id));
        setTarget(null);
        setNotice(
          "사건 삭제를 접수하고 접근을 차단했어요. 원격 자료 정리는 별도 절차에 따라 진행돼요.",
        );
        try {
          const refreshed = await api.account.usage();
          await verifyOwner();
          if (sequence === loadSequence.current) setUsage(refreshed);
        } catch {
          setUsage(null);
          setError("삭제는 접수했지만 사용량을 다시 확인하지 못했어요. ‘다시 확인’을 눌러 주세요.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제를 확인하지 못했어요. 다시 확인해 주세요.");
      if (
        [
          "UNAUTHENTICATED",
          "REAUTHENTICATION_REQUIRED",
          "CONSENT_REQUIRED",
          "NOT_FOUND",
          "FORBIDDEN",
        ].includes((e as { code?: string })?.code ?? "")
      ) {
        setReady(false);
        setConfirmation("");
        setTarget(null);
        sessionStorage.removeItem(markerKey);
      }
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const open = (value: CaseView | "account") => {
    setTarget(value);
    setConfirmation("");
    setError("");
  };
  if (deleted)
    return (
      <section className="settings-card" role="status">
        <h1>계정 삭제를 접수했어요</h1>
        <p>
          로그인 세션을 종료하고 접근을 차단했어요. 원격 파일·백업 정리는 삭제 절차에 따라 진행돼요.
        </p>
        <a href="/login">로그인 화면으로</a>
        <a href="/help#deletion">삭제 도움말</a>
      </section>
    );
  return (
    <div className="account-settings" aria-busy={Boolean(busy) || checking}>
      <header className="settings-heading">
        <div>
          <span className="settings-eyebrow">내 계정</span>
          <h1>설정과 사용량</h1>
          <p>이용 한도를 확인하고 보관한 사건을 관리하세요.</p>
        </div>
        <button type="button" disabled={Boolean(busy) || checking} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" size={16} /> 다시 확인
        </button>
      </header>
      {(busy || checking) && (
        <p role="status" className="settings-progress">
          {busy || "계정 접근 상태 확인 중…"}
        </p>
      )}
      {error && !target && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="settings-success">
          {notice}
        </p>
      )}
      <section className="settings-card">
        <h2>사용량과 한도</h2>
        <p>
          하루 한도는 한국 시간 자정에 다시 이용할 수 있어요. 저장 공간은 자료를 삭제해 확보할 수
          있어요.
        </p>
        {usage && !checking && (
          <div className="usage-grid">
            {(
              [
                ["오늘 새 사건", usage.newCases, "건"],
                ["오늘 AI 응답", usage.aiResponses, "회"],
                ["오늘 음성·영상", usage.mediaMinutes, "분"],
                [
                  "계정 저장 공간",
                  { used: usage.storageBytes.used / 1e9, limit: usage.storageBytes.limit / 1e9 },
                  "GB",
                ],
              ] as const
            ).map(([label, count, unit]) => (
              <div className="usage-item" key={label}>
                <strong>{label}</strong>
                <p>
                  <b>{Number(count.used.toFixed(2))}</b> / {count.limit} {unit}
                </p>
                <progress
                  aria-label={label}
                  value={Math.min(count.used, count.limit)}
                  max={count.limit}
                />
                {count.used >= count.limit && (
                  <p className="settings-error">
                    한도에 도달했어요. 저장한 내용은 확인·삭제할 수 있어요.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {usage?.includesReservations && (
          <p className="settings-muted">진행 중인 처리 예약을 포함한 사용량이에요.</p>
        )}
        {usage?.resetAt && (
          <p className="settings-muted">
            다음 일일 한도 갱신:{" "}
            {new Date(usage.resetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          </p>
        )}
        {usage?.waitReasons?.includes("monthly_budget") && (
          <p role="status" className="settings-error">
            처리 예산 때문에 새 자동 처리가 대기 중이에요. 저장한 내용을 확인하거나 삭제할 수
            있어요.
          </p>
        )}
        {usage?.waitReasons?.includes("processing_capacity") && (
          <p role="status" className="settings-error">
            처리 용량 때문에 새 자동 처리가 대기 중이에요. 잠시 후 다시 확인해 주세요.
          </p>
        )}
        <p className="settings-muted">
          사건별 원본은 최대 100개·5GB예요. 문서·이미지 100MB, 음성·영상 1GB, PDF 500쪽, 미디어 60분
          한도를 적용해요. 처리 예산이나 용량에 따라 자동 처리가 대기할 수 있어요.
        </p>
        <a href="/help#limits">한도와 대기 도움말</a>
      </section>
      <section className="settings-card">
        <h2>보관한 사건</h2>
        <p>삭제하기 전에 필요한 PDF와 자료를 다운로드하세요. 삭제 후 되돌릴 수 없어요.</p>
        {!busy && !checking && cases.length === 0 && (
          <p>
            보관한 사건이 없어요. <a href="/cases/new">새 사건 만들기</a>
          </p>
        )}
        {!checking &&
          cases.map((item) => (
            <div className="settings-case" key={item.id}>
              <div>
                <a href={`/cases/${encodeURIComponent(item.id)}`}>{item.title}</a>
                <p className="settings-muted">
                  {new Date(item.updatedAt).toLocaleDateString("ko-KR")} ·{" "}
                  {item.schemaVersion === "1" ? "기존 사건" : "사건 정리"}
                </p>
                <a href={`/cases/${encodeURIComponent(item.id)}/reports`}>리포트 확인</a>
              </div>
              <button
                type="button"
                disabled={Boolean(busy) || checking}
                onClick={(event) => {
                  event.currentTarget.focus();
                  open(item);
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> 사건 삭제
              </button>
            </div>
          ))}
      </section>
      <section className="settings-card settings-danger">
        <h2>
          <AlertTriangle size={20} aria-hidden="true" /> 계정 삭제
        </h2>
        <p>
          모든 사건·자료·리포트·프로필과 로그인 정보의 삭제를 요청해요. 이미 다운로드하거나 외부에
          전달한 파일은 BARO에서 삭제할 수 없어요.
        </p>
        {!ready && (
          <>
            <p>계정 삭제 전에 같은 계정으로 다시 인증해 주세요.</p>
            <div className="settings-actions">
              {access?.providers.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  disabled={Boolean(busy) || checking}
                  onClick={() => void reauthenticate(provider)}
                >
                  {provider}로 재인증
                </button>
              ))}
            </div>
            {access && !access.providers.length && <a href="/login">다시 로그인</a>}
            {!access && !busy && <a href="/login">로그인 상태 확인</a>}
          </>
        )}
        {ready && <p>계정 확인을 마쳤어요. 삭제할 내용을 한 번 더 확인해 주세요.</p>}
        <button
          type="button"
          className="danger-button"
          disabled={Boolean(busy) || checking || !ready}
          onClick={(event) => {
            event.currentTarget.focus();
            open("account");
          }}
        >
          계정과 모든 사건 삭제
        </button>
      </section>
      <section className="settings-card">
        <h2>
          <HelpCircle size={20} aria-hidden="true" /> 도움말과 정책
        </h2>
        <nav className="settings-links">
          <a href="/help">사용 도움말</a>
          <a href="/policies/terms">이용약관 초안</a>
          <a href="/policies/privacy">개인정보 처리방침 초안</a>
          <a href="/policies/ai">AI 이용 고지 초안</a>
        </nav>
        <p className="settings-muted">
          정책은 검토 중인 초안이며 법률·사업자·게시 승인이 완료된 공개본이 아니에요.
        </p>
      </section>
      {target && (
        <ConfirmDialog
          title={
            target === "account"
              ? "계정과 모든 사건을 삭제할까요?"
              : `‘${target.title}’ 사건을 삭제할까요?`
          }
          busy={Boolean(busy)}
          onCancel={() => {
            if (!busy) setTarget(null);
          }}
        >
          <p>
            {target === "account"
              ? "계정의 사건·자료·리포트·프로필 접근을 차단하고 세션을 종료해요."
              : "이 사건의 대화·자료·리포트 접근을 차단해요."}{" "}
            삭제를 접수한 뒤 원격 자료 정리가 진행돼요.
          </p>
          <label htmlFor="delete-confirmation">삭제 확인 — DELETE 입력</label>
          <input
            id="delete-confirmation"
            autoComplete="off"
            value={confirmation}
            disabled={Boolean(busy) || checking}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          <div className="settings-actions">
            <button
              type="button"
              disabled={Boolean(busy) || checking}
              onClick={() => setTarget(null)}
            >
              취소
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={Boolean(busy) || checking || confirmation !== "DELETE"}
              onClick={() => void remove()}
            >
              {busy ? "삭제 요청 중…" : "삭제 요청 확인"}
            </button>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
