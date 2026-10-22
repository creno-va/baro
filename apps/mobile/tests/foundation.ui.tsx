import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GuideScreen } from "../src/features/foundation/ui/GuideScreen";
import { WelcomeScreen } from "../src/features/foundation/ui/WelcomeScreen";
import { Button } from "../src/ui/Button";
import { StatePanel } from "../src/ui/StatePanel";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function wrapper({ children }: { children: ReactNode }) {
  return <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;
}

test("welcome exposes implemented login and public navigation through commands", async () => {
  const onContinue = jest.fn();
  const onSignIn = jest.fn();
  await render(
    <WelcomeScreen
      model={{ kind: "available", questionHint: "합성 질문 안내" }}
      onContinue={onContinue}
      onSignIn={onSignIn}
    />,
    { wrapper },
  );
  await fireEvent.press(screen.getByRole("button", { name: "이용 안내 보기" }));
  expect(onContinue).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "로그인·내 계정" }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

test("invalid configuration blocks navigation and shows a safe error", async () => {
  await render(
    <WelcomeScreen
      model={{ kind: "configuration-error", message: "앱을 다시 열어 주세요." }}
      onContinue={jest.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByRole("header", { name: "앱을 열 수 없어요" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "이용 안내 보기" })).toBeNull();
});

test("retry belongs only to an error with an explicit action", async () => {
  const retry = jest.fn();
  const view = await render(
    <StatePanel
      state={{
        kind: "error",
        title: "연결 실패",
        description: "다시 시도해 주세요.",
        retry: { label: "다시 시도", run: retry },
      }}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(
    <StatePanel
      state={{ kind: "loading", title: "불러오는 중", description: "잠시 기다려 주세요." }}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByLabelText("불러오는 중")).toBeTruthy();
  await view.rerender(
    <StatePanel
      state={{ kind: "ready", title: "확인했어요", description: "저장된 내용을 확인해 주세요." }}
    />,
  );
  expect(screen.queryByLabelText("불러오는 중")).toBeNull();
});

test("disabled controls cannot trigger commands and guide can return home", async () => {
  const command = jest.fn();
  const view = await render(<Button label="저장" disabled onPress={command} />);
  await fireEvent.press(screen.getByRole("button", { name: "저장" }));
  expect(command).not.toHaveBeenCalled();
  await view.rerender(<GuideScreen onBack={command} />);
  // Guide route is also exercised by the native bundle; rendering keeps its action testable.
  await fireEvent.press(screen.getByRole("button", { name: "처음으로" }));
  expect(command).toHaveBeenCalledTimes(1);
});
