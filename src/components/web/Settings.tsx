import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CircleHelp, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type Provider } from "../../client/api";
import { useWebSession, WebQueryProvider } from "../../client/query/session";
import { sessionDestination } from "../../client/return-path";

const providerNames = { google: "Google", naver: "네이버", kakao: "카카오" };
const markerKey = "baro.account-reauth.v1";
const format = (value: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(value);

export function Settings() {
  return (
    <WebQueryProvider>
      <SettingsContent />
    </WebQueryProvider>
  );
}

function SettingsContent() {
  const { session, owner, ready, error: sessionError, refresh, signOut } = useWebSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showDeletion, setShowDeletion] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(false);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const usage = useQuery({
    queryKey: ["web", owner, "usage"],
    queryFn: () => api.account.usage(),
    enabled: ready && Boolean(owner),
    retry: false,
  });
  const deletion = useQuery({
    queryKey: ["web", owner, "deletion-access"],
    queryFn: () => api.account.deletionAccess(),
    enabled: ready && Boolean(owner) && showDeletion,
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (ready && session && (!session.user || session.needsConsent) && !deleted)
      window.location.replace(sessionDestination(session, "/settings"));
  }, [ready, session, deleted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing identity must revoke the locally entered deletion confirmation.
  useEffect(() => {
    setShowDeletion(false);
    setConfirmation("");
    setError("");
    setBusy("");
  }, [owner]);

  async function logout() {
    if (busy) return;
    setBusy("signout");
    setError("");
    try {
      await signOut();
      window.location.assign("/login");
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy("");
    }
  }

  async function reauthenticate(provider: Provider) {
    if (busy || !owner) return;
    const startedOwner = owner;
    setBusy(provider);
    setError("");
    try {
      const current = await api.account.deletionAccess();
      if (ownerRef.current !== startedOwner || !current.providers.includes(provider))
        throw new Error("계정 상태가 변경됐어요. 다시 확인해 주세요.");
      sessionStorage.setItem(
        markerKey,
        JSON.stringify({
          ownerTag: current.ownerTag,
          startedAt: Date.now(),
          purpose: "account-delete",
        }),
      );
      await api.account.reauthenticate(provider);
    } catch (failure) {
      sessionStorage.removeItem(markerKey);
      if (ownerRef.current === startedOwner) {
        setError(errorMessage(failure));
        setBusy("");
      }
    }
  }

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || confirmation !== "DELETE" || !owner || !deletion.data?.canDelete) return;
    const startedOwner = owner;
    const ownerTag = deletion.data.ownerTag;
    setBusy("delete");
    setError("");
    try {
      const current = await api.account.deletionAccess();
      if (ownerRef.current !== startedOwner || current.ownerTag !== ownerTag || !current.canDelete)
        throw new Error("삭제 전 같은 계정으로 다시 인증해 주세요.");
      await api.account.deleteAccount(confirmation);
      sessionStorage.removeItem(markerKey);
      setDeleted(true);
      setShowDeletion(false);
    } catch (failure) {
      if (ownerRef.current === startedOwner) {
        setError(errorMessage(failure));
        setConfirmation("");
        void deletion.refetch();
      }
    } finally {
      if (ownerRef.current === startedOwner) setBusy("");
    }
  }

  if (deleted)
    return (
      <main id="main-content" className="web-settings-page">
        <a className="web-brand" href="/">
          BARO
        </a>
        <section className="web-settings-card">
          <ShieldCheck size={30} aria-hidden="true" />
          <h1>계정 삭제를 접수했어요</h1>
          <p>
            계정 접근이 차단되고 자료 정리가 진행됩니다. 이미 내려받거나 외부에 전달한 파일은 별도로
            관리해 주세요.
          </p>
          <a className="web-primary" href="/">
            홈으로 돌아가기
          </a>
        </section>
      </main>
    );
  return (
    <main id="main-content" className="web-settings-page" tabIndex={-1}>
      <nav className="web-settings-nav" aria-label="설정 탐색">
        <a className="web-quiet-link" href="/new">
          <ArrowLeft size={18} aria-hidden="true" />
          작업 공간
        </a>
        <a className="web-brand" href="/">
          BARO
        </a>
      </nav>
      <header className="web-settings-heading">
        <span className="web-kicker">MY ACCOUNT</span>
        <h1>설정과 사용량</h1>
        <p>내 계정과 자료를 안전하게 관리하세요.</p>
      </header>
      {Boolean(sessionError) && (
        <div className="web-feedback" role="alert">
          <p>{errorMessage(sessionError)}</p>
          <button type="button" className="web-secondary" onClick={() => void refresh()}>
            다시 확인
          </button>
        </div>
      )}
      {error && (
        <p className="web-feedback" role="alert">
          {error}
        </p>
      )}
      {!ready ? (
        <p role="status">계정 상태를 확인하고 있어요…</p>
      ) : owner && session?.user ? (
        <div className="web-settings-stack">
          <section className="web-settings-card">
            <div className="web-settings-row">
              <div>
                <h2>{session.user.name || "내 계정"}</h2>
                <p>내 사건과 자료는 이 계정에 저장됩니다.</p>
              </div>
              <button
                className="web-secondary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void logout()}
              >
                <LogOut size={17} aria-hidden="true" />
                {busy === "signout" ? "로그아웃 중…" : "로그아웃"}
              </button>
            </div>
          </section>
          <section className="web-settings-card" aria-labelledby="usage-title">
            <div className="web-settings-row">
              <div>
                <h2 id="usage-title">사용량</h2>
                <p>처리 중인 작업의 예약 사용량이 포함될 수 있어요.</p>
              </div>
              <button
                className="web-icon-button"
                type="button"
                aria-label="사용량 다시 확인"
                disabled={usage.isFetching}
                onClick={() => void usage.refetch()}
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
            {usage.error ? (
              <p className="web-feedback" role="alert">
                {errorMessage(usage.error)}
              </p>
            ) : usage.data ? (
              <div className="web-usage-grid">
                {(
                  [
                    ["AI 응답", usage.data.aiResponses.used, usage.data.aiResponses.limit, "회"],
                    ["새 사건", usage.data.newCases.used, usage.data.newCases.limit, "건"],
                    [
                      "음성·영상",
                      usage.data.mediaMinutes.used,
                      usage.data.mediaMinutes.limit,
                      "분",
                    ],
                    [
                      "자료 보관",
                      usage.data.storageBytes.used / 1024 ** 3,
                      usage.data.storageBytes.limit / 1024 ** 3,
                      "GB",
                    ],
                  ] as const
                ).map(([label, used, limit, unit]) => (
                  <div className="web-usage-item" key={label}>
                    <span>{label}</span>
                    <strong>
                      {format(used)}
                      <small>
                        {" "}
                        / {format(limit)} {unit}
                      </small>
                    </strong>
                    <progress
                      max={limit}
                      value={Math.min(used, limit)}
                      aria-label={`${label} 사용량`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p role="status">사용량을 불러오고 있어요…</p>
            )}
          </section>
          <section className="web-settings-card">
            <div className="web-settings-row">
              <div>
                <h2>이용 안내</h2>
                <p>BARO를 사용하는 방법과 서비스 정책을 확인하세요.</p>
              </div>
              <CircleHelp size={22} aria-hidden="true" />
            </div>
            <nav className="web-settings-links" aria-label="이용 안내">
              <a href="/help">
                도움말
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a href="/policies/privacy">
                개인정보 처리방침
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a href="/policies/terms">
                이용약관
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a href="/policies/ai">
                AI 이용 고지
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </nav>
          </section>
          <section className="web-settings-card web-danger-zone" aria-labelledby="delete-title">
            <h2 id="delete-title">계정 삭제</h2>
            <p>
              계정의 모든 사건·자료·리포트·프로필 접근을 차단하고 세션을 종료합니다. 접수 후 원격
              자료 정리가 진행되며 복구할 수 없어요.
            </p>
            {!showDeletion ? (
              <button
                className="web-danger"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setShowDeletion(true);
                  setError("");
                }}
              >
                계정 삭제 절차 시작
              </button>
            ) : (
              <div className="web-deletion-panel">
                {deletion.error ? (
                  <div className="web-feedback" role="alert">
                    <p>{errorMessage(deletion.error)}</p>
                    <button
                      className="web-secondary"
                      type="button"
                      onClick={() => void deletion.refetch()}
                    >
                      다시 확인
                    </button>
                  </div>
                ) : !deletion.data ? (
                  <p role="status">본인 확인 상태를 확인하고 있어요…</p>
                ) : !deletion.data.canDelete ? (
                  <>
                    <h3>같은 계정으로 본인 확인</h3>
                    <p>삭제를 진행하려면 연결된 소셜 계정으로 다시 인증해 주세요.</p>
                    <div className="web-reauth-buttons">
                      {deletion.data.providers.map((provider) => (
                        <button
                          className="web-secondary"
                          key={provider}
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void reauthenticate(provider)}
                        >
                          {providerNames[provider]}로 재인증
                        </button>
                      ))}
                    </div>
                    {!deletion.data.providers.length && (
                      <a href="/login?returnTo=%2Fsettings">다시 로그인</a>
                    )}
                  </>
                ) : (
                  <form onSubmit={(event) => void remove(event)}>
                    <label htmlFor="web-delete-confirmation">
                      삭제 확인을 위해 DELETE를 입력하세요.
                    </label>
                    <input
                      id="web-delete-confirmation"
                      autoComplete="off"
                      value={confirmation}
                      disabled={Boolean(busy)}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <button
                      className="web-danger"
                      type="submit"
                      disabled={confirmation !== "DELETE" || Boolean(busy)}
                    >
                      {busy === "delete" ? "삭제 접수 중…" : "계정과 모든 사건 삭제"}
                    </button>
                  </form>
                )}
                <button
                  className="web-text-button"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setShowDeletion(false);
                    setConfirmation("");
                    setError("");
                  }}
                >
                  취소
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
