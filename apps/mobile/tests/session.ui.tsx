import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { SessionState } from "../src/features/session/model";
import { SessionScreen } from "../src/features/session/ui/SessionScreen";

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
const anonymous: SessionState = {
  phase: "anonymous",
  session: null,
  role: "customer",
  busy: false,
  consent: null,
  error: null,
};
const consent: SessionState = {
  ...anonymous,
  phase: "consent",
  session: {
    user: { id: "a", name: "합성 계정 이름", accountType: "customer" },
    needsConsent: true,
  },
  consent: { required: CURRENT_POLICY_VERSIONS, consent: null, needsConsent: true },
};
function props(state: SessionState) {
  return {
    state,
    onRole: jest.fn(),
    onSignIn: jest.fn(),
    onCancel: jest.fn(),
    onRetry: jest.fn(),
    onConsent: jest.fn(),
    onSignOut: jest.fn(),
    onBrowse: jest.fn(),
    onPolicy: jest.fn(),
  };
}

test("native login exposes the three existing providers and explicit self-declared role selection", async () => {
  const p = props(anonymous);
  await render(<SessionScreen {...p} />, { wrapper });
  await fireEvent.press(screen.getByRole("radio", { name: "변호사로 이용" }));
  expect(p.onRole).toHaveBeenCalledWith("lawyer");
  for (const label of ["Google로 로그인", "네이버로 로그인", "카카오로 로그인"])
    await fireEvent.press(screen.getByRole("button", { name: label }));
  expect(p.onSignIn.mock.calls.map((call) => call[0])).toEqual(["google", "naver", "kakao"]);
  expect(screen.getByText(/자격 확인을 뜻하지/)).toBeTruthy();
});

test("policy and age controls are independent requirements; busy submission disables them", async () => {
  const p = props(consent),
    view = await render(<SessionScreen {...p} />, { wrapper });
  const submit = () => screen.getByRole("button", { name: "동의하고 계속하기" });
  expect(submit()).toBeDisabled();
  await fireEvent.press(screen.getByRole("checkbox", { name: "[필수] 서비스 정책에 동의합니다" }));
  expect(submit()).toBeDisabled();
  await fireEvent.press(screen.getByRole("checkbox", { name: "[필수] 만 14세 이상입니다" }));
  await fireEvent.press(submit());
  expect(p.onConsent).toHaveBeenCalledWith({ policies: true, over14: true });
  await fireEvent.press(screen.getByRole("button", { name: "개인정보 처리방침 읽기" }));
  expect(p.onPolicy).toHaveBeenCalledWith("privacy");
  await view.rerender(<SessionScreen {...p} state={{ ...consent, busy: true }} />);
  expect(screen.getByRole("button", { name: "동의 저장 중" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "[필수] 만 14세 이상입니다" })).toBeDisabled();
});

test("changing the owner resets consent choices and checking/authorization hides private identity", async () => {
  const p = props(consent),
    view = await render(<SessionScreen {...p} />, { wrapper });
  for (const label of ["[필수] 서비스 정책에 동의합니다", "[필수] 만 14세 이상입니다"])
    await fireEvent.press(screen.getByRole("checkbox", { name: label }));
  await view.rerender(
    <SessionScreen
      {...p}
      state={{
        ...consent,
        session: {
          user: { id: "b", name: "다른 합성 계정", accountType: "customer" },
          needsConsent: true,
        },
      }}
    />,
  );
  expect(screen.getByRole("button", { name: "동의하고 계속하기" })).toBeDisabled();
  await view.rerender(
    <SessionScreen {...p} state={{ ...consent, phase: "ready", consent: null }} />,
  );
  expect(screen.getByText("합성 계정 이름님")).toBeTruthy();
  await view.rerender(
    <SessionScreen {...p} state={{ ...anonymous, phase: "authorizing", busy: true }} />,
  );
  expect(screen.queryByText("합성 계정 이름님")).toBeNull();
  expect(screen.queryByRole("button", { name: "Google로 로그인" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "로그인 취소" }));
  expect(p.onCancel).toHaveBeenCalledTimes(1);
  await view.rerender(
    <SessionScreen {...p} state={{ ...anonymous, phase: "checking", busy: true }} />,
  );
  expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
});

test("retry, logout and public browsing are explicit commands", async () => {
  const p = props({ ...consent, phase: "ready", consent: null });
  const view = await render(<SessionScreen {...p} />, { wrapper });
  await fireEvent.press(screen.getByRole("button", { name: "로그아웃" }));
  expect(p.onSignOut).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "변호사 탐색" }));
  expect(p.onBrowse).toHaveBeenCalledTimes(1);
  await view.rerender(
    <SessionScreen {...p} state={{ ...anonymous, phase: "error", error: "다시 확인해 주세요." }} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "이용 상태 다시 확인" }));
  expect(p.onRetry).toHaveBeenCalledTimes(1);
});

test("reauthentication is available before consent, lists only linked providers and hides identity while authorizing", async () => {
  const p = { ...props(consent), onReauthenticate: jest.fn(), onReadReauthentication: jest.fn() };
  const view = await render(<SessionScreen {...p} />, { wrapper });
  await fireEvent.press(screen.getByRole("button", { name: "재인증 로그인 수단 확인" }));
  expect(p.onReadReauthentication).toHaveBeenCalledTimes(1);
  await view.rerender(
    <SessionScreen
      {...p}
      state={{
        ...consent,
        reauthentication: { providers: ["naver"], verified: true, checking: false, error: null },
      }}
    />,
  );
  expect(screen.getByText("이 계정의 최근 재인증을 확인했어요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Google로 같은 계정 다시 인증" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "네이버로 같은 계정 다시 인증" }));
  expect(p.onReauthenticate).toHaveBeenCalledWith("naver");
  await view.rerender(
    <SessionScreen
      {...p}
      state={{ ...anonymous, phase: "authorizing", authPurpose: "reauthenticate", busy: true }}
    />,
  );
  expect(screen.queryByText("합성 계정 이름님")).toBeNull();
  expect(screen.queryByText("이 계정의 최근 재인증을 확인했어요.")).toBeNull();
  expect(screen.queryByRole("button", { name: "로그인 취소" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "재인증 취소" }));
  expect(p.onCancel).toHaveBeenCalledTimes(1);
});

test("Apple uses the official scalable native button only when the server advertises it", async () => {
  const p = props({
    ...anonymous,
    authentication: {
      contractVersion: 2,
      providers: ["google", "apple"],
      checking: false,
      error: null,
    },
  });
  const view = await render(<SessionScreen {...p} />, { wrapper });
  await fireEvent.press(screen.getByRole("button", { name: "Apple로 로그인" }));
  expect(p.onSignIn).toHaveBeenCalledWith("apple");
  expect(screen.queryByRole("button", { name: "네이버로 로그인" })).toBeNull();
  expect(screen.getByText(/다른 계정이 자동 연결되지는 않아요/)).toBeTruthy();
  const label = screen.getByText("Apple로 로그인");
  expect(label.props.allowFontScaling).toBe(true);
  expect(label.props.maxFontSizeMultiplier).toBe(0);
  await view.rerender(
    <SessionScreen
      {...p}
      state={{
        ...anonymous,
        authentication: {
          providers: [],
          checking: false,
          error: "로그인 수단을 확인하지 못했어요.",
        },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Apple로 로그인" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Google로 로그인" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "로그인 수단 다시 확인" }));
  expect(p.onRetry).toHaveBeenCalledTimes(1);
});

test("linked Apple reauthentication keeps approved title and explains same-account intent", async () => {
  const p = {
    ...props({
      ...consent,
      reauthentication: { providers: ["apple"], verified: false, checking: false, error: null },
    }),
    onReauthenticate: jest.fn(),
  };
  await render(<SessionScreen {...p} />, { wrapper });
  const button = screen.getByRole("button", { name: "Apple로 계속하기" });
  expect(button.props.accessibilityHint).toContain("같은 Apple 계정");
  await fireEvent.press(button);
  expect(p.onReauthenticate).toHaveBeenCalledWith("apple");
  expect(screen.queryByRole("button", { name: "Google로 같은 계정 다시 인증" })).toBeNull();
});
