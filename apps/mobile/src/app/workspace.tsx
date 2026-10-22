import { opaqueIdSchema } from "@baro/contracts/v1";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getSessionModel } from "../composition/session";
import { createNativeWorkspace } from "../composition/workspace";
import type { SessionModel } from "../features/session/model";
import { createWorkspaceModel } from "../features/workspace/model";
import { WorkspaceScreen } from "../features/workspace/ui/WorkspaceScreen";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

export default function WorkspaceRoute() {
  const params = useLocalSearchParams<{ caseId?: string }>();
  const id = opaqueIdSchema.safeParse(params.caseId);
  if (!id.success)
    return (
      <Screen>
        <Text>사건 주소를 확인해 주세요.</Text>
      </Screen>
    );
  try {
    return <ConnectedWorkspace key={id.data} caseId={id.data} session={getSessionModel()} />;
  } catch {
    return (
      <Screen>
        <Text>앱 설정을 확인하지 못했어요. 앱을 다시 열어 주세요.</Text>
      </Screen>
    );
  }
}
function ConnectedWorkspace({ caseId, session }: { caseId: string; session: SessionModel }) {
  const router = useRouter();
  const model = useMemo(
    () => createWorkspaceModel({ caseId, session, createClient: createNativeWorkspace }),
    [caseId, session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      void session.refresh();
      return model.start();
    }, [model, session]),
  );
  return (
    <WorkspaceScreen
      state={state}
      actions={model}
      onSession={() => router.push("/session")}
      onReview={() => router.push({ pathname: "/cases", params: { reviewCaseId: caseId } })}
      onCitation={(url) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
            void WebBrowser.openBrowserAsync(parsed.href).catch(() => {});
        } catch {
          /* Validated URLs only; never fall back to custom schemes. */
        }
      }}
    />
  );
}
