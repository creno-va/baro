import { router } from "expo-router";
import { AppState } from "react-native";
import { bindSessionLifecycle } from "../platform/auth/lifecycle";
import { bindPrivateFileLifecycle } from "../platform/files/lifecycle";
import { getAccountDeletionModel } from "./account-deletion";
import { authReturns } from "./auth-return";
import { resetPrivateFiles } from "./files";
import { getSessionModel } from "./session";

export function startSessionLifecycle() {
  const model = getSessionModel();
  const deletion = getAccountDeletionModel();
  const stopDeletion = deletion.watchSession();
  const stopFiles = bindPrivateFileLifecycle(model, resetPrivateFiles);
  const stopSession = bindSessionLifecycle({
    model,
    returns: authReturns,
    receiveSpecialReturn: async (raw) => {
      const handled = await deletion.receiveReturn(raw);
      if (handled) {
        try {
          router.replace("/account-deletion");
        } catch {
          /* The result remains available from settings when navigation is not ready. */
        }
      }
      return handled;
    },
    currentState: () => AppState.currentState ?? null,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  });
  return () => {
    stopFiles();
    stopSession();
    stopDeletion();
  };
}
