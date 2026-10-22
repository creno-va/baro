import type { CaseDetail } from "@baro/contracts/cases";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  analysisId,
  caseId,
  guidance,
  outOfScope,
  questions,
  urgentRedirect,
} from "../../../tests/fixtures/contracts";
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
const detail = (): CaseDetail => ({
  caseId,
  analysisId,
  inputRevision: 1,
  title: "기존 합성 비공개 사건",
  status: "completed",
  questions: [],
  result: guidance,
  error: null,
});
function state(value = detail()): CasesState {
  return {
    ...actions.getSnapshot(),
    gate: "ready",
    view: "detail",
    item: {
      id: caseId,
      schemaVersion: "1",
      title: value.title,
      subjectContext: "individual",
      stage: "active",
      revision: 1,
      summary: "기존 사건 기록",
      updatedAt: "2026-10-05T00:00:00Z",
      legacyDetail: value,
    },
  };
}
function ui(current: CasesState, onOpenLink = jest.fn()) {
  return (
    <CasesScreen state={current} actions={actions} onSession={jest.fn()} onOpenLink={onOpenLink} />
  );
}
test("legacy guidance preserves user/AI/unknown distinctions, evidence, caution and dated official source links", async () => {
  const open = jest.fn();
  await render(ui(state(), open), { wrapper });
  expect(screen.getByText(guidance.summary.userStatements.join("\n"))).toBeTruthy();
  expect(screen.getByText(guidance.summary.organizedByAi.join("\n"))).toBeTruthy();
  expect(screen.getByText(guidance.summary.unknowns.join("\n"))).toBeTruthy();
  expect(screen.getByText(`확인할 한계: ${guidance.issues[0]?.uncertainty}`)).toBeTruthy();
  expect(screen.getByText(`주의: ${guidance.nextSteps[0]?.caution}`)).toBeTruthy();
  const citation = guidance.citations[0];
  if (!citation) throw new Error("FIXTURE");
  await fireEvent.press(
    screen.getByRole("button", {
      name: `저장된 출처 열기: ${citation.lawName} ${citation.article}`,
    }),
  );
  expect(open).toHaveBeenCalledWith(citation.url);
  expect(screen.queryByRole("button", { name: "사건 작업공간 열기" })).toBeNull();
  expect(screen.queryByRole("button", { name: /다시 분석/ })).toBeNull();
});
test("stored policy outcomes, incomplete questions and failure are distinct read-only results", async () => {
  const view = await render(ui(state()), { wrapper });
  for (const result of [outOfScope, urgentRedirect]) {
    await view.rerender(ui(state({ ...detail(), status: result.kind, result })));
    expect(screen.getByText(result.message)).toBeTruthy();
    expect(screen.queryByText("AI가 정리한 내용")).toBeNull();
  }
  await view.rerender(
    ui(state({ ...detail(), status: "needs_clarification", result: null, questions })),
  );
  expect(screen.getByText(questions[0]?.prompt ?? "")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "답변 저장" })).toBeNull();
  await view.rerender(
    ui(
      state({
        ...detail(),
        status: "failed",
        result: null,
        error: {
          code: "INTERNAL_ERROR",
          message: "합성 처리 실패",
          requestId: "synthetic_request",
          retryable: true,
          details: {},
        },
      }),
    ),
  );
  expect(screen.getByText("저장된 처리 오류: 합성 처리 실패")).toBeTruthy();
  expect(screen.queryByText("AI가 정리한 내용")).toBeNull();
});
test("private legacy content and deletion controls remain hidden behind every access gate", async () => {
  const current = state(),
    view = await render(ui(current), { wrapper });
  for (const gate of ["checking", "login", "consent", "role", "error"] as const) {
    await view.rerender(ui({ ...current, gate }));
    expect(screen.queryByText(guidance.summary.userStatements.join("\n"))).toBeNull();
    expect(screen.queryByLabelText("사건 삭제 확인 (DELETE 입력)")).toBeNull();
  }
});
test("case removal needs exact typed confirmation; uncertain deletion offers the same request with a frozen confirmation", async () => {
  const remove = jest.spyOn(actions, "deleteCase").mockResolvedValue(),
    current = state();
  const view = await render(ui(current), { wrapper });
  expect(
    screen.getByRole("button", { name: "이 사건 삭제 요청" }).props.accessibilityState.disabled,
  ).toBe(true);
  await view.rerender(ui({ ...current, deleteConfirmation: "DELETE" }));
  await fireEvent.press(screen.getByRole("button", { name: "이 사건 삭제 요청" }));
  expect(remove).toHaveBeenCalledTimes(1);
  await view.rerender(ui({ ...current, deleteConfirmation: "DELETE", deleteUncertain: true }));
  expect(screen.getByLabelText("사건 삭제 확인 (DELETE 입력)").props.editable).toBe(false);
  await fireEvent.press(screen.getByRole("button", { name: "같은 삭제 요청 다시 확인" }));
  expect(remove).toHaveBeenCalledTimes(2);
});
