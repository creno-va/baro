import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("integrated lawyer login/consent/editor uses persistent API mock with no real requests", async ({
  page,
}) => {
  test.skip(process.env.PUBLIC_API_MODE !== "mock", "Explicit mock transport scenario");
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("radio", { name: /변호사/ }).check();
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /이용약관, 개인정보 처리방침/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
  await expect(page).toHaveURL(/\/lawyer/);
  await page.getByLabel("이름", { exact: true }).fill("E 통합 시연 변호사");
  await page.getByLabel("사무실 이름").fill("합성 시연 사무실");
  await page.getByLabel("소개", { exact: true }).fill("API 예시 응답으로 확인하는 프로필입니다.");
  await page.getByLabel("민사", { exact: true }).check();
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("seoul");
  await page.getByLabel("사무실 주소").fill("서울 서초구 합성로 1");
  await page.getByLabel("이메일", { exact: true }).fill("demo@example.invalid");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
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
  await page.getByLabel("활동 제목 1").fill("합성 포트폴리오");
  await page.getByLabel("자료 URL 1").fill("https://example.com/portfolio");
  await page.getByLabel("포트폴리오 파일 (이미지·PDF)").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsynthetic offline adapter input\n%%EOF"),
  });
  await page.getByLabel("활동 제목 2").fill("합성 PDF 포트폴리오");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("E 통합 시연 변호사");
  await expect(page.getByRole("img", { name: "내 프로필 사진" })).toBeVisible();
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await page.getByRole("checkbox", { name: /내 사진과 연락처를 포함한/ }).check();
  await page.getByRole("button", { name: "동의하고 공개" }).click();
  await expect(page.getByText("공개 중", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "변호사 디렉터리" }).click();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByLabel("이름 또는 사무실", { exact: true }).fill("E 통합 시연 변호사");
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("seoul");
  await page.getByRole("combobox", { name: "분야", exact: true }).selectOption("civil");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("link", { name: "프로필과 연락처 보기" })).toHaveCount(1);
  await page.getByRole("link", { name: "프로필과 연락처 보기" }).click();
  await expect(
    page.getByRole("heading", { name: "E 통합 시연 변호사", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "이메일", exact: true })).toHaveAttribute(
    "href",
    "mailto:demo%40example.invalid",
  );
  await expect(page.getByText("본인·자격·사무실 수동 확인", { exact: false })).toHaveCount(0);
  await expect(page.getByText("본인 작성 정보입니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: "E 통합 시연 변호사 프로필 사진" })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "합성 PDF 포트폴리오 자료 다운로드" }).click();
  expect((await downloaded).suggestedFilename()).toContain("합성 PDF 포트폴리오");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("heading", { name: "E 통합 시연 변호사", exact: true }).click();
  await page.screenshot({ path: ".wrangler/lawyer-api-mock-390.png", fullPage: true });
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baro-api-mock-v1:lawyers") ?? "{}"),
  );
  expect(snapshot.owners["example-lawyer"]).toBeTruthy();
  const id = snapshot.owners["example-lawyer"];
  expect(snapshot.profiles.find((profile: { id: string }) => profile.id === id).photoUrl).toMatch(
    /self-service.*assets/,
  );
  await page.goto("/lawyer");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "비공개로 전환" }).click();
  await expect(page.getByText("프로필을 비공개로 전환했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("비공개", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 상태 확인" }).click();
  await expect(page.getByRole("button", { name: "업로드 자료 삭제" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "업로드 자료 삭제" }).nth(1)).toBeDisabled();
  await page.getByRole("button", { name: "포트폴리오 2 삭제" }).click();
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "업로드 자료 삭제" }).nth(1).click();
  await expect(page.getByText("자료 삭제를 접수했어요.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "업로드 자료 삭제" })).toHaveCount(1);
  await page.goto(`/lawyers/${id}`);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requests).toEqual([]);
});
