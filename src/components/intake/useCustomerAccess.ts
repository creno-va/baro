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
  const sessionLookup = useRef<Promise<SessionView> | null>(null);
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
      const lookup = api.session.get();
      sessionLookup.current = lookup;
      try {
        session = await lookup;
      } catch (cause) {
        if (serial !== request.current || !mounted.current) return false;
        if ((cause as { code?: string })?.code === "UNAUTHENTICATED")
          session = { user: null, needsConsent: false };
        else {
          // Keep the draft privately while an external session change is unknown.
          // A normal mutation preflight outage may keep the verified owner's UI.
          allowed.current = !hide && wasAllowed;
          setReady(allowed.current);
          throw cause;
        }
      } finally {
        if (sessionLookup.current === lookup) sessionLookup.current = null;
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
      // A background poll must not supersede a foreground verification and
      // leave its read/retry silently cancelled without an authoritative load.
      if (!document.hidden && !sessionLookup.current)
        void verify().catch((cause) => {
          if (mounted.current) callbacks.current.report(cause);
        });
    }, 15000);
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    const storage = (event: StorageEvent) => {
      if (event.key === "better-auth.message") {
        try {
          const message = JSON.parse(event.newValue ?? "null");
          if (message?.event === "session" && message?.data?.trigger === "signout") {
            deny();
            callbacks.current.report(new ApiError("UNAUTHENTICATED", "로그인이 필요해요."));
            return;
          }
        } catch {
          /* Untrusted messages cannot grant access; verify the server session. */
        }
      }
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
  }, [deny, verify]);
  return { ready, version, verify, ticket, alive, current, deny };
}
