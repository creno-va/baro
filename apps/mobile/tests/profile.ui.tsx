import { emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { createProfileModel, type ProfileState } from "../src/features/profile/model";
import { ProfileScreen } from "../src/features/profile/ui/ProfileScreen";

const profile = {
  ...emptySelfProfile("profile_a", "합성 변호사"),
  introduction: "합성 소개",
  officeName: "합성 사무소",
  address: "합성 주소",
  region: "seoul" as const,
  practiceAreas: ["civil" as const],
  email: "synthetic@example.invalid",
};
const ready: ProfileState = {
  gate: "ready",
  canWrite: true,
  profile,
  draft: profile,
  assets: [
    { id: "asset_a", revision: 3, status: "ready", purpose: "profile_photo", kind: "image" },
    { id: "pending_a", revision: 2, status: "uploaded", purpose: "portfolio", kind: "pdf" },
  ],
  selected: null,
  download: null,
  busy: null,
  uncertain: null,
  conflict: false,
  confirm: null,
  publicationConsent: false,
  confirmation: "",
  error: null,
  notice: null,
};
function actions() {
  const model = createProfileModel({
    session: {
      getSnapshot: () => ({
        phase: "anonymous",
        busy: false,
        role: "customer",
        error: null,
        consent: null,
        session: null,
      }),
      subscribe: () => () => {},
      refresh: async () => {},
    },
    createClient: () => {
      throw new Error("SCREEN_DOES_NOT_START_IO");
    },
    select: async () => null,
    release: async () => {},
    discard: async () => {},
    present: async () => {},
    newId: () => "unused",
  });
  return {
    ...model,
    field: jest.fn(),
    practice: jest.fn(),
    save: jest.fn(),
    requestPublication: jest.fn(),
    publicationConsent: jest.fn(),
    confirmation: jest.fn(),
    confirmAction: jest.fn(),
    attach: jest.fn(),
    requestRemove: jest.fn(),
    preview: jest.fn(),
    retryUnconfirmed: jest.fn(),
  };
}
test("own profile renders editable domain fields, distinguishes self declaration and only enables ready asset actions", async () => {
  const handlers = actions();
  await render(
    <ProfileScreen state={ready} actions={handlers} onSession={jest.fn()} onPublic={jest.fn()} />,
  );
  expect(screen.getByText(/역할 선택이나 공개는 변호사 자격 확인을 뜻하지/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("사무소 주소"), "새 합성 주소");
  expect(handlers.field).toHaveBeenCalledWith("address", "새 합성 주소");
  await fireEvent.press(screen.getByRole("checkbox", { name: "민사" }));
  expect(handlers.practice).toHaveBeenCalledWith("civil");
  await fireEvent.press(screen.getByRole("button", { name: "프로필 사진 1 프로필에 연결" }));
  expect(handlers.attach).toHaveBeenCalledWith("asset_a");
  await fireEvent.press(screen.getByRole("button", { name: "포트폴리오 자료 2 프로필에 연결" }));
  expect(handlers.attach).toHaveBeenCalledTimes(1);
  expect(handlers.save).not.toHaveBeenCalled();
  expect(screen.queryByText("asset_a")).toBeNull();
});
test("consent renewal leaves ready preview readable while edits/upload/publication/delete are disabled and session gates hide private fields", async () => {
  const handlers = actions(),
    onSession = jest.fn();
  const view = await render(
    <ProfileScreen
      state={{ ...ready, canWrite: false }}
      actions={handlers}
      onSession={onSession}
      onPublic={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("이름").props.editable).toBe(false);
  expect(screen.queryByRole("button", { name: "프로필 공개 준비" })).toBeNull();
  expect(screen.queryByRole("button", { name: "프로필 공개 철회" })).toBeNull();
  for (const label of ["프로필 사진 파일 선택", "프로필 사진 1 삭제", "프로필 저장"])
    expect(screen.getByRole("button", { name: label }).props.accessibilityState.disabled).toBe(
      true,
    );
  await fireEvent.press(screen.getByRole("button", { name: "프로필 사진 1 비공개 미리보기 준비" }));
  expect(handlers.preview).toHaveBeenCalledWith("asset_a");
  await fireEvent.press(screen.getByRole("button", { name: "필수 동의 확인" }));
  expect(onSession).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ProfileScreen
      state={{ ...ready, gate: "checking" }}
      actions={handlers}
      onSession={onSession}
      onPublic={jest.fn()}
    />,
  );
  expect(screen.queryByDisplayValue("합성 변호사")).toBeNull();
  expect(screen.queryByRole("button", { name: "프로필 사진 1 삭제" })).toBeNull();
});
test("publication disclosure and exact DELETE require separate explicit confirmation; attached assets cannot be deleted", async () => {
  const handlers = actions();
  const view = await render(
    <ProfileScreen
      state={{ ...ready, confirm: { kind: "publish", published: true } }}
      actions={handlers}
      onSession={jest.fn()}
      onPublic={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "확인하고 진행" }));
  expect(handlers.confirmAction).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("checkbox", { name: /비로그인 이용자에게 공개/ }));
  expect(handlers.publicationConsent).toHaveBeenCalledWith(true);
  await view.rerender(
    <ProfileScreen
      state={{
        ...ready,
        confirm: { kind: "remove", assetId: "asset_a", revision: 3 },
        confirmation: "DELETE",
      }}
      actions={handlers}
      onSession={jest.fn()}
      onPublic={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "확인하고 진행" }));
  expect(handlers.confirmAction).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ProfileScreen
      state={{
        ...ready,
        draft: {
          ...profile,
          photoAssetId: "asset_a",
          photoUrl: "/api/v2/lawyers/self-service/profile_a/assets/asset_a",
        },
      }}
      actions={handlers}
      onSession={jest.fn()}
      onPublic={jest.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "프로필 사진 1 삭제" }).props.accessibilityState.disabled,
  ).toBe(true);
});
test("uncertain conflicting save keeps typed input but disables resend until a deliberate read/reload", async () => {
  const handlers = actions();
  await render(
    <ProfileScreen
      state={{
        ...ready,
        uncertain: "save",
        conflict: true,
        draft: { ...profile, name: "보존할 입력" },
      }}
      actions={handlers}
      onSession={jest.fn()}
      onPublic={jest.fn()}
    />,
  );
  expect(screen.getByDisplayValue("보존할 입력")).toBeTruthy();
  expect(screen.getByLabelText("이름").props.editable).toBe(false);
  expect(screen.queryByRole("button", { name: "프로필 공개 준비" })).toBeNull();
  expect(screen.queryByRole("button", { name: "프로필 공개 철회" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "이전 요청 직접 다시 확인" }));
  expect(handlers.retryUnconfirmed).not.toHaveBeenCalled();
  expect(handlers.save).not.toHaveBeenCalled();
});
