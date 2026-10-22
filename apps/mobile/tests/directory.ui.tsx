import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { DirectoryState } from "../src/features/directory/model";
import { DirectoryScreen } from "../src/features/directory/ui/DirectoryScreen";

const initial: DirectoryState = {
  phase: "ready",
  query: "",
  items: [],
  nextCursor: null,
  error: null,
  loadingMore: false,
};
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

test("directory exposes labelled search, empty state, safe error retry, and user-driven paging", async () => {
  const search = jest.fn(),
    more = jest.fn(),
    retry = jest.fn();
  const props = { onSearch: search, onMore: more, onRetry: retry, onRefresh: jest.fn() };
  const view = await render(<DirectoryScreen state={initial} {...props} />, { wrapper });
  expect(screen.getByRole("header", { name: "공개된 프로필을 준비하고 있어요" })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("이름으로 검색"), "합성 이름");
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenCalledWith("합성 이름");
  await view.rerender(
    <DirectoryScreen
      state={{ ...initial, phase: "error", error: "다시 확인해 주세요." }}
      {...props}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(
    <DirectoryScreen
      state={{
        ...initial,
        nextCursor: "synthetic-cursor",
        items: [
          {
            id: "synthetic",
            name: "합성 변호사",
            revision: 1,
            officeName: "합성 사무소",
            introduction: "합성 소개",
            region: "seoul",
            practiceAreas: ["civil"],
            photoUrl: null,
            photoAssetId: null,
            verificationStatus: "self_declared",
          },
        ],
      }}
      {...props}
    />,
  );
  expect(screen.getByText("본인 작성 프로필")).toBeTruthy();
  expect(screen.queryByText("자격 확인 프로필")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "더 보기" }));
  expect(more).toHaveBeenCalledTimes(1);
});
