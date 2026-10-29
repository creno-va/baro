import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Clock3,
  FolderOpen,
  HardDrive,
  HelpCircle,
  MessageCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client/api";
import { accountDeleted } from "../server/modules/analytics/browser";
import { ProviderIcon } from "./AuthButtons";
import { ConfirmDialog } from "./reports/ConfirmDialog";
import { LoadingContent, Spinner } from "./ui/loading";

const markerKey = "baro.account-reauth.v1";
const providerNames = { google: "Google", naver: "네이버", kakao: "카카오" };
const superseded = () =>
  Object.assign(new Error("설정 확인 요청이 변경됐어요."), { code: "SETTINGS_READ_SUPERSEDED" });
const isSuperseded = (error: unknown) =>
  (error as { code?: string })?.code === "SETTINGS_READ_SUPERSEDED";
type Access = Awaited<ReturnType<typeof api.account.deletionAccess>>;
export function AccountSettings() {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.account.usage>> | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<"account" | null>(null);
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
    setAccess(null);
    setReady(false);
    setTarget(null);
    setConfirmation("");
    setNotice("");
    setBusy("");
    setChecking(false);
    sessionStorage.removeItem(markerKey);
  }, []);
  const verifyOwner = useCallback(
    async (onInvalidated?: (sequence: number) => void) => {
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
        onInvalidated?.(loadSequence.current);
        throw error;
      }
    },
    [clearOwnerState],
  );
  const load = useCallback(async () => {
    let sequence = ++loadSequence.current;
    const checkOwner = () =>
      verifyOwner((next) => {
        // Clearing inaccessible state invalidates other reads, not this failure.
        sequence = next;
      });
    setChecking(true);
    setBusy("설정 확인 중…");
    setError("");
    try {
      await checkOwner();
      const session = await api.session.get();
      if (sequence !== loadSequence.current) return;
      if (!session.user) throw new Error("로그인 후 설정을 다시 확인해 주세요.");
      const results = await Promise.allSettled([api.account.usage(), api.account.deletionAccess()]);
      if (sequence !== loadSequence.current) return;
      await checkOwner();
      if (sequence !== loadSequence.current) return;
      const problems: string[] = [];
      if (results[0].status === "fulfilled") setUsage(results[0].value);
      else {
        setUsage(null);
        problems.push("사용량을 확인하지 못했어요.");
      }
      if (results[1].status === "fulfilled") {
        const value = results[1].value;
        if (value.ownerTag !== owner.current) {
          throw new Error("계정이 변경됐어요. 설정을 다시 불러와 주세요.");
        }
        setAccess(value);
        const raw = sessionStorage.getItem(markerKey);
        let marker: { ownerTag?: string; startedAt?: number; purpose?: string } | null = null;
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
        } else if (confirmed && marker?.purpose === "account-delete") {
          setTarget("account");
          setConfirmation("");
          sessionStorage.setItem(
            markerKey,
            JSON.stringify({ ownerTag: marker.ownerTag, startedAt: marker.startedAt }),
          );
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
      const verified = await verifyOwner();
      if (!verified.providers.includes(provider))
        throw new Error("이 계정에 연결된 로그인 수단을 다시 확인해 주세요.");
      // Earlier load/focus reads cannot consume the new reauthentication marker.
      sequence = ++loadSequence.current;
      sessionStorage.setItem(
        markerKey,
        JSON.stringify({
          ownerTag: verified.ownerTag,
          startedAt: Date.now(),
          purpose: "account-delete",
        }),
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
      if (target === "account") {
        await api.account.deleteAccount(confirmation);
        sessionStorage.removeItem(markerKey);
        setDeleted(true);
        setTarget(null);
        await accountDeleted().catch(() => false);
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
  const open = (value: "account") => {
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
          <p>이용 현황과 계정 정보를 관리해요.</p>
        </div>
        <button
          className="settings-refresh"
          aria-busy={Boolean(busy) || checking}
          type="button"
          disabled={Boolean(busy) || checking}
          onClick={() => void load()}
        >
          {busy || checking ? <Spinner /> : <RefreshCw aria-hidden="true" size={16} />} 다시 확인
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
            <ChartNoAxesColumnIncreasing size={28} aria-hidden="true" />
          </span>
          <div>
            <h2 id="settings-usage-title">사용량과 한도</h2>
            <p>오늘 얼마나 이용했는지 살펴보세요.</p>
          </div>
          <span className="settings-reset-badge">
            <Clock3 size={14} aria-hidden="true" /> 매일 자정 갱신
          </span>
        </div>
        {!usage && (busy || checking) && (
          <LoadingContent announce={false} layout="usage" title="이용 현황을 불러오고 있어요." />
        )}
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
                  FolderOpen,
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
        <details className="settings-usage-guide">
          <summary>파일별 한도와 처리 안내</summary>
          <p className="settings-muted">
            사건별 원본은 최대 100개·5GB예요. 문서·이미지 100MB, 음성·영상 1GB, PDF 500쪽, 미디어
            60분 한도를 적용해요. 실제 처리 용량이나 서비스 장애로 자동 처리가 대기할 수 있어요.
          </p>
          <a className="settings-text-link" href="/help#limits">
            한도와 대기 도움말 <ChevronRight size={16} aria-hidden="true" />
          </a>
        </details>
      </section>
      <div className="settings-details-grid">
        <section className="settings-card settings-help" aria-labelledby="settings-help-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon settings-section-icon-neutral">
              <HelpCircle size={28} aria-hidden="true" />
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
            <ShieldCheck size={28} aria-hidden="true" />
          </span>
          <div>
            <h2 id="settings-danger-title">계정 삭제</h2>
          </div>
        </div>
        <div className="settings-danger-content">
          <button
            type="button"
            className="danger-button"
            disabled={Boolean(busy) || checking || !access}
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
          title={ready ? "계정과 모든 사건을 삭제할까요?" : "계정 삭제 전 본인 확인"}
          busy={Boolean(busy)}
          onCancel={() => {
            if (!busy) setTarget(null);
          }}
        >
          {!ready ? (
            <div className="settings-reauth">
              <p>안전한 삭제를 위해 이 계정에 연결된 로그인 수단으로 다시 인증해 주세요.</p>
              <div className="settings-provider-list">
                {access?.providers.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`settings-provider settings-provider--${provider}`}
                    disabled={Boolean(busy) || checking}
                    onClick={() => void reauthenticate(provider)}
                  >
                    <ProviderIcon provider={provider} />
                    <span>{providerNames[provider]}로 재인증</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {access && !access.providers.length && (
                <a className="settings-text-link" href="/login">
                  다시 로그인 <ChevronRight size={16} aria-hidden="true" />
                </a>
              )}
            </div>
          ) : (
            <>
              <p>
                계정의 사건·자료·리포트·프로필 접근을 차단하고 세션을 종료해요. 삭제를 접수한 뒤
                원격 자료 정리가 진행돼요. 이미 다운로드하거나 외부에 전달한 파일은 삭제할 수
                없어요.
              </p>
              <label htmlFor="delete-confirmation">삭제 확인 — DELETE 입력</label>
              <input
                id="delete-confirmation"
                autoComplete="off"
                value={confirmation}
                disabled={Boolean(busy) || checking}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </>
          )}
          {error && (
            <p role="alert" className="settings-error">
              {error}
            </p>
          )}
          <div className="settings-actions deletion-dialog-actions">
            {ready && (
              <button
                type="button"
                className="danger-button"
                disabled={Boolean(busy) || checking || !ready || confirmation !== "DELETE"}
                onClick={() => void remove()}
              >
                {busy ? "삭제 요청 중…" : "삭제 요청 확인"}
              </button>
            )}
            <button
              type="button"
              disabled={Boolean(busy) || checking}
              onClick={() => setTarget(null)}
            >
              취소
            </button>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
