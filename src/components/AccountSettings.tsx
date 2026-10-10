import {
  AlertTriangle,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  HardDrive,
  HelpCircle,
  MessageCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
  const [accountType, setAccountType] = useState<"customer" | "lawyer" | null>(null);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    lock.current = false;
    owner.current = null;
    setUsage(null);
    setAccountType(null);
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
      const session = await api.session.get();
      if (sequence !== loadSequence.current) return;
      if (!session.user) throw new Error("로그인 후 설정을 다시 확인해 주세요.");
      setAccountType(session.user.accountType);
      const results = await Promise.allSettled([
        api.account.usage(),
        session.user.accountType === "customer" ? api.cases.list() : Promise.resolve([]),
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
      if (isSuperseded(error) || sequence !== loadSequence.current) return;
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
      <section className="settings-card settings-deleted" role="status">
        <span className="settings-section-icon">
          <Check size={25} aria-hidden="true" />
        </span>
        <h1>계정 삭제를 접수했어요</h1>
        <p>
          로그인 세션을 종료하고 접근을 차단했어요. 원격 파일·백업 정리는 삭제 절차에 따라 진행돼요.
        </p>
        <div className="settings-actions">
          <a className="settings-primary-link" href="/login">
            로그인 화면으로 <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a className="settings-text-link" href="/help#deletion">
            삭제 도움말 <ChevronRight size={16} aria-hidden="true" />
          </a>
        </div>
      </section>
    );
  return (
    <div className="account-settings" aria-busy={Boolean(busy) || checking}>
      <header className="settings-heading">
        <div>
          <span className="settings-eyebrow">내 계정</span>
          <h1>설정과 사용량</h1>
          <p>나의 이용 현황과 보관한 이야기를 한곳에서 관리해요.</p>
        </div>
        <button
          className="settings-refresh"
          type="button"
          disabled={Boolean(busy) || checking}
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" size={16} /> 다시 확인
        </button>
      </header>
      {(busy || checking) && (
        <p className="settings-loading settings-progress" role="status">
          <RefreshCw size={15} aria-hidden="true" /> {busy || "계정 접근 상태 확인 중…"}
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
      <section className="settings-card settings-usage" aria-labelledby="settings-usage-title">
        <div className="settings-section-heading">
          <span className="settings-section-icon">
            <ChartNoAxesColumnIncreasing size={23} aria-hidden="true" />
          </span>
          <div>
            <h2 id="settings-usage-title">사용량과 한도</h2>
            <p>오늘 얼마나 이용했는지 살펴보세요.</p>
          </div>
          <span className="settings-reset-badge">
            <Clock3 size={14} aria-hidden="true" /> 매일 자정 갱신
          </span>
        </div>
        {usage && !checking && (
          <div className="usage-grid">
            {(
              [
                ["오늘 새 사건", usage.newCases, "건", FolderOpen],
                ["오늘 AI 응답", usage.aiResponses, "회", MessageCircle],
                ["오늘 음성·영상", usage.mediaMinutes, "분", Mic],
                [
                  "계정 저장 공간",
                  { used: usage.storageBytes.used / 1e9, limit: usage.storageBytes.limit / 1e9 },
                  "GB",
                  HardDrive,
                ],
              ] as const
            ).map(([label, count, unit, Icon]) => (
              <div className="usage-item" key={label}>
                <div className="usage-item-label">
                  <Icon size={18} aria-hidden="true" />
                  <strong>{label}</strong>
                </div>
                <p className="usage-item-value">
                  <b>{Number(count.used.toFixed(2))}</b>
                  <span>{unit}</span>
                  <span className="usage-item-limit">
                    / {count.limit} {unit}
                  </span>
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
        <div className="settings-usage-notes">
          <p>
            하루 한도는 한국 시간 자정에 다시 이용할 수 있어요. 저장 공간은 자료를 삭제해 확보할 수
            있어요.
          </p>
          {usage?.includesReservations && <p>진행 중인 처리 예약을 포함한 사용량이에요.</p>}
          {usage?.resetAt && (
            <p>
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
          {usage?.waitReasons?.includes("ai_funding") && (
            <p role="status" className="settings-error">
              AI 실행 설정을 확인 중이에요. 저장한 내용을 확인하거나 삭제할 수 있어요.
            </p>
          )}
          {usage?.waitReasons?.includes("processing_capacity") && (
            <p role="status" className="settings-error">
              처리 용량 때문에 새 자동 처리가 대기 중이에요. 잠시 후 다시 확인해 주세요.
            </p>
          )}
        </div>
        <div className="settings-usage-guide">
          <p className="settings-muted">
            사건별 원본은 최대 100개·5GB예요. 문서·이미지 100MB, 음성·영상 1GB, PDF 500쪽, 미디어
            60분 한도를 적용해요. 처리 예산이나 용량에 따라 자동 처리가 대기할 수 있어요.
          </p>
          <a className="settings-text-link" href="/help#limits">
            한도와 대기 도움말 <ChevronRight size={16} aria-hidden="true" />
          </a>
        </div>
      </section>
      <div className="settings-details-grid">
        {accountType === "customer" && (
          <section className="settings-card settings-cases" aria-labelledby="settings-cases-title">
            <div className="settings-section-heading">
              <span className="settings-section-icon">
                <FolderOpen size={23} aria-hidden="true" />
              </span>
              <div>
                <h2 id="settings-cases-title">보관한 사건</h2>
                <p>나의 이야기를 확인하고 관리해요.</p>
              </div>
              {!checking && <span className="settings-count">{cases.length}</span>}
            </div>
            <div className="settings-case-list">
              {!busy && !checking && cases.length === 0 && (
                <div className="settings-empty">
                  <FolderOpen size={30} aria-hidden="true" />
                  <p>보관한 사건이 없어요.</p>
                  <a className="settings-text-link" href="/cases/new">
                    새 사건 만들기 <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </div>
              )}
              {!checking &&
                cases.map((item) => (
                  <div className="settings-case" key={item.id}>
                    <span className="settings-case-icon">
                      <FileText size={20} aria-hidden="true" />
                    </span>
                    <div className="settings-case-info">
                      <a
                        className="settings-case-title"
                        href={`/cases/${encodeURIComponent(item.id)}`}
                      >
                        {item.title}
                      </a>
                      <p className="settings-muted">
                        {new Date(item.updatedAt).toLocaleDateString("ko-KR")} ·{" "}
                        {item.schemaVersion === "1" ? "기존 사건" : "사건 정리"}
                      </p>
                      {item.schemaVersion !== "1" && (
                        <a
                          className="settings-report-link"
                          href={`/cases/${encodeURIComponent(item.id)}/reports`}
                        >
                          리포트 확인 <ChevronRight size={14} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <button
                      className="settings-case-delete"
                      type="button"
                      disabled={Boolean(busy) || checking}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        open(item);
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" /> 사건 삭제
                    </button>
                  </div>
                ))}
            </div>
            <p className="settings-case-note">
              삭제하기 전에 필요한 PDF와 자료를 다운로드하세요. 삭제 후 되돌릴 수 없어요.
            </p>
          </section>
        )}
        <section className="settings-card settings-help" aria-labelledby="settings-help-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon settings-section-icon-neutral">
              <HelpCircle size={23} aria-hidden="true" />
            </span>
            <div>
              <h2 id="settings-help-title">도움말과 정책</h2>
              <p>궁금한 내용을 확인해 보세요.</p>
            </div>
          </div>
          <nav className="settings-links" aria-label="도움말과 정책">
            <a href="/help">
              <span>사용 도움말</span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
            <a href="/policies/terms">
              <span>이용약관 초안</span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
            <a href="/policies/privacy">
              <span>개인정보 처리방침 초안</span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
            <a href="/policies/ai">
              <span>AI 이용 고지 초안</span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          </nav>
          <p className="settings-policy-note">
            정책은 검토 중인 초안이며 법률·사업자·게시 승인이 완료된 공개본이 아니에요.
          </p>
        </section>
      </div>
      <section className="settings-card settings-danger" aria-labelledby="settings-danger-title">
        <div className="settings-section-heading">
          <span className="settings-section-icon settings-section-icon-danger">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <div>
            <h2 id="settings-danger-title">계정 삭제</h2>
            <p>중요한 정보는 미리 보관해 주세요.</p>
          </div>
        </div>
        <div className="settings-danger-content">
          <p>
            모든 사건·자료·리포트·프로필과 로그인 정보의 삭제를 요청해요. 이미 다운로드하거나 외부에
            전달한 파일은 BARO에서 삭제할 수 없어요.
          </p>
          {!ready && (
            <div className="settings-reauth">
              <p>
                <AlertTriangle size={16} aria-hidden="true" /> 계정 삭제 전에 같은 계정으로 다시
                인증해 주세요.
              </p>
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
              {access && !access.providers.length && (
                <a className="settings-text-link" href="/login">
                  다시 로그인 <ChevronRight size={16} aria-hidden="true" />
                </a>
              )}
              {!access && !busy && (
                <a className="settings-text-link" href="/login">
                  로그인 상태 확인 <ChevronRight size={16} aria-hidden="true" />
                </a>
              )}
            </div>
          )}
          {ready && (
            <p className="settings-reauth-complete">
              <Check size={16} aria-hidden="true" /> 계정 확인을 마쳤어요. 삭제할 내용을 한 번 더
              확인해 주세요.
            </p>
          )}
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
        </div>
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
