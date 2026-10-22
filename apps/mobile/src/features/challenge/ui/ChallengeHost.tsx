import { useRef, useSyncExternalStore } from "react";
import { Modal, View } from "react-native";
import { WebView } from "react-native-webview";
import type { ChallengeModel } from "../../../platform/challenge/model";
import { Button } from "../../../ui/Button";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";

// The library opens non-whitelisted URLs through Linking before invoking our
// guard. Route every navigation to the explicit guard instead; it denies unknown URLs.
export const CHALLENGE_WEBVIEW_ORIGINS = ["*"];
export function ChallengeHost({ model }: { model: ChallengeModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    web = useRef<WebView<unknown>>(null);
  if (state.kind === "idle") return null;
  const id = state.attemptId;
  return (
    <Modal visible animationType="slide" onRequestClose={() => model.cancel(id)}>
      <Screen scroll={false}>
        <Text variant="heading" accessibilityRole="header">
          보안 확인
        </Text>
        <Text>사건을 저장하기 전에 보안 확인을 완료해 주세요.</Text>
        {state.kind === "preparing" ? (
          <StatePanel
            state={{
              kind: "loading",
              title: "보안 확인을 준비하고 있어요",
              description: "잠시만 기다려 주세요.",
            }}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <WebView<unknown>
              key={id}
              ref={web}
              source={{ uri: state.uri }}
              originWhitelist={CHALLENGE_WEBVIEW_ORIGINS}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled={false}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows
              onShouldStartLoadWithRequest={(request) => model.allowNavigation(id, request)}
              onNavigationStateChange={(navigation) => {
                model.load(id, navigation.url);
                web.current?.injectJavaScript(model.connectScript(id));
              }}
              injectedJavaScript={model.connectScript(id)}
              injectedJavaScriptForMainFrameOnly
              onMessage={(event) => {
                if (model.message(id, event.nativeEvent.url, event.nativeEvent.data) === "connect")
                  web.current?.injectJavaScript(model.connectScript(id));
              }}
              onOpenWindow={() => model.failed(id)}
              onError={() => model.failed(id)}
              onHttpError={() => model.failed(id)}
              onRenderProcessGone={() => model.failed(id)}
              onContentProcessDidTerminate={() => model.failed(id)}
              onFileDownload={() => model.failed(id)}
              renderError={() => <Text>보안 확인을 다시 시도해 주세요.</Text>}
            />
          </View>
        )}
        <Button label="보안 확인 취소" onPress={() => model.cancel(id)} />
      </Screen>
    </Modal>
  );
}
