import { createSessionScope } from "@baro/client-core";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createOnShouldStartLoadWithRequest } from "react-native-webview/lib/WebViewShared";
import { resolveMobileConfig } from "../config/environment";
import {
  CHALLENGE_WEBVIEW_ORIGINS,
  ChallengeHost,
} from "../src/features/challenge/ui/ChallengeHost";
import { createChallengeModel } from "../src/platform/challenge/model";

const mockInject = jest.fn();
jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    WebView: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
      return <View {...props} testID="challenge-web" />;
    }),
  };
});
const id = "71e770bb-933a-450a-9fe3-512710a708bc",
  secret = "s".repeat(43);
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}
function fixture(newSecret = async () => secret) {
  const model = createChallengeModel({
    scope: createSessionScope(),
    config: resolveMobileConfig({ environment: "preview" }),
    newId: () => id,
    newSecret,
    schedule: () => () => {},
  });
  return model;
}

test("preparing can be cancelled and late native entropy cannot mount a WebView", async () => {
  let release!: (value: string) => void;
  const model = fixture(
    () =>
      new Promise<string>((done) => {
        release = done;
      }),
  );
  const pending = model.request();
  void pending.catch(() => {});
  await render(<ChallengeHost model={model} />, { wrapper });
  expect(screen.getByText("보안 확인을 준비하고 있어요")).toBeTruthy();
  expect(screen.queryByTestId("challenge-web")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "보안 확인 취소" }));
  await expect(pending).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await act(async () => release(secret));
  expect(screen.queryByTestId("challenge-web")).toBeNull();
});

test("only the loaded canonical page receives the secret; valid proof dismisses the native modal", async () => {
  const model = fixture(),
    pending = model.request();
  await Promise.resolve();
  await render(<ChallengeHost model={model} />, { wrapper });
  const web = screen.getByTestId("challenge-web"),
    uri = web.props.source.uri;
  expect(web.props.source).toEqual({ uri });
  expect(uri).not.toContain(secret);
  expect(web.props.sharedCookiesEnabled).toBe(false);
  expect(web.props.injectedJavaScript).toBe("true;");
  await fireEvent(web, "navigationStateChange", { url: uri });
  expect(mockInject).toHaveBeenLastCalledWith(
    expect.stringContaining(`window.location.href===${JSON.stringify(uri)}`),
  );
  await fireEvent(web, "message", {
    nativeEvent: {
      url: uri,
      data: JSON.stringify({ type: "ready", attemptId: id }),
    },
  });
  expect(mockInject).toHaveBeenLastCalledWith(expect.stringContaining(secret));
  await fireEvent(web, "message", {
    nativeEvent: {
      url: uri,
      data: JSON.stringify({ type: "token", attemptId: id, secret, token: "synthetic-proof" }),
    },
  });
  expect(await pending).toBe("synthetic-proof");
  expect(screen.queryByTestId("challenge-web")).toBeNull();
});

test("the actual WebView navigation helper never opens denied external URLs through Linking", async () => {
  const model = fixture(),
    pending = model.request();
  void pending.catch(() => {});
  await Promise.resolve();
  const canOpen = jest.spyOn(Linking, "canOpenURL").mockResolvedValue(true),
    open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined),
    load = jest.fn(),
    navigation = createOnShouldStartLoadWithRequest(load, CHALLENGE_WEBVIEW_ORIGINS, (request) =>
      model.allowNavigation(id, request),
    );
  for (const url of ["https://foreign.invalid", "intent://synthetic", "file:///synthetic"])
    navigation({
      bubbles: false,
      cancelable: true,
      currentTarget: 0,
      defaultPrevented: false,
      dispatchConfig: { registrationName: "onShouldStartLoadWithRequest" },
      eventPhase: 2,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      isTrusted: true,
      persist: jest.fn(),
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: 0,
      timeStamp: 0,
      type: "shouldStartLoad",
      nativeEvent: {
        url,
        lockIdentifier: 1,
        isTopFrame: true,
        mainDocumentURL: url,
        navigationType: "click",
        loading: false,
        title: "",
        canGoBack: false,
        canGoForward: false,
      },
    });
  await Promise.resolve();
  expect(load.mock.calls).toEqual([
    [false, "https://foreign.invalid", 1],
    [false, "intent://synthetic", 1],
    [false, "file:///synthetic", 1],
  ]);
  expect(canOpen).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  canOpen.mockRestore();
  open.mockRestore();
  model.cancel();
  await expect(pending).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});

test("web process failures close proof UI without displaying raw native diagnostics", async () => {
  const model = fixture(),
    pending = model.request();
  void pending.catch(() => {});
  await Promise.resolve();
  await render(<ChallengeHost model={model} />, { wrapper });
  await fireEvent(screen.getByTestId("challenge-web"), "error", {
    nativeEvent: {
      description: "SYNTHETIC_PRIVATE_NATIVE_DIAGNOSTIC",
    },
  });
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(screen.queryByText("SYNTHETIC_PRIVATE_NATIVE_DIAGNOSTIC")).toBeNull();
  expect(screen.queryByTestId("challenge-web")).toBeNull();
});
