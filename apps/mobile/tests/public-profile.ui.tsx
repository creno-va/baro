import { emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { PublicProfileState } from "../src/features/directory/profile";
import { PublicProfileScreen } from "../src/features/directory/ui/ProfileScreen";

const ready: PublicProfileState = {
  phase: "ready",
  id: "public_a",
  error: null,
  opening: false,
  actionError: null,
  profile: {
    ...emptySelfProfile("public_a", "합성 변호사"),
    published: true,
    region: "seoul",
    practiceAreas: ["civil"],
    officeName: "합성 사무소",
    introduction: "합성 소개",
    phone: "02-1234-5678",
    email: "synthetic@example.invalid",
    website: "https://contact.baro.site/",
    photoUrl: "/api/v2/lawyers/self-service/public_a/assets/photo_a",
    photoAssetId: "photo_a",
    portfolio: [
      {
        id: "item_a",
        title: "합성 포트폴리오",
        text: "합성 본문",
        url: "https://contact.baro.site/portfolio",
      },
    ],
  },
};
test("public profile distinguishes self declaration and only opens explicitly selected public contacts/assets", async () => {
  const open = jest.fn();
  await render(
    <PublicProfileScreen state={ready} onOpen={open} onRefresh={jest.fn()} onBack={jest.fn()} />,
  );
  expect(screen.getByText("본인 작성 프로필 · 자격 확인을 뜻하지 않아요")).toBeTruthy();
  expect(screen.queryByText("자격 확인 프로필")).toBeNull();
  expect(screen.getByText("서울 · 민사")).toBeTruthy();
  expect(screen.getByText("합성 본문")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  for (const [label, action] of [
    ["전화 앱 열기", { kind: "phone" }],
    ["이메일 앱 열기", { kind: "email" }],
    ["공개 연락 웹사이트 열기", { kind: "website" }],
    ["공개 프로필 사진 보기", { kind: "photo" }],
    ["합성 포트폴리오 공개 자료 열기", { kind: "portfolio", id: "item_a" }],
  ] as const) {
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(open).toHaveBeenLastCalledWith(action);
  }
});
test("pending public-authority refresh and failed withdrawal remove previous personal contact controls", async () => {
  const open = jest.fn(),
    refresh = jest.fn();
  const view = await render(
    <PublicProfileScreen
      state={{ ...ready, opening: true }}
      onOpen={open}
      onRefresh={refresh}
      onBack={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "전화 앱 열기" }));
  expect(open).not.toHaveBeenCalled();
  await view.rerender(
    <PublicProfileScreen
      state={{ ...ready, phase: "loading", profile: null }}
      onOpen={open}
      onRefresh={refresh}
      onBack={jest.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "전화 앱 열기" })).toBeNull();
  expect(screen.queryByText("02-1234-5678")).toBeNull();
  await view.rerender(
    <PublicProfileScreen
      state={{ ...ready, phase: "error", profile: null, error: "공개된 프로필이 없어요." }}
      onOpen={open}
      onRefresh={refresh}
      onBack={jest.fn()}
    />,
  );
  expect(screen.queryByText("합성 변호사")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "프로필 다시 확인" }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
