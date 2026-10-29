import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { SessionView } from "../../client/api/types";
import { isExplicitSignOut } from "../../client/session-events";

/** Private workspace boundary for both account types; revoke old owner responses. */
export function useCustomerAccess(
  purge: () => void,
  report: (error: unknown) => void,
  readAccess = false,
) {
  const callbacks = useRef({ purge, report });
  callbacks.current = { purge, report };
  const identity = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const request = useRef(0);
  const sessionLookup = useRef<Promise<SessionView> | null>(null);
  const latestCheck = useRef<Promise<SessionView | null> | null>(null);
  const allowed = useRef(false);
  const [canMutate, setCanMutate] = useState(false);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const ticket = useCallback(() => epoch.current, []);
  const alive = useCallback((value: number) => mounted.current && epoch.current === value, []);
  const current = useCallback((value: number) => alive(value) && allowed.current, [alive]);
  const revoke = useCallback(() => {
    ++epoch.current;
    allowed.current = false;
    setReady(false);
    setCanMutate(false);
    callbacks.current.purge();
  }, []);
  const deny = useCallback(() => {
    // A pending response from before explicit sign-out cannot grant access again.
    ++request.current;
    latestCheck.current = null;
    sessionLookup.current = null;
    revoke();
  }, [revoke]);
  const verify = useCallback(
    async (hide = false, write = !readAccess) => {
      const serial = ++request.current;
      const wasAllowed = allowed.current;
      if (hide) {
        allowed.current = false;
        setReady(false);
      }
      const check = async (): Promise<SessionView | null> => {
        let session: SessionView;
        const lookup = api.session.get();
        sessionLookup.current = lookup;
        try {
          session = await lookup;
        } catch (cause) {
          if (serial !== request.current || !mounted.current) return null;
          if ((cause as { code?: string })?.code === "UNAUTHENTICATED")
            session = { user: null, needsConsent: false };
          else {
            // Only the newest check may restore the owner's UI after an outage.
            allowed.current = !hide && wasAllowed;
            setReady(allowed.current);
            throw cause;
          }
        } finally {
          if (sessionLookup.current === lookup) sessionLookup.current = null;
        }
        if (serial !== request.current || !mounted.current) return null;
        const next = JSON.stringify([
          session.user?.id,
          session.user?.accountType,
          readAccess ? null : session.needsConsent,
        ]);
        if (identity.current !== undefined && identity.current !== next) {
          revoke();
          if (!hide) setVersion((value) => value + 1);
        }
        identity.current = next;
        if (!session.user || (session.needsConsent && !readAccess)) {
          revoke();
          const error = new ApiError(
            !session.user
              ? "UNAUTHENTICATED"
              : session.needsConsent
                ? "CONSENT_REQUIRED"
                : "NOT_FOUND",
            "로그인하고 사건을 다시 열어 주세요.",
          );
          callbacks.current.report(error);
          throw error;
        }
        setCanMutate(!session.needsConsent);
        allowed.current = true;
        setReady(true);
        return session;
      };
      let pending: Promise<SessionView | null> | null = check();
      latestCheck.current = pending;
      // Focus/visibility may supersede this preflight. Follow the newest check,
      // including one that has already settled, rather than silently cancelling.
      while (pending) {
        let session: SessionView | null;
        try {
          session = await pending;
        } catch (cause) {
          if (pending === latestCheck.current) throw cause;
          pending = latestCheck.current;
          continue;
        }
        if (pending !== latestCheck.current) {
          pending = latestCheck.current;
          continue;
        }
        if (!session || !mounted.current || !allowed.current) return false;
        // A read-only focus check cannot satisfy a write's consent requirement.
        if (session.needsConsent && write) {
          const error = new ApiError(
            "CONSENT_REQUIRED",
            "고객 계정으로 로그인하고 사건을 다시 열어 주세요.",
          );
          callbacks.current.report(error);
          throw error;
        }
        return true;
      }
      return false;
    },
    [revoke, readAccess],
  );
  useEffect(() => {
    mounted.current = true;
    let refreshing = false;
    const refresh = (hide = false) => {
      // Browsers emit focus, pageshow and visibility together. One foreground
      // check preserves the editor while explicit peer changes still hide it.
      if (refreshing && !hide) return;
      refreshing = true;
      void verify(hide)
        .then((ok) => {
          if (ok) setVersion((value) => value + 1);
        })
        .catch((cause) => {
          if (mounted.current) callbacks.current.report(cause);
        })
        .finally(() => {
          refreshing = false;
        });
    };
    const foreground = () => refresh();
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
    refresh(true);
    window.addEventListener("focus", foreground);
    window.addEventListener("pageshow", foreground);
    const changed = (event: Event) => {
      if (!isExplicitSignOut(event)) return refresh(true);
      deny();
      callbacks.current.report(new ApiError("UNAUTHENTICATED", "로그인이 필요해요."));
    };
    const storage = (event: StorageEvent) => {
      if (isExplicitSignOut(event)) return changed(event);
      if (
        !event.key ||
        event.key === "baro-api-mock-v1:session" ||
        event.key === "better-auth.message" ||
        event.key === "baro-session-changed"
      )
        refresh(true);
    };
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      ++request.current;
      ++epoch.current;
      latestCheck.current = null;
      sessionLookup.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("pageshow", foreground);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [deny, verify]);
  return { ready, canMutate, version, verify, ticket, alive, current, deny };
}
