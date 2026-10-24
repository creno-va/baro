import { router, useFocusEffect } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getAccountDeletionModel } from "../composition/account-deletion";
import type { AccountDeletionModel } from "../features/account-deletion/model";
import { AccountDeletionScreen } from "../features/account-deletion/ui/AccountDeletionScreen";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function AccountDeletionRoute() {
  try {
    return <ConnectedDeletion model={getAccountDeletionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>계정 삭제 화면을 열지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedDeletion({ model }: { model: AccountDeletionModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      let stop: (() => void) | undefined;
      const start = () => {
        stop?.();
        stop = model.activate();
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
    }, [model]),
  );
  return (
    <AccountDeletionScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onLegacy={() => router.replace("/settings")}
    />
  );
}
