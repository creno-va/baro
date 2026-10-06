import { useEffect, useRef, useState } from "react";
import type { AccountType } from "../client/api";
import { api, errorMessage, roleStart } from "../client/api";
import { Button } from "./ui/button";

type Provider = "google" | "naver" | "kakao";

const providers: Array<{ id: Provider; label: string }> = [
  { id: "google", label: "Google로 계속하기" },
  { id: "naver", label: "Naver로 계속하기" },
  { id: "kakao", label: "Kakao로 계속하기" },
];

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
    <div className="auth-options" aria-busy={pendingProvider !== null}>
      <fieldset className="account-type" disabled={!ready || pendingProvider !== null}>
        <legend>어떤 목적으로 이용하시나요?</legend>
        <label>
          <input
            type="radio"
            name="accountType"
            value="customer"
            checked={accountType === "customer"}
            onChange={() => setAccountType("customer")}
          />
          <span>
            <strong>고객</strong>
            <small>내 사건과 상담 준비 자료 정리</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="accountType"
            value="lawyer"
            checked={accountType === "lawyer"}
            onChange={() => setAccountType("lawyer")}
          />
          <span>
            <strong>변호사</strong>
            <small>본인 프로필 작성과 공개 설정</small>
          </span>
        </label>
      </fieldset>
      <p className="case-muted">이용 유형 선택은 변호사 자격 확인을 의미하지 않아요.</p>
      {providers.map((provider) => (
        <Button
          variant="outline"
          className={`auth-provider auth-provider--${provider.id}`}
          disabled={!ready || pendingProvider !== null}
          key={provider.id}
          onClick={(event) => {
            lastButton.current = event.currentTarget;
            void signIn(provider.id);
          }}
          type="button"
        >
          {pendingProvider === provider.id ? "연결 중…" : provider.label}
        </Button>
      ))}
      <a className="secondary-action" href="/">
        취소하고 홈으로
      </a>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
