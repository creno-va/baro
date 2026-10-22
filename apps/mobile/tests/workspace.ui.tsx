import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createWorkspaceModel, type WorkspaceState } from "../src/features/workspace/model";
import { WorkspaceScreen } from "../src/features/workspace/ui/WorkspaceScreen";

const actions = createWorkspaceModel({
  caseId: "case_a",
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
    throw new Error("UI_MUST_NOT_OPEN_TRANSPORT");
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
const state = (): WorkspaceState => ({
  ...actions.getSnapshot(),
  gate: "ready",
  text: "합성 비공개 초안",
  value: {
    case: {
      id: "case_a",
      title: "합성 비공개 사건",
      schemaVersion: "2",
      stage: "active",
      subjectContext: "individual",
      revision: 3,
      updatedAt: "2026-10-22T00:00:00Z",
      summary: "합성 요약",
    },
    messages: [
      {
        id: "job:a",
        role: "assistant",
        status: "failed",
        retryable: false,
        text: "응답 검증 실패",
        createdAt: "2026-10-22T00:00:00Z",
        warnings: ["검증을 통과하지 못해 내용을 표시하지 않았어요."],
      },
    ],
    actions: [
      { id: "action_a", revision: 2, title: "합성 준비", detail: "합성 주의", done: false },
    ],
    timeline: [],
    files: [],
    facts: [],
    unknowns: [],
  },
});
function ui(current: WorkspaceState, onReview = jest.fn()) {
  return (
    <WorkspaceScreen
      state={current}
      actions={actions}
      onSession={jest.fn()}
      onReview={onReview}
      onCitation={jest.fn()}
    />
  );
}
test("access gates hide private content even when stale private state is passed to the pure screen", async () => {
  const current = state(),
    view = await render(ui(current), { wrapper });
  expect(screen.getByDisplayValue(current.text)).toBeTruthy();
  for (const gate of ["checking", "consent", "login", "role", "error"] as const) {
    await view.rerender(ui({ ...current, gate }));
    expect(screen.queryByDisplayValue(current.text)).toBeNull();
    expect(screen.queryByText("합성 비공개 사건")).toBeNull();
    expect(screen.getByRole("button", { name: "로그인·이용 상태 확인" })).toBeTruthy();
  }
});
test("unacknowledged requests freeze drafts and expose explicit replay; conflicts require explicit discard", async () => {
  const replay = jest.spyOn(actions, "replay").mockResolvedValue(),
    refresh = jest.spyOn(actions, "refresh").mockResolvedValue();
  const current = {
    ...state(),
    pending: {
      kind: "message" as const,
      input: { expectedRevision: 3, text: "원래 내용", selectedFileIds: [] },
    },
  };
  const view = await render(ui(current), { wrapper });
  expect(screen.getByLabelText("추가로 정리할 내용").props.editable).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "같은 요청 다시 확인" }));
  expect(replay).toHaveBeenCalledTimes(1);
  await view.rerender(ui({ ...current, conflict: true }));
  expect(
    screen.getByRole("button", { name: "같은 요청 다시 확인" }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "입력 버리고 최신 내용 불러오기" }));
  expect(refresh).toHaveBeenCalledWith(true);
});
test("new summary blocks another message, offers review navigation and preserves safe failed-job warnings", async () => {
  const current = state(),
    onReview = jest.fn();
  if (!current.value) throw new Error("FIXTURE");
  current.value.case.summaryNeedsConfirmation = true;
  await render(ui(current, onReview), { wrapper });
  expect(
    screen.getByRole("button", { name: "내용 보내기" }).props.accessibilityState.disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "이 응답 다시 시도" })).toBeNull();
  expect(screen.getByText("검증을 통과하지 못해 내용을 표시하지 않았어요.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "요약 검토·확인하기" }));
  expect(onReview).toHaveBeenCalledTimes(1);
});
test("timeline unknown-date editor and action entity controls remain accessible with busy state", async () => {
  const current = state();
  current.timeline = {
    date: "",
    datePrecision: "unknown",
    title: "날짜 모르는 합성 기록",
    detail: "",
    expectedRevision: 3,
  };
  const view = await render(ui(current), { wrapper });
  await fireEvent.press(screen.getByRole("radio", { name: "타임라인" }));
  expect(screen.getByDisplayValue("날짜 모르는 합성 기록")).toBeTruthy();
  expect(screen.queryByLabelText("날짜 (YYYY-MM-DD, 월은 01일·연도는 01월 01일)")).toBeNull();
  await view.rerender(ui({ ...current, busy: true }));
  expect(
    screen.getByRole("button", { name: "타임라인 저장" }).props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(screen.getByRole("radio", { name: "다음 행동" }));
  expect(
    screen.getByRole("checkbox", { name: "합성 준비" }).props.accessibilityState.disabled,
  ).toBe(true);
});
