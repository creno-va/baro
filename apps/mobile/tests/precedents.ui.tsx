import { v2PrecedentSearchResponseSchema } from "@baro/contracts/v2/precedent-research";
import { fireEvent, render, screen } from "@testing-library/react-native";
import fixture from "../../../tests/fixtures/legal/research/synthetic-search.json";
import { createPrecedentsModel, type PrecedentsState } from "../src/features/precedents/model";
import { PrecedentsScreen } from "../src/features/precedents/ui/PrecedentsScreen";

const actions = createPrecedentsModel({
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
    throw new Error("UI_MUST_NOT_CALL_API");
  },
  openUrl: async () => {},
});
const result = v2PrecedentSearchResponseSchema.parse(fixture);
const initial: PrecedentsState = {
  ...actions.getSnapshot(),
  gate: "ready",
  topics: ["loan"],
  context: {
    schemaVersion: "2",
    workspaceRevision: 7,
    summaryRevision: 2,
    caseTitle: "합성 비공개 사건",
    recommendedTopics: ["loan"],
  },
  result,
};
test("native research uses labelled topic selection and explicit signed read/official actions; proof is not rendered", async () => {
  const search = jest.fn(),
    read = jest.fn(),
    open = jest.fn(),
    select = jest.fn();
  await render(
    <PrecedentsScreen
      state={initial}
      actions={{ ...actions, search, read, openOfficial: open, select }}
      onSession={jest.fn()}
      onReview={jest.fn()}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "빌려준 돈 · 추천 주제" })).toBeTruthy();
  expect(
    screen.getByText(
      "일부 검색 범위에서 최대 6건을 확인했어요. 전체 판례를 조사한 결과가 아니에요.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(result.items[0]?.readToken ?? "no proof")).toBeNull();
  expect(search).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "선택 주제로 판례 검색" }));
  expect(search).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "합성 판례 검토 자료 원문 읽기" }));
  expect(read).toHaveBeenCalledWith(result.items[0]?.id);
  await fireEvent.press(
    screen.getByRole("button", { name: "합성 판례 검토 자료 공식 사이트 열기" }),
  );
  expect(open).toHaveBeenCalledWith(result.items[0]?.id);
  await fireEvent.press(screen.getByRole("button", { name: "모든 주제 보기" }));
  await fireEvent.press(screen.getByRole("checkbox", { name: "임금·퇴직금" }));
  expect(select).toHaveBeenCalledWith("wages");
});
test("unavailable/partial coverage remain distinct and auth/consent hides all private case/result text", async () => {
  const session = jest.fn();
  const view = await render(
    <PrecedentsScreen
      state={{
        ...initial,
        result: {
          ...result,
          status: "partial",
          unavailableTopics: ["loan"],
          availabilityIssues: [{ topic: "loan", reason: "timeout" }],
        },
      }}
      actions={actions}
      onSession={session}
      onReview={jest.fn()}
    />,
  );
  expect(screen.getByText("요청한 판례를 일부만 확인했어요")).toBeTruthy();
  expect(screen.getByText(/빌려준 돈 · 공식 기관의 응답이 늦어/)).toBeTruthy();
  expect(screen.getByText("확인하지 못한 주제: 빌려준 돈")).toBeTruthy();
  await view.rerender(
    <PrecedentsScreen
      state={{
        ...initial,
        result: { ...result, status: "unavailable", items: [], unavailableTopics: ["loan"] },
      }}
      actions={actions}
      onSession={session}
      onReview={jest.fn()}
    />,
  );
  expect(screen.getByText("공식 판례를 현재 확인할 수 없어요")).toBeTruthy();
  await view.rerender(
    <PrecedentsScreen
      state={{ ...initial, gate: "consent" }}
      actions={actions}
      onSession={session}
      onReview={jest.fn()}
    />,
  );
  expect(screen.queryByText("합성 비공개 사건")).toBeNull();
  expect(screen.queryByText("합성 판례 검토 자료")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "로그인·이용 상태 확인" }));
  expect(session).toHaveBeenCalledTimes(1);
});
