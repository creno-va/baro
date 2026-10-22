import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { FilesModel, FilesState } from "../src/features/files/model";
import { Coverage } from "../src/features/files/ui/Coverage";
import { FilesScreen } from "../src/features/files/ui/FilesScreen";

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
const base: FilesState = {
  gate: "ready",
  canWrite: true,
  files: [
    {
      id: "file_a",
      name: "합성 원본.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
      status: "ready",
      coverage: "처리 범위 확인",
      extractedText: "",
      canRetry: true,
    },
  ],
  source: null,
  progress: null,
  pendingUpload: false,
  uploadConflict: false,
  review: null,
  reviewAfter: -1,
  reviewHistory: [],
  edit: null,
  reviewConflict: false,
  deleteTarget: null,
  confirmation: "",
  download: null,
  busy: null,
  loading: false,
  error: null,
  notice: null,
};
function actions() {
  return {
    getSnapshot: () => base,
    subscribe: () => () => {},
    start: () => () => {},
    refresh: jest.fn(async () => {}),
    select: jest.fn(async () => {}),
    upload: jest.fn(async () => {}),
    cancelSelection: jest.fn(),
    retry: jest.fn(async () => {}),
    review: jest.fn(async () => {}),
    edit: jest.fn(),
    changeEdit: jest.fn(),
    cancelEdit: jest.fn(),
    saveEdit: jest.fn(async () => {}),
    pendingReview: jest.fn(async () => {}),
    closeReview: jest.fn(),
    askDelete: jest.fn(),
    confirm: jest.fn(),
    closeDelete: jest.fn(),
    remove: jest.fn(async () => {}),
    original: jest.fn(async () => {}),
    present: jest.fn(async () => {}),
  } satisfies FilesModel;
}
test("native files exposes selection/upload/recovery without allowing a new file during an uncertain request", async () => {
  const a = actions(),
    state: FilesState = {
      ...base,
      source: { name: "선택.txt", size: 3, type: "text/plain" },
      pendingUpload: true,
      progress: { stage: "checking", completedBytes: 3, totalBytes: 3 },
    };
  await render(
    <FilesScreen state={state} actions={a} onSession={jest.fn()} onWorkspace={jest.fn()} />,
    { wrapper },
  );
  expect(screen.getByRole("button", { name: "기기에서 파일·사진 선택" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "같은 파일의 업로드 결과 다시 확인" }));
  expect(a.upload).toHaveBeenCalledTimes(1);
  expect(screen.getByText("서버 저장 확인 · 100%")).toBeTruthy();
});
test("read-only consent mode keeps original/download/delete available and requires literal DELETE", async () => {
  const a = actions(),
    state = { ...base, canWrite: false, deleteTarget: "file_a" };
  const view = await render(
    <FilesScreen state={state} actions={a} onSession={jest.fn()} onWorkspace={jest.fn()} />,
    { wrapper },
  );
  expect(screen.getByRole("button", { name: "기기에서 파일·사진 선택" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "합성 원본.txt 처리 다시 시도" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "합성 원본.txt 원본을 기기에 저장" }));
  expect(a.original).toHaveBeenCalledWith("file_a");
  expect(screen.getByRole("button", { name: "확인한 자료 삭제 요청" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("삭제 확인 DELETE"), "DELETE");
  expect(a.confirm).toHaveBeenCalledWith("DELETE");
  await view.rerender(
    <FilesScreen
      state={{ ...state, confirmation: "DELETE" }}
      actions={a}
      onSession={jest.fn()}
      onWorkspace={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "확인한 자료 삭제 요청" }));
  expect(a.remove).toHaveBeenCalledTimes(1);
});
test("observation review distinguishes source position, original, uncertainty and exclusion, with explicit editing", async () => {
  const a = actions(),
    state: FilesState = {
      ...base,
      review: {
        file: { id: "file_a", revision: 2, name: "합성 자료", status: "ready" },
        workspaceRevision: 4,
        coverage: { category: "image", status: "partial", observation: "low_quality" },
        observations: [
          {
            ordinal: 0,
            value: {
              id: "o_a",
              text: "사용자 교정",
              position: { kind: "document", page: 2, paragraph: 3, table: null },
              certainty: "uncertain",
              userEdited: true,
              included: false,
            },
            original: {
              id: "o_a",
              text: "원래 AI 관찰",
              position: { kind: "document", page: 2, paragraph: 3, table: null },
              certainty: "observed",
              userEdited: false,
              included: true,
            },
          },
        ],
        pendingReview: null,
        nextAfterOrdinal: null,
        recovery: null,
      },
      edit: { id: "o_a", text: "사용자 교정", included: false },
    };
  await render(
    <FilesScreen state={state} actions={a} onSession={jest.fn()} onWorkspace={jest.fn()} />,
    { wrapper },
  );
  expect(screen.getByText("2쪽 · 3문단 · 미확인·불확실 · 정리에서 제외")).toBeTruthy();
  expect(screen.getByText("교정 전 원문: 원래 AI 관찰")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("관찰 교정 내용"), "다시 확인한 내용");
  expect(a.changeEdit).toHaveBeenCalledWith({ text: "다시 확인한 내용" });
  await fireEvent.press(screen.getByRole("button", { name: "원래 버전으로 교정 저장" }));
  expect(a.saveEdit).toHaveBeenCalledTimes(1);
});
test("checking hides every private filename, draft and download command even if stale state is supplied", async () => {
  await render(
    <FilesScreen
      state={{
        ...base,
        gate: "checking",
        source: { name: "비공개 선택.txt", size: 3, type: "text/plain" },
      }}
      actions={actions()}
      onSession={jest.fn()}
      onWorkspace={jest.fn()}
    />,
    { wrapper },
  );
  expect(screen.queryByText("합성 원본.txt")).toBeNull();
  expect(screen.queryByText("비공개 선택.txt")).toBeNull();
  expect(screen.queryByRole("button", { name: "자료 목록 새로 확인" })).toBeNull();
});
test("coverage pages render at most 100 rows at a time and expose later missing pages", async () => {
  await render(
    <Coverage
      value={{
        category: "document",
        status: "partial",
        pageCount: 201,
        pages: Array.from({ length: 201 }, (_, i) => ({
          page: i + 1,
          status: i === 150 ? "missing" : "processed",
        })),
      }}
    />,
    { wrapper },
  );
  expect(screen.getByText("100쪽 · 확인 가능")).toBeTruthy();
  expect(screen.queryByText("151쪽 · 누락")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "페이지 처리 범위 다음 100개" }));
  expect(screen.getByText("151쪽 · 누락")).toBeTruthy();
  expect(screen.queryByText("1쪽 · 확인 가능")).toBeNull();
});
