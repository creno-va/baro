import { useEffect, useRef, useSyncExternalStore } from "react";
import { confirmation, resolveConfirmation, subscribeConfirmation } from "../../client/confirm";
import { applyTheme, themePreference } from "../../client/theme";

export function useExperienceController() {
  const pending = useSyncExternalStore(subscribeConfirmation, confirmation, () => null);
  useEffect(() => {
    applyTheme(themePreference());
    const cancel = () => resolveConfirmation(false);
    const storage = (event: StorageEvent) => {
      if (!event.key || ["baro-session-changed", "better-auth.message"].includes(event.key))
        cancel();
    };
    const observer = new MutationObserver(() => {
      if (confirmation()?.source && !confirmation()?.source?.isConnected) cancel();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("baro-session-changed", cancel);
    window.addEventListener("baro-access-revoked", cancel);
    window.addEventListener("storage", storage);
    window.addEventListener("popstate", cancel);
    window.addEventListener("pagehide", cancel);
    return () => {
      cancel();
      observer.disconnect();
      window.removeEventListener("baro-session-changed", cancel);
      window.removeEventListener("baro-access-revoked", cancel);
      window.removeEventListener("storage", storage);
      window.removeEventListener("popstate", cancel);
      window.removeEventListener("pagehide", cancel);
    };
  }, []);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // A null explicit destination retains Dialog's actual opening-element fallback.
  const returnFocus = useRef<HTMLElement>(null);
  return {
    pending,
    cancelButton,
    returnFocus,
    cancel: () => resolveConfirmation(false),
    discard: () => resolveConfirmation(true),
  };
}
export type ExperienceController = ReturnType<typeof useExperienceController>;
