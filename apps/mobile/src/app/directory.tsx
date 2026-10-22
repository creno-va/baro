import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getMobileApi } from "../composition/api";
import { createDirectoryModel } from "../features/directory/model";
import { DirectoryScreen } from "../features/directory/ui/DirectoryScreen";
import type { MobileApi } from "../platform/http";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

export default function DirectoryRoute() {
  try {
    return <ConnectedDirectory client={getMobileApi()} />;
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
function ConnectedDirectory({ client }: { client: MobileApi }) {
  const model = useMemo(() => createDirectoryModel(client.directory), [client]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    void model.search("");
    return model.stop;
  }, [model]);
  return (
    <DirectoryScreen
      state={state}
      onSearch={(query) => {
        void model.search(query);
      }}
      onMore={() => {
        void model.more();
      }}
      onRetry={() => {
        void model.retry();
      }}
      onRefresh={() => {
        void model.search(state.query);
      }}
    />
  );
}
