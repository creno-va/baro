import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { DirectoryState } from "../src/features/directory/model";
import { DirectoryScreen } from "../src/features/directory/ui/DirectoryScreen";
import * as filters from "../src/features/directory/ui/Filter";

const initial: DirectoryState = {
  phase: "ready",
  query: "",
  region: "",
  practiceArea: "",
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
  const props = {
    onSearch: search,
    onMore: more,
    onRetry: retry,
    onRefresh: jest.fn(),
    onSelect: jest.fn(),
  };
  const view = await render(<DirectoryScreen state={initial} {...props} />, { wrapper });
  expect(screen.getByRole("header", { name: "공개된 프로필을 준비하고 있어요" })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("이름으로 검색"), "합성 이름");
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenCalledWith({ query: "합성 이름", region: "", practiceArea: "" });
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

test("directory selects labelled region/field filters and profile navigation stays explicit", async () => {
  const search = jest.fn(),
    select = jest.fn();
  await render(
    <DirectoryScreen
      state={{
        ...initial,
        items: [
          {
            id: "public_a",
            revision: 1,
            name: "합성 변호사",
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
      onSearch={search}
      onSelect={select}
      onRefresh={jest.fn()}
      onMore={jest.fn()}
      onRetry={jest.fn()}
    />,
    { wrapper },
  );
  await fireEvent.press(screen.getByRole("button", { name: "지역: 전체" }));
  await fireEvent.press(screen.getByRole("radio", { name: "지역 서울" }));
  await fireEvent.press(screen.getByRole("button", { name: "분야: 전체" }));
  await fireEvent.press(screen.getByRole("radio", { name: "분야 민사" }));
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenCalledWith({ query: "", region: "seoul", practiceArea: "civil" });
  expect(select).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "합성 변호사 공개 프로필 보기" }));
  expect(select).toHaveBeenCalledWith("public_a");
});

test("directory keeps draft edits outside filter renders and submits the final native text", async () => {
  const filterRender = jest.spyOn(filters, "DirectoryFilter");
  try {
    const search = jest.fn();
    await render(
      <DirectoryScreen
        state={initial}
        onSearch={search}
        onSelect={jest.fn()}
        onRefresh={jest.fn()}
        onMore={jest.fn()}
        onRetry={jest.fn()}
      />,
      { wrapper },
    );
    const before = filterRender.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const field = screen.getByLabelText("이름으로 검색");
    for (const text of ["합", "합성", "합성 이름"]) {
      await fireEvent.changeText(screen.getByLabelText("이름으로 검색"), text);
    }
    expect(filterRender).toHaveBeenCalledTimes(before);
    expect(screen.getByLabelText("이름으로 검색")).toBe(field);
    expect(field.props.value).toBeUndefined();
    expect(field.props.defaultValue).toBe("");
    await fireEvent.press(screen.getByRole("button", { name: "검색" }));
    expect(search).toHaveBeenLastCalledWith({ query: "합성 이름", region: "", practiceArea: "" });
    await fireEvent(screen.getByLabelText("이름으로 검색"), "submitEditing", {
      nativeEvent: { text: "합성 이름-마지막" },
    });
    expect(search).toHaveBeenLastCalledWith({
      query: "합성 이름-마지막",
      region: "",
      practiceArea: "",
    });
    expect(screen.getByLabelText("이름으로 검색")).toBe(field);
    expect(field.props.value).toBeUndefined();
    await fireEvent.press(screen.getByRole("button", { name: "검색" }));
    expect(search).toHaveBeenLastCalledWith({
      query: "합성 이름-마지막",
      region: "",
      practiceArea: "",
    });
  } finally {
    filterRender.mockRestore();
  }
});

test("directory preserves unsent drafts through list/filter updates and resets on committed filters", async () => {
  const search = jest.fn();
  const props = {
    onSearch: search,
    onSelect: jest.fn(),
    onRefresh: jest.fn(),
    onMore: jest.fn(),
    onRetry: jest.fn(),
  };
  const view = await render(<DirectoryScreen state={initial} {...props} />, { wrapper });
  const field = screen.getByLabelText("이름으로 검색");
  await fireEvent.changeText(screen.getByLabelText("이름으로 검색"), "미제출 원문 － A");
  await view.rerender(<DirectoryScreen state={{ ...initial, phase: "loading" }} {...props} />);
  expect(screen.getByLabelText("이름으로 검색")).toBe(field);
  expect(field.props.value).toBeUndefined();
  await fireEvent.press(screen.getByRole("button", { name: "지역: 전체" }));
  await fireEvent.press(screen.getByRole("radio", { name: "지역 서울" }));
  expect(screen.getByLabelText("이름으로 검색")).toBe(field);
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenLastCalledWith({
    query: "미제출 원문 － A",
    region: "seoul",
    practiceArea: "",
  });
  await view.rerender(<DirectoryScreen state={{ ...initial, query: "확정 원문" }} {...props} />);
  const committed = screen.getByLabelText("이름으로 검색");
  expect(committed).not.toBe(field);
  expect(committed.props.defaultValue).toBe("확정 원문");
  expect(committed.props.value).toBeUndefined();
  await fireEvent.changeText(screen.getByLabelText("이름으로 검색"), "새 초안");
  await view.rerender(
    <DirectoryScreen
      state={{ ...initial, query: "확정 원문", practiceArea: "civil" }}
      {...props}
    />,
  );
  const filtered = screen.getByLabelText("이름으로 검색");
  expect(filtered).not.toBe(committed);
  expect(filtered.props.defaultValue).toBe("확정 원문");
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenLastCalledWith({
    query: "확정 원문",
    region: "",
    practiceArea: "civil",
  });
  await view.rerender(<DirectoryScreen state={initial} {...props} />);
  expect(screen.getByLabelText("이름으로 검색")).not.toBe(filtered);
  expect(screen.getByLabelText("이름으로 검색").props.defaultValue).toBe("");
  await fireEvent.press(screen.getByRole("button", { name: "검색" }));
  expect(search).toHaveBeenLastCalledWith({ query: "", region: "", practiceArea: "" });
});
