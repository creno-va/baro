import { opaqueIdSchema } from "@baro/contracts/common";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getNativeDownloads, resetPrivateFiles } from "../composition/files";
import { createNativeReports } from "../composition/reports";
import { getSessionModel } from "../composition/session";
import { createReportsModel } from "../features/reports/model";
import { ReportsScreen } from "../features/reports/ui/ReportsScreen";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function ReportsRoute() {
  const params = useLocalSearchParams<{ caseId?: string }>(),
    parsed = opaqueIdSchema.safeParse(params.caseId);
  if (!parsed.success)
    return (
      <Screen>
        <Text>사건 주소를 확인해 주세요.</Text>
      </Screen>
    );
  return <Connected key={parsed.data} id={parsed.data} />;
}
function Connected({ id }: { id: string }) {
  const router = useRouter(),
    session = getSessionModel();
  const model = useMemo(
    () =>
      createReportsModel({
        caseId: id,
        session,
        createClient: createNativeReports,
        discard: (value) => getNativeDownloads().discard(value),
        present: (value, mode, input, ensure) =>
          getNativeDownloads().present(value, mode, input, ensure),
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
    <ReportsScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onWorkspace={() => router.replace({ pathname: "/workspace", params: { caseId: id } })}
      onFiles={() => router.replace({ pathname: "/files", params: { caseId: id } })}
    />
  );
}
