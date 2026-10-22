import { useRouter } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { getSessionModel } from "../composition/session";
import type { SessionModel } from "../features/session/model";
import { SessionScreen } from "../features/session/ui/SessionScreen";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

export default function SessionRoute() {
  try {
    return <ConnectedSession model={getSessionModel()} />;
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
function ConnectedSession({ model }: { model: SessionModel }) {
  const router = useRouter(),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    void model.refresh();
  }, [model]);
  return (
    <SessionScreen
      state={state}
      onRole={model.selectRole}
      onSignIn={(provider) => {
        void model.signIn(provider);
      }}
      onCancel={() => {
        void model.cancelLogin();
      }}
      onRetry={() => {
        void model.refresh();
      }}
      onConsent={(input) => {
        void model.acceptConsent(input);
      }}
      onSignOut={() => {
        void model.signOut();
      }}
      onBrowse={() => router.push("/directory")}
      onPolicy={(policy) => {
        void model.openPolicy(policy);
      }}
      onReauthenticate={(provider) => {
        void model.reauthenticate(provider);
      }}
      onReadReauthentication={() => {
        void model.loadReauthentication();
      }}
    />
  );
}
