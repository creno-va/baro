import { AppState } from "react-native";
import { bindSessionLifecycle } from "../platform/auth/lifecycle";
import { bindPrivateFileLifecycle } from "../platform/files/lifecycle";
import { authReturns } from "./auth-return";
import { resetPrivateFiles } from "./files";
import { getSessionModel } from "./session";

export function startSessionLifecycle() {
  const model = getSessionModel();
  const stopFiles = bindPrivateFileLifecycle(model, resetPrivateFiles);
  const stopSession = bindSessionLifecycle({
    model,
    returns: authReturns,
    currentState: () => AppState.currentState ?? null,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  });
  return () => {
    stopFiles();
    stopSession();
  };
}
