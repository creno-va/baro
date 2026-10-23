import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SettingsState } from "../src/features/settings/model";
import { SettingsScreen } from "../src/features/settings/ui/SettingsScreen";

const initial: SettingsState = {
  gate: "ready",
  profile: { name: "합성 사용자", role: "customer" },
  needsConsent: false,
  usage: {
    newCases: { used: 1, limit: 10 },
    aiResponses: { used: 5, limit: 200 },
    mediaMinutes: { used: 1.5, limit: 60 },
    storageBytes: { used: 2_000_000, limit: 1_000_000_000 },
    resetAt: "2026-10-23T15:00:00.000Z",
    includesReservations: true,
  },
  usageBusy: false,
  usageError: null,
  deletion: { providers: ["google"], canDelete: true },
  deletionState: "none",
  deletionBusy: false,
  action: null,
  confirmation: "",
  notice: null,
  error: null,
  policyError: null,
};
const actions = () => ({
  refresh: jest.fn(),
  confirm: jest.fn(),
  deleteAccount: jest.fn(),
  retryUnconfirmed: jest.fn(),
  reauthenticate: jest.fn(),
  openPolicy: jest.fn(),
});

test("settings shows reserved usage and KST reset; literal input and explicit provider/policy actions never auto-submit", async () => {
  const handlers = actions();
  const view = await render(
    <SettingsScreen state={initial} actions={handlers} onSession={jest.fn()} />,
  );
  expect(screen.getByText("AI 응답: 5 / 200회")).toBeTruthy();
  expect(screen.getByText("일일 사용량 초기화: 2026-10-24 00:00 (한국 시간)")).toBeTruthy();
  expect(screen.getByText(/예약 사용량을 포함/)).toBeTruthy();
  const button = screen.getByRole("button", { name: "내 계정 삭제 요청" });
  expect(button.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(button);
  expect(handlers.deleteAccount).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("계정 삭제 확인 (DELETE)"), "DELETE");
  expect(handlers.confirm).toHaveBeenCalledWith("DELETE");
  await fireEvent.press(screen.getByRole("button", { name: "Google로 같은 계정 다시 인증" }));
  expect(handlers.reauthenticate).toHaveBeenCalledWith("google");
  await fireEvent.press(screen.getByRole("button", { name: "개인정보 처리방침 읽기" }));
  expect(handlers.openPolicy).toHaveBeenCalledWith("privacy");
  await view.rerender(
    <SettingsScreen
      state={{ ...initial, confirmation: "DELETE" }}
      actions={handlers}
      onSession={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "내 계정 삭제 요청" }));
  expect(handlers.deleteAccount).toHaveBeenCalledTimes(1);
  expect(handlers.retryUnconfirmed).not.toHaveBeenCalled();
});

test("uncertain deletion is a separate fresh-auth action; accepted cleanup failure hides profile, input and retry", async () => {
  const handlers = actions(),
    onSession = jest.fn();
  const view = await render(
    <SettingsScreen
      state={{
        ...initial,
        notice: "unconfirmed",
        deletionState: "unconfirmed",
        confirmation: "DELETE",
        deletion: { providers: ["google"], canDelete: false },
      }}
      actions={handlers}
      onSession={onSession}
    />,
  );
  expect(screen.getByText(/이미 처리됐을 수도/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "내 계정 삭제 요청" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "미확정 삭제 요청 직접 다시 확인" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await view.rerender(
    <SettingsScreen
      state={{
        ...initial,
        notice: "unconfirmed",
        deletionState: "unconfirmed",
        confirmation: "DELETE",
      }}
      actions={handlers}
      onSession={onSession}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "미확정 삭제 요청 직접 다시 확인" }));
  expect(handlers.retryUnconfirmed).toHaveBeenCalledTimes(1);
  await view.rerender(
    <SettingsScreen
      state={{ ...initial, notice: "cleanup-failed" }}
      actions={handlers}
      onSession={onSession}
    />,
  );
  expect(screen.getByText("계정 삭제를 접수했어요")).toBeTruthy();
  expect(screen.getByText(/모두 정리하지 못했어요/)).toBeTruthy();
  expect(screen.queryByText("합성 사용자님")).toBeNull();
  expect(screen.queryByLabelText("계정 삭제 확인 (DELETE)")).toBeNull();
  expect(screen.queryByRole("button", { name: "미확정 삭제 요청 직접 다시 확인" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "로그인·기기 저장 상태 확인" }));
  expect(onSession).toHaveBeenCalledTimes(1);
});

test("consent renewal preserves deletion and policy access; background hides all private content", async () => {
  const handlers = actions(),
    onSession = jest.fn();
  const view = await render(
    <SettingsScreen
      state={{ ...initial, needsConsent: true, usage: null }}
      actions={handlers}
      onSession={onSession}
    />,
  );
  expect(screen.getByText(/계정 삭제와 정책 확인은 계속/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Google로 같은 계정 다시 인증" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "필수 동의 확인" }));
  expect(onSession).toHaveBeenCalledTimes(1);
  for (const gate of ["checking", "login", "error"] as const) {
    await view.rerender(
      <SettingsScreen state={{ ...initial, gate }} actions={handlers} onSession={onSession} />,
    );
    expect(screen.queryByText("합성 사용자님")).toBeNull();
    expect(screen.queryByText("AI 응답: 5 / 200회")).toBeNull();
    expect(screen.queryByLabelText("계정 삭제 확인 (DELETE)")).toBeNull();
    expect(screen.getByRole("button", { name: "이용약관 읽기" })).toBeTruthy();
  }
});
