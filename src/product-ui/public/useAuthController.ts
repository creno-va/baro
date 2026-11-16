import { useEffect, useRef, useState } from "react";
import { api, apiMode, errorMessage } from "../../client/api";
import { sessionDestination } from "../../client/return-path";
import type { Provider } from "./ProviderIcon";

export function useAuthController() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
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
      const result = await api.session.signIn(provider);
      if (result) window.location.assign(sessionDestination(result));
      return;
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setPendingProvider(null);
  }

  return { ready, pendingProvider, error, lastButton, signIn, mock: apiMode === "mock" };
}
export type AuthController = ReturnType<typeof useAuthController>;
