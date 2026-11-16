import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, apiMode, errorMessage } from "../../client/api";
import { useWebSession, WebQueryProvider } from "../../client/query/session";
import { accessHref, returnPathFromLocation, sessionDestination } from "../../client/return-path";
import { consentInputSchema } from "../../contracts/consent";

export function Access({ mode }: { mode: "login" | "consent" }) {
  return (
    <WebQueryProvider>
      <AccessContent mode={mode} />
    </WebQueryProvider>
  );
}

function AccessContent({ mode }: { mode: "login" | "consent" }) {
  const { session, owner, ready, error: sessionError, refresh } = useWebSession();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [acceptedOwner, setAcceptedOwner] = useState<string | null>(null);
  const accepted = Boolean(owner && acceptedOwner === owner);
  useEffect(() => {
    if (mode !== "login") return;
    const callbackError = new URLSearchParams(window.location.search).get("error");
    if (!callbackError) return;
    setError(
      callbackError === "account_not_linked" || callbackError === "unable_to_link_account"
        ? "계정을 연결하지 못했어요. 이메일이 인증된 소셜 계정이나 기존 로그인 방법을 사용해 주세요."
        : callbackError === "access_denied"
          ? "로그인을 취소했어요. 원하는 계정으로 다시 선택해 주세요."
          : callbackError === "session_expired"
            ? "안전한 이용을 위해 다시 로그인해 주세요."
            : "로그인을 완료하지 못했어요. 다시 선택해 주세요.",
    );
  }, [mode]);
  const consent = useQuery({
    queryKey: ["web", owner, "consent"],
    queryFn: () => api.session.getConsent(),
    enabled: mode === "consent" && ready && Boolean(owner),
    retry: false,
  });
  useEffect(() => {
    if (!ready || !session) return;
    if (mode === "consent" && !session.user) {
      window.location.replace(accessHref("login", returnPathFromLocation() ?? undefined));
    } else if (
      session.user &&
      !session.needsConsent &&
      (mode === "login" || consent.data?.needsConsent === false)
    ) {
      window.location.replace(sessionDestination({ ...session, needsConsent: false }));
    } else if (mode === "login" && session.user && session.needsConsent) {
      window.location.replace(accessHref("consent", returnPathFromLocation() ?? undefined));
    }
  }, [ready, session, mode, consent.data]);

  async function signIn(provider: "google" | "naver" | "kakao") {
    if (busy) return;
    setBusy(provider);
    setError("");
    try {
      const value = await api.session.signIn(provider);
      if (value) window.location.assign(sessionDestination(value));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy("");
    }
  }

  async function saveConsent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || !consent.data || busy || !session?.user) return;
    const submittedOwner = session.user.id;
    setBusy("consent");
    setError("");
    try {
      const value = await api.session.saveConsent(consentInputSchema.parse(consent.data.required));
      if (!value.user || value.needsConsent) throw new Error("동의 저장 상태를 확인해 주세요.");
      const current = await api.session.get();
      if (current.user?.id !== submittedOwner || current.needsConsent)
        throw new Error("이용 계정이 변경됐어요. 현재 계정의 정책을 다시 확인해 주세요.");
      window.location.replace(sessionDestination(current));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy("");
    }
  }

  const failure =
    error ||
    (sessionError ? errorMessage(sessionError) : "") ||
    (consent.error ? errorMessage(consent.error) : "");
  return (
    <main id="main-content" className="web-access" tabIndex={-1}>
      <nav className="web-public-nav" aria-label="로그인 탐색">
        <a className="web-brand" href="/" aria-label="BARO 홈">
          <img src="/brand/logo.svg" alt="" width="30" height="30" />
          BARO
        </a>
        <a className="web-quiet-link" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          홈으로
        </a>
      </nav>
      <div className="web-access-grid">
        <header className="web-access-intro">
          <span className="web-kicker">A LITTLE CLARITY, EVERY DAY</span>
          <h1>
            막막한 일을,
            <br />
            하나씩 명확하게.
          </h1>
          <p>
            나의 이야기를 정리하고,
            <br />
            다음에 할 일을 찾아가세요.
          </p>
          <div className="web-access-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>내 사건과 자료는 나만 볼 수 있어요.</span>
          </div>
        </header>
        <section className="web-access-card" aria-labelledby="access-title">
          <span className="web-step-label">
            {mode === "login" ? "다시 만나 반가워요" : "시작하기 전, 잠깐"}
          </span>
          <h2 id="access-title">{mode === "login" ? "내 이야기 이어가기" : "서비스 이용 안내"}</h2>
          <p>
            {mode === "login"
              ? "소셜 계정으로 간편하게 시작하세요."
              : "정책을 확인하고 동의하면 이어서 진행해요."}
          </p>
          {apiMode === "mock" && (
            <p className="web-demo-label">합성 데이터로 동작하는 로컬 예시입니다.</p>
          )}
          {failure && (
            <div className="web-feedback" role="alert">
              <p>{failure}</p>
              {!error && (
                <button
                  className="web-secondary"
                  type="button"
                  onClick={() => {
                    void refresh();
                    void consent.refetch();
                  }}
                >
                  다시 확인
                </button>
              )}
            </div>
          )}
          {!ready ? (
            <p role="status">이용 상태를 확인하고 있어요…</p>
          ) : mode === "login" ? (
            <div className="web-social-buttons">
              {(["google", "naver", "kakao"] as const).map((provider) => (
                <button
                  key={provider}
                  className={`web-social web-social--${provider}`}
                  type="button"
                  disabled={Boolean(busy) || Boolean(session?.user)}
                  onClick={() => void signIn(provider)}
                >
                  <span className="web-provider-mark" aria-hidden="true">
                    {provider === "google" ? "G" : provider === "naver" ? "N" : "●"}
                  </span>
                  <span>
                    {busy === provider
                      ? "연결하고 있어요…"
                      : `${provider === "google" ? "Google" : provider === "naver" ? "네이버" : "카카오"}로 계속하기`}
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : consent.data && owner ? (
            <form
              className="web-consent-form"
              onSubmit={(event) => void saveConsent(event)}
              aria-busy={Boolean(busy)}
            >
              <div className="web-policy-check">
                <Check size={18} aria-hidden="true" />
                <span>내 사건과 자료를 정리하는 AI 서비스예요.</span>
              </div>
              <nav className="web-policy-list" aria-label="정책 원문">
                <a href="/policies/terms" target="_blank" rel="noopener noreferrer">
                  이용약관 <span>새 창 ↗</span>
                </a>
                <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">
                  개인정보 처리방침 <span>새 창 ↗</span>
                </a>
                <a href="/policies/ai" target="_blank" rel="noopener noreferrer">
                  AI 이용 고지 <span>새 창 ↗</span>
                </a>
              </nav>
              <label className="web-checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={Boolean(busy)}
                  onChange={(event) => setAcceptedOwner(event.target.checked ? owner : null)}
                />
                <span>[필수] 위 정책을 확인하고 동의합니다.</span>
              </label>
              <button className="web-primary" type="submit" disabled={!accepted || Boolean(busy)}>
                {busy ? "저장 중…" : "동의하고 시작하기"}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </form>
          ) : !failure ? (
            <p role="status">정책을 불러오고 있어요…</p>
          ) : null}
          <footer className="web-access-footer">
            <a href="/policies/terms">이용약관</a>
            <a href="/policies/privacy">개인정보 처리방침</a>
            <a href="/help">도움말</a>
          </footer>
        </section>
      </div>
    </main>
  );
}
