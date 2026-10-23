import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { tokens } from "../src/theme/tokens";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { Choice } from "../src/ui/Choice";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";

const long = "긴 한글 자료의 이름과 공개·개인정보 확인 내용을 빠짐없이 읽고 계속 진행하기";
const dimensions = { window: Dimensions.get("window"), screen: Dimensions.get("screen") };
afterEach(async () => {
  await act(() => {
    Dimensions.set(dimensions);
  });
  jest.restoreAllMocks();
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

test("long action labels scale without line/height caps; primary pressed state retains opaque readable text and disabled actions never dispatch", async () => {
  const onPress = jest.fn();
  const view = await render(<Button label={long} variant="primary" onPress={onPress} />);
  const label = screen.getByText(long),
    button = screen.getByRole("button", { name: long });
  expect(label.props.allowFontScaling).toBe(true);
  expect(label.props.maxFontSizeMultiplier).toBe(0);
  expect(label.props.numberOfLines).toBeUndefined();
  expect(label.props.adjustsFontSizeToFit).toBeUndefined();
  const controlStyle = StyleSheet.flatten(button.props.style),
    textStyle = StyleSheet.flatten(label.props.style);
  expect(controlStyle.minHeight).toBeGreaterThanOrEqual(48);
  expect(controlStyle.height).toBeUndefined();
  expect(textStyle.flexShrink).toBe(1);
  const touch = {
    persist() {},
    currentTarget: { measure() {} },
    nativeEvent: {
      target: 0,
      timestamp: Date.now(),
      touches: [],
      changedTouches: [],
      locationX: 0,
      locationY: 0,
      pageX: 0,
      pageY: 0,
    },
  };
  await fireEvent(button, "responderGrant", {
    ...touch,
    dispatchConfig: { registrationName: "onResponderGrant" },
  });
  expect(StyleSheet.flatten(screen.getByRole("button", { name: long }).props.style)).toMatchObject({
    backgroundColor: tokens.color.primaryPressed,
  });
  expect(
    StyleSheet.flatten(screen.getByRole("button", { name: long }).props.style).opacity,
  ).toBeUndefined();
  expect(textStyle.color).toBe(tokens.color.onPrimary);
  await fireEvent(button, "responderRelease", {
    ...touch,
    dispatchConfig: { registrationName: "onResponderRelease" },
  });
  onPress.mockClear();
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  for (const variant of ["primary", "secondary", "danger"] as const) {
    await view.rerender(<Button label={long} variant={variant} disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button", { name: long }));
    expect(StyleSheet.flatten(screen.getByText(long).props.style).color).toBe(tokens.color.muted);
  }
  expect(onPress).toHaveBeenCalledTimes(1);
});
test("selection is announced as checked radio/checkbox with a complete label, visible symbol and disabled input protection", async () => {
  const select = jest.fn();
  const view = await render(<Choice label={long} checked={false} kind="radio" onPress={select} />);
  expect(screen.getByRole("radio", { name: long }).props.accessibilityState.checked).toBe(false);
  await fireEvent.press(screen.getByRole("radio", { name: long }));
  expect(select).toHaveBeenCalledTimes(1);
  await view.rerender(<Choice label={long} checked disabled onPress={select} />);
  const check = screen.getByRole("checkbox", { name: long });
  expect(check.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  expect(StyleSheet.flatten(check.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  await fireEvent.press(check);
  expect(select).toHaveBeenCalledTimes(1);
});
test("multiline field keeps scaling/visible label, native top alignment, focus feedback and caller callbacks/styles; readonly cannot change", async () => {
  const onFocus = jest.fn(),
    onBlur = jest.fn(),
    onChange = jest.fn();
  const view = await render(
    <TextField
      label="긴 사실관계"
      multiline
      value={long}
      onChangeText={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{ marginTop: 8 }}
    />,
  );
  const field = screen.getByLabelText("긴 사실관계");
  expect(field.props.allowFontScaling).toBe(true);
  expect(field.props.maxFontSizeMultiplier).toBe(0);
  expect(StyleSheet.flatten(field.props.style)).toMatchObject({
    textAlignVertical: "top",
    minHeight: 120,
    marginTop: 8,
    borderColor: tokens.color.controlBorder,
  });
  await fireEvent(field, "focus", { nativeEvent: { target: 1 } });
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(StyleSheet.flatten(screen.getByLabelText("긴 사실관계").props.style)).toMatchObject({
    borderColor: tokens.color.primary,
    borderWidth: 2,
  });
  await fireEvent(field, "blur", { nativeEvent: { target: 1 } });
  expect(onBlur).toHaveBeenCalledTimes(1);
  await view.rerender(
    <TextField
      label="긴 사실관계"
      multiline
      value={long}
      editable={false}
      onChangeText={onChange}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText("긴 사실관계"), "바꾸려는 입력");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("긴 사실관계").props.accessibilityState.disabled).toBe(true);
});
test("narrow and rotated large-font shells retain full content, responsive padding, native insets and scroll/list ownership", async () => {
  await act(() => {
    Dimensions.set({
      window: { width: 320, height: 844, scale: 2, fontScale: 2 },
      screen: { width: 320, height: 844, scale: 2, fontScale: 2 },
    });
  });
  const view = await render(
    <Screen keyboardOffset={88}>
      <Card>
        <Text variant="title">{long}</Text>
        <Button label="마지막 안내 확인" onPress={jest.fn()} />
      </Card>
    </Screen>,
    { wrapper },
  );
  const scroll = view.container.queryAll(
    (node) => node.props.keyboardShouldPersistTaps === "handled",
  )[0];
  expect(scroll).toBeDefined();
  expect(StyleSheet.flatten(scroll?.props.contentContainerStyle)).toMatchObject({
    paddingHorizontal: 16,
    maxWidth: 720,
    flexGrow: 1,
  });
  expect(scroll?.props.keyboardShouldPersistTaps).toBe("handled");
  expect(scroll?.props.keyboardDismissMode).toBe(Platform.OS === "ios" ? "interactive" : "on-drag");
  const safe = view.container.queryAll((node) => !!node.props.edges)[0];
  expect(safe?.props.edges).toEqual({
    top: "off",
    left: "additive",
    right: "additive",
    bottom: "additive",
  });
  expect(screen.getByText(long).props.maxFontSizeMultiplier).toBe(0);
  expect(screen.getByRole("button", { name: "마지막 안내 확인" })).toBeTruthy();
  await act(() => {
    Dimensions.set({
      window: { width: 844, height: 390, scale: 2, fontScale: 2 },
      screen: { width: 844, height: 390, scale: 2, fontScale: 2 },
    });
  });
  expect(
    StyleSheet.flatten(
      view.container.queryAll((node) => node.props.keyboardShouldPersistTaps === "handled")[0]
        ?.props.contentContainerStyle,
    ).paddingHorizontal,
  ).toBe(32);
  await view.rerender(
    <Screen scroll={false}>
      <Text>목록이 스크롤을 소유해요</Text>
    </Screen>,
  );
  expect(
    view.container.queryAll((node) => node.props.keyboardShouldPersistTaps === "handled"),
  ).toHaveLength(0);
  expect(screen.getByText("목록이 스크롤을 소유해요")).toBeTruthy();
});

test("disclosure opens only presentation, keeps the complete label/state and never dispatches a child action automatically", async () => {
  const { Disclosure } = require("../src/ui/Disclosure") as typeof import("../src/ui/Disclosure");
  const command = jest.fn();
  await render(
    <Disclosure
      title={long}
      summary="필요할 때 확인해 주세요."
      preview={<Text>저장된 읽기 내용</Text>}
    >
      <Button label="명시적 요청" onPress={command} />
    </Disclosure>,
  );
  const control = screen.getByRole("button", { name: long });
  expect(control.props.accessibilityState.expanded).toBe(false);
  expect(screen.getByText("저장된 읽기 내용")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "명시적 요청" })).toBeNull();
  await fireEvent.press(control);
  expect(screen.getByRole("button", { name: long }).props.accessibilityState.expanded).toBe(true);
  expect(command).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "명시적 요청" }));
  expect(command).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: long }));
  expect(screen.getByText("저장된 읽기 내용")).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(1);
});
test("critical disclosure stays exposed through a pending state and remains open when the pending state resolves until a deliberate close", async () => {
  const { Disclosure } = require("../src/ui/Disclosure") as typeof import("../src/ui/Disclosure");
  const view = await render(
    <Disclosure title="요청 결과" summary="확인 중이에요." keepOpen>
      <Text>확인해야 할 결과</Text>
    </Disclosure>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "요청 결과" }));
  expect(screen.getByText("확인해야 할 결과")).toBeTruthy();
  expect(screen.getByRole("button", { name: "요청 결과" }).props.accessibilityState).toMatchObject({
    expanded: true,
    disabled: true,
  });
  await view.rerender(
    <Disclosure title="요청 결과" summary="상태를 확인했어요.">
      <Text>확인해야 할 결과</Text>
    </Disclosure>,
  );
  expect(screen.getByText("확인해야 할 결과")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "요청 결과" }));
  expect(screen.queryByText("확인해야 할 결과")).toBeNull();
});
