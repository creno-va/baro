import { opaqueIdSchema } from "@baro/contracts/common";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { createNativePrecedents } from "../composition/precedents";
import { getSessionModel } from "../composition/session";
import { createPrecedentsModel } from "../features/precedents/model";
import { PrecedentsScreen } from "../features/precedents/ui/PrecedentsScreen";
import type { SessionModel } from "../features/session/model";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function PrecedentsRoute() {
  const params = useLocalSearchParams<{ caseId?: string | string[] }>();
  const id = opaqueIdSchema.safeParse(params.caseId);
  if (!id.success)
    return (
      <Screen>
        <Text>사건 주소를 확인해 주세요.</Text>
      </Screen>
    );
  try {
    return <ConnectedPrecedents key={id.data} caseId={id.data} session={getSessionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>앱 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedPrecedents({ caseId, session }: { caseId: string; session: SessionModel }) {
  const model = useMemo(
    () =>
      createPrecedentsModel({
        caseId,
        session,
        createClient: createNativePrecedents,
        openUrl: (url) => Linking.openURL(url),
      }),
    [caseId, session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
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
    <PrecedentsScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onReview={() => router.push({ pathname: "/cases", params: { reviewCaseId: caseId } })}
    />
  );
}
