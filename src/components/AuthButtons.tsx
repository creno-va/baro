import { useEffect, useRef, useState } from "react";
import type { AccountType } from "../client/api";
import { api, apiMode, errorMessage, roleStart } from "../client/api";

type Provider = "google" | "naver" | "kakao";

const providers: Array<{ id: Provider; label: string; name: string }> = [
  { id: "kakao", label: "Kakao로 계속하기", name: "Kakao" },
  { id: "naver", label: "Naver로 계속하기", name: "Naver" },
  { id: "google", label: "Google로 계속하기", name: "Google" },
];

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "kakao") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3C6.48 3 2 6.47 2 10.75c0 2.78 1.89 5.22 4.73 6.59l-.96 3.57a.32.32 0 0 0 .49.35l4.18-2.78c.51.06 1.03.1 1.56.1 5.52 0 10-3.5 10-7.83S17.52 3 12 3Z" />
      </svg>
    );
  }
  if (provider === "naver") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 3h6.15l5.7 8.56V3H21v18h-6.15l-5.7-8.56V21H3V3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.01v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.34Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.89.6-2.03.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
      />
      <path fill="#FBBC05" d="M6.39 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.34-2.59Z" />
      <path
        fill="#EA4335"
        d="M12 5.97c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.34 2.59C7.18 7.73 9.39 5.97 12 5.97Z"
      />
    </svg>
  );
}

export function AuthButtons() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (error && pendingProvider === null) lastButton.current?.focus();
  }, [error, pendingProvider]);

  async function signIn(provider: Provider) {
    setPendingProvider(provider);
    setError(null);

    try {
      const result = await api.session.signIn(provider, accountType);
      if (result) window.location.assign(roleStart(result));
      return;
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setPendingProvider(null);
  }

  return (
    <div className="login-options" aria-busy={pendingProvider !== null}>
      {apiMode === "mock" && (
        <p className="login-demo-note">API 예시 모드 · 합성 계정으로 시연합니다.</p>
      )}
      <fieldset className="login-account-type" disabled={!ready || pendingProvider !== null}>
        <legend>어떤 목적으로 이용하시나요?</legend>
        <label>
          <input
            type="radio"
            name="accountType"
            value="customer"
            checked={accountType === "customer"}
            onChange={() => setAccountType("customer")}
          />
          <span>고객</span>
        </label>
        <label>
          <input
            type="radio"
            name="accountType"
            value="lawyer"
            checked={accountType === "lawyer"}
            onChange={() => setAccountType("lawyer")}
          />
          <span>변호사</span>
        </label>
      </fieldset>
      <p className="login-role-description" aria-live="polite">
        {accountType === "customer"
          ? "내 사건과 상담 준비 자료를 정리할게요."
          : "내 프로필을 작성하고 공개 범위를 설정할게요."}
      </p>
      <fieldset className="login-social">
        <legend>SNS 계정으로 간편하게 시작하기</legend>
        <div className="login-provider-list">
          {providers.map((provider) => (
            <button
              className={`login-provider login-provider--${provider.id}`}
              disabled={!ready || pendingProvider !== null}
              aria-label={pendingProvider === provider.id ? "연결 중…" : provider.label}
              key={provider.id}
              onClick={(event) => {
                lastButton.current = event.currentTarget;
                void signIn(provider.id);
              }}
              type="button"
            >
              <span className="login-provider__circle">
                {pendingProvider === provider.id ? (
                  <span className="login-provider__spinner" aria-hidden="true" />
                ) : (
                  <ProviderIcon provider={provider.id} />
                )}
              </span>
              <span className="login-provider__name" aria-hidden="true">
                {provider.name}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="login-status" role="status">
        {pendingProvider ? "로그인 페이지로 연결하고 있어요." : ""}
      </p>
      {accountType === "lawyer" && (
        <p className="login-role-note">이용 유형 선택은 변호사 자격 확인을 의미하지 않아요.</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
