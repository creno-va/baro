import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createReportsModel, type ReportsState } from "../src/features/reports/model";
import { ReportsScreen } from "../src/features/reports/ui/ReportsScreen";

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
function actions() {
  const model = createReportsModel({
    caseId: "case_a",
    session: {
      getSnapshot: () => ({
        phase: "anonymous",
        session: null,
        role: "customer",
        busy: false,
        consent: null,
        error: null,
      }),
      subscribe: () => () => {},
      refresh: async () => {},
    },
    createClient: () => {
      throw new Error("SCREEN_ONLY_FIXTURE");
    },
    discard: async () => {},
    present: async () => {},
    clear: async () => {},
  });
  return {
    ...model,
    save: jest.fn(async () => {}),
    change: jest.fn(),
    photo: jest.fn(),
    exclude: jest.fn(),
    originalSelection: jest.fn(),
    download: jest.fn(async () => {}),
    reviewed: jest.fn(),
    acknowledgeOriginals: jest.fn(),
    generateInitial: jest.fn(async () => {}),
    excludeInitial: jest.fn(),
    askGenerate: jest.fn(),
    generate: jest.fn(async () => {}),
    confirmReload: jest.fn(async () => {}),
    openPhoto: jest.fn(async () => {}),
  };
}
function fixture() {
  const a = actions();
  const state: ReportsState = {
    ...a.getSnapshot(),
    gate: "ready",
    canWrite: true,
    report: {
      id: "report_a",
      caseId: "case_a",
      revision: 2,
      title: "합성 사건 리포트",
      content: "비공개 합성 본문",
      stale: false,
      maskIdentifiers: false,
      excludedFileIds: [],
      includedPhotoIds: [],
      photoCandidates: [{ id: "file_a", name: "합성 사진", revision: 3 }],
      basis: { workspaceRevision: 7, summaryRevision: 2, generatedAt: "2026-10-23T00:00:00.000Z" },
      updatedAt: "2026-10-23T00:00:00.000Z",
    },
    draft: {
      content: "비공개 합성 본문",
      maskIdentifiers: false,
      excludedFileIds: [],
      includedPhotoIds: [],
    },
    files: [
      {
        id: "file_a",
        name: "합성 사진",
        mimeType: "image/png",
        sizeBytes: 3,
        status: "ready",
        coverage: "합성 범위",
        extractedText: "",
      },
    ],
  };
  const view = (next = state) => (
    <ReportsScreen
      state={next}
      actions={a}
      onSession={jest.fn()}
      onWorkspace={jest.fn()}
      onFiles={jest.fn()}
    />
  );
  return { a, state, view };
}
test("native report editor presents basis and controlled photo/mask/exclusion choices before saving", async () => {
  const f = fixture(),
    result = await render(f.view(), { wrapper });
  expect(screen.getByText("사건 버전 7 · 확인 요약 버전 2 기준")).toBeTruthy();
  expect(screen.getByRole("button", { name: "검토 내용 저장" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("리포트 본문"), "변경 본문");
  expect(f.a.change).toHaveBeenCalledWith({ content: "변경 본문" });
  await fireEvent.press(screen.getByRole("checkbox", { name: "합성 사진 리포트 사진으로 포함" }));
  expect(f.a.photo).toHaveBeenCalledWith("file_a");
  await fireEvent.press(screen.getByRole("button", { name: "합성 사진 사진 원본 열어 확인" }));
  expect(f.a.openPhoto).toHaveBeenCalledWith("file_a");
  await result.rerender(
    f.view({
      ...f.state,
      draft: { ...requireDraft(f.state), content: "변경 본문", maskIdentifiers: true },
    }),
  );
  expect(screen.getByRole("checkbox", { name: "합성 사진 리포트 사진으로 포함" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "검토 내용 저장" }));
  expect(f.a.save).toHaveBeenCalledTimes(1);
});
test("saved export and unmasked ZIP acknowledgement are independent, explicit choices", async () => {
  const f = fixture(),
    result = await render(f.view(), { wrapper });
  expect(screen.getByRole("button", { name: "PDF를 기기에 저장" })).toBeDisabled();
  expect(
    screen.getByText(
      "자동 가림과 리포트 제외는 원본 파일의 내용을 가리지 않습니다. 원본에는 개인정보가 그대로 포함될 수 있어요. 필요한 자료만 직접 선택해 주세요.",
    ),
  ).toBeTruthy();
  await result.rerender(f.view({ ...f.state, reviewed: true, originals: ["file_a"] }));
  expect(screen.getByRole("button", { name: "선택 원본 ZIP을 기기에 저장" })).toBeDisabled();
  await result.rerender(
    f.view({ ...f.state, reviewed: true, originals: ["file_a"], originalsAcknowledged: true }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "선택 원본 ZIP을 기기에 저장" }));
  expect(f.a.download).toHaveBeenCalledWith("zip");
  await fireEvent.press(screen.getByRole("button", { name: "PDF를 기기에 저장" }));
  expect(f.a.download).toHaveBeenCalledWith("pdf");
});
test("initial exclusion and replacement/reload require explicit controls", async () => {
  const f = fixture(),
    state = { ...f.state, report: null, draft: null, initialLimit: true };
  const result = await render(f.view(state), { wrapper });
  expect(
    screen.getByRole("button", { name: "선택한 자료를 제외하고 첫 초안 생성" }),
  ).toBeDisabled();
  await fireEvent.press(screen.getByRole("checkbox", { name: "합성 사진 첫 초안에서 제외" }));
  expect(f.a.excludeInitial).toHaveBeenCalledWith("file_a");
  await result.rerender(f.view({ ...state, initialExcluded: ["file_a"] }));
  await fireEvent.press(
    screen.getByRole("button", { name: "선택한 자료를 제외하고 첫 초안 생성" }),
  );
  expect(f.a.generateInitial).toHaveBeenCalledTimes(1);
  await result.rerender(f.view({ ...f.state, confirm: "generate" }));
  await fireEvent.press(screen.getByRole("button", { name: "새 초안 생성 확인" }));
  expect(f.a.generate).toHaveBeenCalledTimes(1);
  await result.rerender(f.view({ ...f.state, confirm: "reload" }));
  await fireEvent.press(screen.getByRole("button", { name: "편집을 버리고 저장 내용 불러오기" }));
  expect(f.a.confirmReload).toHaveBeenCalledTimes(1);
});
test("consent-only mode preserves stored exports and checking never renders private report fields", async () => {
  const f = fixture(),
    result = await render(
      f.view({
        ...f.state,
        canWrite: false,
        reviewed: true,
        report: { ...requireReport(f.state), pdfAvailable: true, stale: true },
      }),
      { wrapper },
    );
  expect(screen.getByRole("button", { name: "최신 사건으로 새 초안 만들기" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "식별정보 자동 가림" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PDF를 기기에 저장" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "저장된 HTML을 기기에 저장" })).not.toBeDisabled();
  await result.rerender(f.view({ ...f.state, gate: "checking" }));
  expect(screen.queryByLabelText("리포트 본문")).toBeNull();
  expect(screen.queryByText("합성 사건 리포트")).toBeNull();
  expect(screen.queryByText("합성 사진")).toBeNull();
});
function requireDraft(state: ReportsState) {
  if (!state.draft) throw new Error("MISSING_SCREEN_DRAFT");
  return state.draft;
}
function requireReport(state: ReportsState) {
  if (!state.report) throw new Error("MISSING_SCREEN_REPORT");
  return state.report;
}
