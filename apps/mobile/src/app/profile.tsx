import { randomUUID } from "expo-crypto";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getNativeDownloads,
  getNativeUploadSources,
  privateFilesReady,
} from "../composition/files";
import { createNativeProfile } from "../composition/profile";
import { getSessionModel } from "../composition/session";
import { createProfileModel } from "../features/profile/model";
import { ProfileScreen } from "../features/profile/ui/ProfileScreen";
import type { SessionModel } from "../features/session/model";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";
export default function ProfileRoute() {
  try {
    return <ConnectedProfile session={getSessionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>앱 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedProfile({ session }: { session: SessionModel }) {
  const model = useMemo(
    () =>
      createProfileModel({
        session,
        createClient: createNativeProfile,
        newId: randomUUID,
        select: async (signal) => {
          await privateFilesReady();
          return getNativeUploadSources().select(signal);
        },
        release: (source) => getNativeUploadSources().release(source),
        discard: (value) => getNativeDownloads().discard(value),
        present: (value, mode, input, ensure) =>
          getNativeDownloads().present(value, mode, input, ensure),
      }),
    [session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void session.refresh();
      return model.start();
    }, [model, session]),
  );
  return (
    <ProfileScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onPublic={(id) => router.push({ pathname: "/lawyer", params: { id } })}
    />
  );
}
