import { type SyntheticEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../client/api";
import { isExplicitSignOut } from "../../client/session-events";
import { createCaseInputController, narrativeLength } from "./controller";

export function useCaseInputController(requireSession: boolean) {
  const requiresSession = useRef(requireSession);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const [controller] = useState(() =>
    createCaseInputController({
      getSession: () => api.session.get(),
      createCase: (input, options) => api.rework.createCase(input, options),
      requireSession: () => requiresSession.current,
      pathname: () => window.location.pathname,
      replace: (href) => window.location.replace(href),
      assign: (href) => window.location.assign(href),
    }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    requiresSession.current = requireSession;
    controller.connect();
    const refresh = () => void controller.loadSession();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const storage = (event: StorageEvent) => {
      if (isExplicitSignOut(event)) return controller.sessionChanged(event);
      if (
        !event.key ||
        ["baro-api-mock-v1:session", "better-auth.message", "baro-session-changed"].includes(
          event.key,
        )
      )
        refresh();
    };
    void controller.loadSession();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", controller.sessionChanged);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.disconnect();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", controller.sessionChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [controller, requireSession]);

  function submit(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    void controller.create();
  }

  return {
    ...state,
    narrativeRef,
    count: narrativeLength(state.narrative),
    canCreate: Boolean(state.session?.user && !state.session.needsConsent),
    submit,
    refresh: () => void controller.loadSession(),
    setNarrative: controller.setNarrative,
    setCasePurpose: controller.setCasePurpose,
    dismissLengthError: () => {
      controller.dismissLengthError();
      // Wait for the Headless dialog's focus trap to unmount before restoring
      // the native composer, including dismissals through Escape/backdrop.
      window.requestAnimationFrame(() => narrativeRef.current?.focus());
    },
  };
}

export type CaseInputController = ReturnType<typeof useCaseInputController>;
