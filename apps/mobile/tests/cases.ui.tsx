import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type CasesState, createCasesModel } from "../src/features/cases/model";
import { CasesScreen } from "../src/features/cases/ui/CasesScreen";

const actions = createCasesModel({
  session: {
    getSnapshot: () => ({
      phase: "anonymous",
      session: null,
      busy: false,
      consent: null,
      error: null,
      role: "customer",
    }),
    subscribe: () => () => {},
    refresh: async () => {},
  },
  createClient: () => {
    throw new Error("UI_MUST_NOT_START_TRANSPORT");
  },
});
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
function state(): CasesState {
  return {
    ...actions.getSnapshot(),
    gate: "ready",
    view: "create",
    narrative: "합성 비공개 사건 내용",
    error: null,
  };
}
test("access gates hide private fields and offer explicit session navigation", async () => {
  const onSession = jest.fn(),
    current = state();
  const view = await render(
    <CasesScreen state={current} actions={actions} onSession={onSession} />,
    { wrapper },
  );
  expect(screen.getByDisplayValue(current.narrative)).toBeTruthy();
  for (const gate of ["checking", "consent", "role", "login", "error"] as const) {
    await view.rerender(
      <CasesScreen state={{ ...current, gate }} actions={actions} onSession={onSession} />,
    );
    expect(screen.queryByDisplayValue(current.narrative)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "로그인·이용 상태 확인" }));
  }
  expect(onSession).toHaveBeenCalledTimes(5);
});
test("create and per-round answers expose labelled fields, unknown/skip choices and busy cancellation", async () => {
  const create = jest.spyOn(actions, "create").mockResolvedValue(),
    answer = jest.spyOn(actions, "answer"),
    cancel = jest.spyOn(actions, "cancel");
  const current = state(),
    view = await render(<CasesScreen state={current} actions={actions} onSession={jest.fn()} />, {
      wrapper,
    });
  await fireEvent.press(screen.getByRole("button", { name: "보안 확인하고 사건 저장" }));
  expect(create).toHaveBeenCalledTimes(1);
  await view.rerender(
    <CasesScreen
      state={{
        ...current,
        view: "detail",
        item: {
          id: "case_a",
          title: "합성 사건",
          revision: 1,
          schemaVersion: "2",
          stage: "intake",
          subjectContext: "individual",
          summary: "",
          updatedAt: "2026-10-22",
        },
        questions: {
          questions: [{ id: "q1", text: "합성 질문", kind: "text" }],
          complete: false,
          revision: 1,
        },
      }}
      actions={actions}
      onSession={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("checkbox", { name: "모르겠어요" }));
  expect(answer).toHaveBeenLastCalledWith({ questionId: "q1", state: "unknown" });
  await fireEvent.press(screen.getByRole("checkbox", { name: "답변 건너뛰기" }));
  expect(answer).toHaveBeenLastCalledWith({ questionId: "q1", state: "skipped" });
  await view.rerender(
    <CasesScreen state={{ ...current, busy: true }} actions={actions} onSession={jest.fn()} />,
  );
  expect(screen.getByRole("button", { name: "보안 확인하고 사건 저장" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "진행 중인 요청 중단" }));
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("an active case can review and confirm its summary again, while archived cases stay read only", async () => {
  const confirm = jest.spyOn(actions, "confirm").mockResolvedValue();
  const save = jest.spyOn(actions, "saveSummary").mockResolvedValue();
  const onWorkspace = jest.fn();
  const current: CasesState = {
    ...state(),
    view: "detail",
    summary: "새 자료를 반영한 요약",
    item: {
      id: "case_a",
      title: "합성 사건",
      revision: 7,
      schemaVersion: "2",
      stage: "active",
      subjectContext: "individual",
      summary: "새 자료를 반영한 요약",
      updatedAt: "2026-10-25",
    },
  };
  const view = await render(
    <CasesScreen
      state={current}
      actions={actions}
      onSession={jest.fn()}
      onWorkspace={onWorkspace}
    />,
    { wrapper },
  );
  expect(screen.getByDisplayValue(current.summary)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "수정한 요약 저장" }));
  await fireEvent.press(screen.getByRole("button", { name: "요약 확인하고 계속" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "사건 작업공간 열기" }));
  expect(onWorkspace).toHaveBeenCalledWith("case_a");
  await view.rerender(
    <CasesScreen
      state={{ ...current, item: current.item ? { ...current.item, stage: "archived" } : null }}
      actions={actions}
      onSession={jest.fn()}
    />,
  );
  expect(screen.queryByDisplayValue(current.summary)).toBeNull();
  expect(screen.queryByRole("button", { name: "요약 확인하고 계속" })).toBeNull();
});
