import { AppState } from "react-native";
import { bindSessionLifecycle } from "../platform/auth/lifecycle";
import { authReturns } from "./auth-return";
import { getSessionModel } from "./session";

export function startSessionLifecycle() {
  return bindSessionLifecycle({
    model: getSessionModel(),
    returns: authReturns,
    currentState: () => AppState.currentState ?? null,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  });
}
