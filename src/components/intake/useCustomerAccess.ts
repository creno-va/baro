import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { SessionView } from "../../client/api/types";

/** Customer screen boundary: revoke old responses without discarding drafts on outages. */
export function useCustomerAccess(purge: () => void, report: (error: unknown) => void) {
  const callbacks = useRef({ purge, report });
  callbacks.current = { purge, report };
  const identity = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const request = useRef(0);
  const allowed = useRef(false);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const ticket = useCallback(() => epoch.current, []);
  const alive = useCallback((value: number) => mounted.current && epoch.current === value, []);
  const current = useCallback((value: number) => alive(value) && allowed.current, [alive]);
  const deny = useCallback(() => {
    ++epoch.current;
    allowed.current = false;
    setReady(false);
    callbacks.current.purge();
  }, []);
  const verify = useCallback(
    async (hide = false) => {
      const serial = ++request.current;
      const wasAllowed = allowed.current;
      if (hide) {
        allowed.current = false;
        setReady(false);
      }
      let session: SessionView;
      try {
        session = await api.session.get();
      } catch (cause) {
        if (serial !== request.current || !mounted.current) return false;
        if ((cause as { code?: string })?.code === "UNAUTHENTICATED")
          session = { user: null, needsConsent: false };
        else {
          allowed.current = wasAllowed;
          setReady(wasAllowed);
          throw cause;
        }
      }
      if (serial !== request.current || !mounted.current) return false;
      const next = JSON.stringify([
        session.user?.id,
        session.user?.accountType,
        session.needsConsent,
      ]);
      if (identity.current !== undefined && identity.current !== next) {
        deny();
        if (!hide) setVersion((value) => value + 1);
      }
      identity.current = next;
      if (!session.user || session.needsConsent || session.user.accountType !== "customer") {
        deny();
        const error = new ApiError(
          !session.user
            ? "UNAUTHENTICATED"
            : session.needsConsent
              ? "CONSENT_REQUIRED"
              : "NOT_FOUND",
          "고객 계정으로 로그인하고 사건을 다시 열어 주세요.",
        );
        callbacks.current.report(error);
        throw error;
      }
      allowed.current = true;
      setReady(true);
      return true;
    },
    [deny],
  );
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      void verify(true)
        .then((ok) => {
          if (ok) setVersion((value) => value + 1);
        })
        .catch((cause) => {
          if (mounted.current) callbacks.current.report(cause);
        });
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    // Real sessions use cookies; focus/visibility and periodic verification cover peer tabs.
    const timer = window.setInterval(() => {
      if (!document.hidden)
        void verify().catch((cause) => {
          if (mounted.current) callbacks.current.report(cause);
        });
    }, 15000);
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    const storage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === "baro-api-mock-v1:session" ||
        event.key === "better-auth.message" ||
        event.key === "baro-session-changed"
      )
        refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      ++request.current;
      ++epoch.current;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [verify]);
  return { ready, version, verify, ticket, alive, current, deny };
}
