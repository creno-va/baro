import { fireEvent, render, screen } from "@testing-library/react-native";
import type { AccountDeletionState } from "../src/features/account-deletion/model";
import { AccountDeletionScreen } from "../src/features/account-deletion/ui/AccountDeletionScreen";

const id = "15a64c18-fd51-4f83-8205-4c917a245e6b";
const initial: AccountDeletionState = {
  gate: "ready",
  accountName: "합성 A",
  providers: ["apple"],
  provider: "apple",
  confirmation: "",
  busy: null,
  loading: false,
  anonymous: false,
  hasOpenRequest: false,
  history: [],
  error: null,
  storageError: null,
};
const actions = () => ({
  refresh: jest.fn(),
  select: jest.fn(),
  confirm: jest.fn(),
  startDeletion: jest.fn(),
  checkResult: jest.fn(),
  cancelAttempt: jest.fn(),
  clearAnonymous: jest.fn(),
  acknowledge: jest.fn(),
  openAppleHelp: jest.fn(),
});

test("approved Apple action explains deletion before authentication and requires literal confirmation", async () => {
  const handlers = actions(),
    props = { actions: handlers, onSession: jest.fn(), onLegacy: jest.fn() };
  const view = await render(<AccountDeletionScreen {...props} state={initial} />);
  const button = () => screen.getByRole("button", { name: "Apple로 계속하기" });
  expect(button()).toBeDisabled();
  expect(button().props.accessibilityHint).toContain("삭제를 접수");
  expect(screen.getByText(/앱으로 돌아오기 전에 처리될 수/)).toBeTruthy();
  await fireEvent.press(button());
  expect(handlers.startDeletion).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("계정 삭제 확인 (DELETE)"), "DELETE");
  expect(handlers.confirm).toHaveBeenCalledWith("DELETE");
  await view.rerender(
    <AccountDeletionScreen {...props} state={{ ...initial, confirmation: "DELETE" }} />,
  );
  await fireEvent.press(button());
  expect(handlers.startDeletion).toHaveBeenCalledTimes(1);
  await view.rerender(
    <AccountDeletionScreen
      {...props}
      state={{ ...initial, confirmation: "DELETE", storageError: "저장소를 확인해 주세요." }}
    />,
  );
  expect(button()).toBeDisabled();
});

test("anonymous pending result is not labelled deleted/cancelled and cannot be discarded", async () => {
  const handlers = actions();
  await render(
    <AccountDeletionScreen
      state={{
        ...initial,
        gate: "login",
        accountName: null,
        providers: [],
        provider: null,
        anonymous: true,
        history: [{ attemptId: id, relation: "unverified", state: "pending", localSaved: true }],
      }}
      actions={handlers}
      onSession={jest.fn()}
      onLegacy={jest.fn()}
    />,
  );
  expect(screen.getByText("삭제 접수나 취소 결과를 아직 확인하지 못했어요.")).toBeTruthy();
  expect(screen.queryByText("서버에서 계정 삭제 접수를 확인했어요.")).toBeNull();
  expect(screen.queryByRole("button", { name: /결과 확인 정보 기기에서 지우기/ })).toBeNull();
  expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByLabelText("계정 삭제 확인 (DELETE)")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "1번 요청 결과 다시 확인" }));
  expect(handlers.checkResult).toHaveBeenCalledWith(id);
  await fireEvent.press(screen.getByRole("button", { name: "1번 인증 시도 취소 확인" }));
  expect(handlers.cancelAttempt).toHaveBeenCalledWith(id);
});

test("accepted, local cleanup and Apple revocation are independent; only anonymous manual cleanup is offered", async () => {
  const handlers = actions(),
    props = { actions: handlers, onSession: jest.fn(), onLegacy: jest.fn() };
  const state: AccountDeletionState = {
    ...initial,
    gate: "login",
    accountName: null,
    anonymous: true,
    history: [
      {
        attemptId: id,
        relation: "unverified",
        state: "accepted",
        localSaved: false,
        cleanup: "failed",
        appleRevocation: "unconfirmed",
      },
    ],
  };
  const view = await render(<AccountDeletionScreen {...props} state={state} />);
  expect(screen.getByText("서버에서 계정 삭제 접수를 확인했어요.")).toBeTruthy();
  expect(screen.getByText(/기기에 결과를 저장하지 못했어요/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /결과 확인 정보 기기에서 지우기/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "1번 삭제 후 기기 정보 직접 정리" }));
  expect(handlers.clearAnonymous).toHaveBeenCalledWith(id);
  await fireEvent.press(screen.getByRole("button", { name: "Apple 공식 계정 관리 안내" }));
  expect(handlers.openAppleHelp).toHaveBeenCalledTimes(1);
  await view.rerender(<AccountDeletionScreen {...props} state={{ ...state, anonymous: false }} />);
  expect(screen.queryByRole("button", { name: "1번 삭제 후 기기 정보 직접 정리" })).toBeNull();
  await view.rerender(
    <AccountDeletionScreen
      {...props}
      state={{
        ...state,
        history: [
          {
            attemptId: id,
            relation: "previous",
            state: "accepted",
            localSaved: true,
            cleanup: "skipped",
            appleRevocation: "confirmed",
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("현재 다른 계정의 로그인 정보와 자료는 유지했어요.")).toBeTruthy();
  expect(screen.getByText("Apple 연결 해제를 확인했어요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apple 공식 계정 관리 안내" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "1번 결과 확인 정보 기기에서 지우기" }));
  expect(handlers.acknowledge).toHaveBeenCalledWith(id);
});

test("inactive observation clearly leaves deletion unknown and offers explicit local proof removal without showing proof identifiers", async () => {
  const handlers = actions();
  await render(
    <AccountDeletionScreen
      state={{
        ...initial,
        history: [
          {
            attemptId: id,
            relation: "current",
            state: "inactive",
            localSaved: true,
            observedAt: "2026-10-24T12:00:00.000Z",
          },
        ],
      }}
      actions={handlers}
      onSession={jest.fn()}
      onLegacy={jest.fn()}
    />,
  );
  expect(screen.getByText(/삭제 결과는 미확인/)).toBeTruthy();
  expect(screen.getByText(/계정 삭제 성공·실패·취소를 뜻하지/)).toBeTruthy();
  expect(screen.getByText(/기기에서 지우면 이 요청의 결과를 다시 조회할 수 없어요/)).toBeTruthy();
  expect(screen.queryByText("서버에서 계정 삭제 접수를 확인했어요.")).toBeNull();
  expect(screen.queryByText("서버에서 이 인증 시도의 취소를 확인했어요.")).toBeNull();
  expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByRole("button", { name: "1번 인증 시도 취소 확인" })).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "1번 미확정 결과 확인 정보 기기에서 지우기" }),
  );
  expect(handlers.acknowledge).toHaveBeenCalledWith(id);
});
