import { useEffect, useRef, useState } from "react";
import { authClient } from "../client/auth";
import { Button } from "./ui/button";

type Provider = "google" | "naver" | "kakao";

const providers: Array<{ id: Provider; label: string }> = [
  { id: "google", label: "Google로 계속하기" },
  { id: "naver", label: "Naver로 계속하기" },
  { id: "kakao", label: "Kakao로 계속하기" },
];

export function AuthButtons() {
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
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/consent",
        errorCallbackURL: "/login?error=oauth",
      });
      if (!result.error) return;
    } catch {
      // Network failures use the same recoverable UI as provider failures.
    }
    setError("로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    setPendingProvider(null);
  }

  return (
    <div className="auth-options" aria-busy={pendingProvider !== null}>
      {providers.map((provider) => (
        <Button
          variant="outline"
          className={`auth-provider auth-provider--${provider.id}`}
          disabled={pendingProvider !== null}
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
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
