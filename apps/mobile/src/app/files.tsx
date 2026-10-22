import { opaqueIdSchema } from "@baro/contracts/common";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  createNativeFiles,
  getNativeDownloads,
  getNativeUploadSources,
  privateFilesReady,
  resetPrivateFiles,
} from "../composition/files";
import { getSessionModel } from "../composition/session";
import { createFilesModel } from "../features/files/model";
import { FilesScreen } from "../features/files/ui/FilesScreen";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function FilesRoute() {
  const params = useLocalSearchParams<{ caseId?: string }>(),
    parsed = opaqueIdSchema.safeParse(params.caseId);
  if (!parsed.success)
    return (
      <Screen>
        <Text>사건 주소를 확인해 주세요.</Text>
      </Screen>
    );
  try {
    return <Connected key={parsed.data} id={parsed.data} />;
  } catch {
    return (
      <Screen>
        <Text>앱 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function Connected({ id }: { id: string }) {
  const router = useRouter(),
    session = getSessionModel();
  const model = useMemo(
    () =>
      createFilesModel({
        caseId: id,
        session,
        createClient: createNativeFiles,
        pick: async (signal) => {
          await privateFilesReady();
          signal.throwIfAborted();
          return getNativeUploadSources().select(signal);
        },
        release: (source) => getNativeUploadSources().release(source),
        discard: (value) => getNativeDownloads().discard(value),
        present: (value, mode, file, ensure) =>
          getNativeDownloads().present(
            value,
            mode,
            { name: file.name, mimeType: file.mimeType },
            ensure,
          ),
        clear: resetPrivateFiles,
      }),
    [id, session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void session.refresh();
      return model.start();
    }, [model, session]),
  );
  return (
    <FilesScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onReports={() => router.replace({ pathname: "/reports", params: { caseId: id } })}
      onWorkspace={() => router.replace({ pathname: "/workspace", params: { caseId: id } })}
    />
  );
}
