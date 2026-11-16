import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { browserSessionScope } from "../api/context";
import { sessionApi } from "../api/session";
import { isExplicitSignOut } from "../session-events";
import { createWebQueryClient } from "./client";
import { createWebSessionController, type WebSessionSnapshot } from "./resources";

export type WebSession = WebSessionSnapshot & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const WebSessionContext = createContext<WebSession | null>(null);

export function WebQueryProvider({ children }: { children: ReactNode }) {
  const [{ client, controller }] = useState(() => {
    let accessFailure = () => {};
    const client = createWebQueryClient(() => accessFailure());
    const controller = createWebSessionController({
      client,
      readSession: () => sessionApi.get(),
      invalidateTransport: () => browserSessionScope.invalidate(),
      signOut: () => sessionApi.signOut(),
    });
    accessFailure = () => {
      controller.invalidate();
      void controller.refresh();
    };
    return { client, controller };
  });
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "visible") void controller.refresh();
    };
    const onSessionChanged = (event: Event) => {
      const signedOut = isExplicitSignOut(event);
      controller.invalidate(signedOut);
      if (!signedOut) void controller.refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "baro-session-changed" ||
        event.key === "better-auth.message"
      )
        onSessionChanged(event);
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("baro-session-changed", onSessionChanged);
    window.addEventListener("storage", onStorage);
    // Browser bfcache may preserve private DOM until a fresh authorization check.
    const conceal = () => controller.invalidate();
    window.addEventListener("pagehide", conceal);
    void controller.refresh();
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("baro-session-changed", onSessionChanged);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", conceal);
      controller.invalidate();
    };
  }, [controller]);
  const value = useMemo(
    () => ({ ...snapshot, refresh: controller.refresh, signOut: controller.signOut }),
    [snapshot, controller],
  );
  return (
    <QueryClientProvider client={client}>
      <WebSessionContext.Provider value={value}>{children}</WebSessionContext.Provider>
    </QueryClientProvider>
  );
}

export function useWebSession() {
  const session = useContext(WebSessionContext);
  if (!session) throw new Error("WebQueryProvider is required");
  return session;
}
