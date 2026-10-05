import { useState } from "react";
import { authClient } from "../client/auth";

type Provider = "google" | "naver" | "kakao";

const providers: Array<{ id: Provider; label: string }> = [
  { id: "google", label: "Google로 계속하기" },
  { id: "naver", label: "Naver로 계속하기" },
  { id: "kakao", label: "Kakao로 계속하기" },
];

export function AuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setPendingProvider(provider);
    setError(null);

    const result = await authClient.signIn.social({
      provider,
      callbackURL: "/consent",
      errorCallbackURL: "/login?error=oauth",
    });

    if (result.error) {
      setError("로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      setPendingProvider(null);
    }
  }

  return (
    <div className="auth-options">
      {providers.map((provider) => (
        <button
          className={`auth-provider auth-provider--${provider.id}`}
          disabled={pendingProvider !== null}
          key={provider.id}
          onClick={() => signIn(provider.id)}
          type="button"
        >
          {pendingProvider === provider.id ? "연결 중…" : provider.label}
        </button>
      ))}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
