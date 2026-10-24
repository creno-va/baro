import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { createNativeAccount, openNativePolicy } from "../composition/account";
import { getSessionModel } from "../composition/session";
import type { SessionModel } from "../features/session/model";
import { createSettingsModel } from "../features/settings/model";
import { SettingsScreen } from "../features/settings/ui/SettingsScreen";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function SettingsRoute() {
  try {
    return <ConnectedSettings session={getSessionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>앱의 계정 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedSettings({ session }: { session: SessionModel }) {
  const model = useMemo(
    () =>
      createSettingsModel({
        session,
        createClient: createNativeAccount,
        openPolicy: openNativePolicy,
      }),
    [session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const authentication = sessionState.authentication;
  const deletionMode =
    !authentication || authentication.checking
      ? "checking"
      : authentication.error
        ? "unavailable"
        : authentication.contractVersion === 2
          ? "v2"
          : "legacy";
  useFocusEffect(
    useCallback(() => {
      let stop: (() => void) | undefined;
      const start = () => {
        stop?.();
        void session.refresh();
        stop = model.start();
      };
      start();
      const listener = AppState.addEventListener("change", (next) => {
        if (next === "active") start();
        else {
          stop?.();
          stop = undefined;
        }
      });
      return () => {
        listener.remove();
        stop?.();
      };
    }, [model, session]),
  );
  return (
    <SettingsScreen
      state={state}
      actions={model}
      deletionMode={deletionMode}
      onDeletion={() => router.push("/account-deletion")}
      onSession={() => router.push("/session")}
    />
  );
}
