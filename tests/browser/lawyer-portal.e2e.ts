import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { validateSelfPhoto } from "../../src/server/modules/lawyers/self-profile";
import { emptySelfProfile } from "../../src/server/modules/lawyers/self-profile-contract";

test("portal saves photo and portfolio, previews, publishes to directory, refreshes and hides at 320px", async ({
  page,
}) => {
  let profile = emptySelfProfile("synthetic-owner-profile");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v2/me/lawyer/self-profile**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: profile });
    const body = request.postDataJSON();
    if (body.profile?.photoUrl) validateSelfPhoto(body.profile.photoUrl);
    profile = request.url().endsWith("/publication")
      ? { ...profile, published: body.published, revision: profile.revision + 1 }
      : { ...body.profile, revision: profile.revision + 1, verificationStatus: "self_declared" };
    return route.fulfill({ json: profile });
  });
  await page.route("**/api/v2/lawyers**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v2/lawyers")
      return route.fulfill({
        json: {
          schemaVersion: "2",
          snapshotId: "synthetic-list",
          rotation: "disclosed_rotation",
          expiresAt: "2026-10-06T00:05:00Z",
          items: [],
          nextCursor: null,
        },
      });
    if (url.pathname === "/api/v2/lawyers/self-service")
      return route.fulfill({
        json: { items: profile.published ? [profile] : [], nextCursor: null },
      });
    return route.fulfill(profile.published ? { json: profile } : { status: 404, json: {} });
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/lawyer");
  await expect(page.getByRole("heading", { name: "내 변호사 프로필" })).toBeVisible();
  await expect(page.getByLabel("이름", { exact: true })).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill("합성 변호사");
  await page.getByLabel("사무실 이름").fill("예시 사무실");
  await page.getByLabel("소개", { exact: true }).fill("사실관계 정리를 돕는 합성 소개");
  await page.getByLabel("민사", { exact: true }).check();
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("seoul");
  await page.getByLabel("사무실 주소").fill("서울 서초구 합성로 1");
  await page.getByLabel("이메일", { exact: true }).fill("lawyer@example.invalid");
  await page.getByLabel("전화번호").fill("02-000-0000");
  await page.getByLabel("웹사이트 / 외부 상담 URL").fill("https://example.com");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, 32, 32);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("프로필 사진").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png ?? "", "base64"),
  });
  await expect(page.getByRole("img", { name: "내 프로필 사진" })).toBeVisible();
  await page.getByRole("button", { name: "포트폴리오 추가" }).click();
  await page.getByLabel("활동 제목 1").fill("합성 공개 활동");
  await page.getByLabel("자료 URL 1").fill("https://example.com/portfolio");
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 변호사", exact: true })).toBeVisible();
  await expect(page.getByText("본인 작성 정보입니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "포트폴리오 보기" })).toHaveAttribute(
    "href",
    "https://example.com/portfolio",
  );
  await page.getByRole("button", { name: "편집으로 돌아가기" }).click();
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("합성 변호사");
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await expect(page.getByRole("button", { name: "동의하고 공개" })).toBeDisabled();
  await page.getByLabel("내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.").check();
  await page.getByRole("button", { name: "동의하고 공개" }).click();
  await expect(page.getByText("공개 중", { exact: true })).toBeVisible();
  expect(profile.photoUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(profile.verificationStatus).toBe("self_declared");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/lawyer-portal-320.png", fullPage: true });
  await page.getByRole("link", { name: "변호사 디렉터리" }).click();
  await expect(page.getByRole("link", { name: "합성 변호사", exact: true })).toBeVisible();
  await expect(page.getByText("본인 작성 정보 · 자격 확인 표시 없음")).toBeVisible();
  await page.getByRole("link", { name: "프로필과 연락처 보기" }).click();
  await expect(page.getByRole("link", { name: "전화", exact: true })).toHaveAttribute(
    "href",
    "tel:020000000",
  );
  await expect(page.getByRole("link", { name: "이메일", exact: true })).toHaveAttribute(
    "href",
    "mailto:lawyer%40example.invalid",
  );
  await expect(page.getByRole("link", { name: "Google 길찾기" })).toHaveAttribute(
    "href",
    /destination=/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.goto("/lawyer");
  await page.getByRole("button", { name: "비공개로 전환" }).click();
  await expect(page.getByText("비공개", { exact: true })).toBeVisible();
  await page.goto("/lawyers");
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
  await page.goto(`/lawyers/${profile.id}`);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
});

test("keyboard cancel, save error/retry and stale revision preserve the user's draft", async ({
  page,
}) => {
  let profile = emptySelfProfile("synthetic-retry-profile");
  let fail = true;
  await page.route("**/api/v2/me/lawyer/self-profile", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: profile });
    if (fail) return route.fulfill({ status: 409, json: {} });
    profile = { ...route.request().postDataJSON().profile, revision: profile.revision + 1 };
    return route.fulfill({ json: profile });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("수정 중");
  await page.getByRole("button", { name: "프로필 저장" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("다른 화면에서 변경됐어요.");
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("수정 중");
  fail = false;
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill("취소할 변경");
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await page.getByRole("button", { name: "계속 편집" }).click();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("취소할 변경");
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await page.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("수정 중");
});
