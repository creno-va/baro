import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { getMobileApi } from "../composition/api";
import { readMobileConfig } from "../composition/config";
import { createPublicProfileModel } from "../features/directory/profile";
import { PublicProfileScreen } from "../features/directory/ui/ProfileScreen";
import type { MobileApi } from "../platform/http";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

export default function LawyerRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  try {
    return (
      <ConnectedProfile
        client={getMobileApi()}
        apiOrigin={readMobileConfig().apiBaseUrl}
        id={typeof id === "string" ? id : ""}
      />
    );
  } catch {
    return (
      <Screen>
        <StatePanel
          state={{
            kind: "error",
            title: "앱 설정을 확인해 주세요",
            description: "앱을 다시 열어 주세요.",
          }}
        />
      </Screen>
    );
  }
}
function ConnectedProfile({
  client,
  apiOrigin,
  id,
}: {
  client: MobileApi;
  apiOrigin: string;
  id: string;
}) {
  const model = useMemo(
    () =>
      createPublicProfileModel({
        get: (value, signal) => client.lawyers.get(value, signal),
        apiOrigin,
        openUrl: (url) => Linking.openURL(url),
      }),
    [client, apiOrigin],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void model.load(id);
      const listener = AppState.addEventListener("change", (next) => {
        if (next === "active") void model.load(id);
        else model.stop();
      });
      return () => {
        listener.remove();
        model.stop();
      };
    }, [model, id]),
  );
  return (
    <PublicProfileScreen
      state={state}
      onRefresh={() => {
        void model.load(id);
      }}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/directory");
      }}
      onOpen={(action) => {
        void model.open(action);
      }}
    />
  );
}
