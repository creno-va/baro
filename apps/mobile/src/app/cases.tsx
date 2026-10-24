import { opaqueIdSchema } from "@baro/contracts/v1";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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
  const params = useLocalSearchParams<{ reviewCaseId?: string }>();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const id = opaqueIdSchema.safeParse(params.reviewCaseId);
    if (id.success && opened.current !== id.data && state.gate === "ready" && !state.busy) {
      opened.current = id.data;
      void model.open(id.data);
    }
  }, [model, params.reviewCaseId, state.gate, state.busy]);
  useFocusEffect(
    useCallback(() => {
      opened.current = null;
      void getSessionModel().refresh();
      return model.start();
    }, [model]),
  );
  return (
    <CasesScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onWorkspace={(caseId) => router.push({ pathname: "/workspace", params: { caseId } })}
      onOpenLink={(url) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
            void WebBrowser.openBrowserAsync(parsed.href).catch(() => {});
        } catch {
          /* Contract-validated HTTPS only. */
        }
      }}
    />
  );
}
