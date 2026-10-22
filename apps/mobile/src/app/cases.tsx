import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createNativeCases } from "../composition/cases";
import { getSessionModel } from "../composition/session";
import { type CasesModel, createCasesModel } from "../features/cases/model";
import { CasesScreen } from "../features/cases/ui/CasesScreen";
import type { SessionModel } from "../features/session/model";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function CasesRoute() {
  try {
    return <ConnectedCases session={getSessionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>앱 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedCases({ session }: { session: SessionModel }) {
  const model = useMemo(
    () => createCasesModel({ session, createClient: createNativeCases }),
    [session],
  );
  return <ObservedCases model={model} />;
}
function ObservedCases({ model }: { model: CasesModel }) {
  const router = useRouter(),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void getSessionModel().refresh();
      return model.start();
    }, [model]),
  );
  return <CasesScreen state={state} actions={model} onSession={() => router.push("/session")} />;
}
