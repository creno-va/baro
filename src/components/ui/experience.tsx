import { useEffect, useSyncExternalStore } from "react";
import { confirmation, resolveConfirmation, subscribeConfirmation } from "../../client/confirm";
import { applyTheme, themePreference } from "../../client/theme";
import { Button } from "./button";
import { Dialog } from "./dialog";
export function Experience() {
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
  return (
    <Dialog
      open={Boolean(pending)}
      title="작성한 내용을 확인해 주세요"
      onOpenChange={(open) => {
        if (!open) resolveConfirmation(false);
      }}
      description={pending?.message}
    >
      <div className="ui-dialog__actions">
        <Button variant="outline" autoFocus onClick={() => resolveConfirmation(false)}>
          계속 작성하기
        </Button>
        <Button variant="destructive" onClick={() => resolveConfirmation(true)}>
          변경 버리기
        </Button>
      </div>
    </Dialog>
  );
}
