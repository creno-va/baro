import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { validateSelfPhoto } from "../../src/server/modules/lawyers/self-profile";
import { emptySelfProfile } from "../../src/server/modules/lawyers/self-profile-contract";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-lawyer", name: "합성", accountType: "lawyer" },
        needsConsent: false,
      },
    }),
  );
});

test("portal saves photo and portfolio, previews, publishes to directory, refreshes and hides at 320px", async ({
  page,
}) => {
  let profile = emptySelfProfile("synthetic-owner-profile");
  let photoBytes: Buffer<ArrayBufferLike> = Buffer.from("");
  const photoAsset = () => ({
    assetId: "synthetic-photo",
    revision: 3,
    value: {
      id: "synthetic-photo",
      revision: 3,
      kind: "image",
      status: "ready",
      byteLength: photoBytes.length,
      originalHash: "a".repeat(64),
      sanitizedDerivative: {
        id: "synthetic-photo-derivative",
        contentHash: "a".repeat(64),
        byteLength: photoBytes.length,
        format: "jpeg",
      },
      currentJobId: null,
      failure: null,
    },
  });
  await page.route("**/api/v2/me/lawyer/profile", (route) =>
    route.fulfill({ json: { profileId: profile.id, revision: 1 } }),
  );
  await page.route("**/api/v2/me/lawyer/portfolio-assets", (route) =>
    route.fulfill({
      json: {
        assetId: "synthetic-photo",
        revision: 1,
        value: { request: { mediaType: "image/jpeg" } },
      },
    }),
  );
  await page.route("**/api/v2/me/lawyer/assets/synthetic-photo/content", (route) => {
    photoBytes = route.request().postDataBuffer() ?? Buffer.from("");
    validateSelfPhoto(`data:image/jpeg;base64,${photoBytes.toString("base64")}`);
    return route.fulfill({ json: photoAsset() });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v2/me/lawyer/self-profile**", async (route) => {
    const request = route.request();
    if (request.url().includes("/assets/"))
      return route.fulfill({ contentType: "image/jpeg", body: photoBytes });
    if (request.method() === "GET") return route.fulfill({ json: profile });
    const body = request.postDataJSON();
    if (body.profile?.photoUrl?.startsWith("data:")) validateSelfPhoto(body.profile.photoUrl);
    profile = request.url().endsWith("/publication")
      ? { ...profile, published: body.published, revision: profile.revision + 1 }
      : { ...body.profile, revision: profile.revision + 1, verificationStatus: "self_declared" };
    return route.fulfill({ json: profile });
  });
  await page.route("**/api/v2/lawyers**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/assets/"))
      return route.fulfill(
        profile.published
          ? { contentType: "image/jpeg", body: photoBytes }
          : { status: 404, json: {} },
      );
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
  expect(profile.photoUrl).toMatch(/self-service.*assets.*synthetic-photo/);
  expect(profile.photoAssetId).toBe("synthetic-photo");
  expect(profile.verificationStatus).toBe("self_declared");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/lawyer-portal-320.png", fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
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

test("peer-tab account switch removes old edits, preview and publication confirmation; stale saves are ignored", async ({
  page,
}) => {
  let user = { id: "owner-A", name: "A", accountType: "lawyer" };
  let profile = { ...emptySelfProfile("profile-A"), name: "A 저장 프로필" };
  let releaseSave: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveStarted = false;
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user, needsConsent: false } }),
  );
  await page.route("**/api/v2/me/lawyer/self-profile", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: profile });
    saveStarted = true;
    const previous = { ...route.request().postDataJSON().profile, revision: 2 };
    await saveGate;
    return route.fulfill({ json: previous });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("A 비공개 초안");
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect.poll(() => saveStarted).toBe(true);
  user = { id: "owner-B", name: "B", accountType: "lawyer" };
  profile = { ...emptySelfProfile("profile-B"), name: "B 저장 프로필" };
  await page.evaluate(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "baro-api-mock-v1:session" })),
  );
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("B 저장 프로필");
  releaseSave();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("B 저장 프로필");
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await page.getByLabel("내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.").check();
  user = { id: "customer", name: "고객", accountType: "customer" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("이름", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "동의하고 공개" })).toHaveCount(0);
  await expect(page.getByText("변호사 역할로 로그인해 주세요.", { exact: true })).toBeVisible();
});

test("a save checks the current account even without a focus/storage event", async ({ page }) => {
  let owner = "owner-A";
  let saves = 0;
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: { user: { id: owner, name: owner, accountType: "lawyer" }, needsConsent: false },
    }),
  );
  await page.route("**/api/v2/me/lawyer/self-profile", (route) => {
    if (route.request().method() !== "GET") {
      saves++;
      return route.fulfill({ json: emptySelfProfile("profile-B") });
    }
    return route.fulfill({
      json: { ...emptySelfProfile(owner === "owner-A" ? "profile-A" : "profile-B"), name: owner },
    });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("旧 owner draft");
  owner = "owner-B";
  await page.getByRole("button", { name: "프로필 저장" }).click();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("owner-B");
  expect(saves).toBe(0);
});

test("pending upload survives reconnect and can only attach after ready status", async ({
  page,
}) => {
  const profile = emptySelfProfile("synthetic-pending-profile");
  let ready = false;
  await page.route("**/api/v2/me/lawyer/profile", (route) =>
    route.fulfill({ json: { profileId: profile.id, revision: 1 } }),
  );
  await page.route("**/api/v2/me/lawyer/portfolio-assets", (route) =>
    route.fulfill({
      json: {
        assetId: "synthetic-pending",
        revision: 1,
        value: { request: { mediaType: "application/pdf" } },
      },
    }),
  );
  await page.route("**/api/v2/me/lawyer/assets/synthetic-pending/content", (route) =>
    route.fulfill({
      json: {
        assetId: "synthetic-pending",
        revision: 2,
        value: { request: { mediaType: "application/pdf" } },
      },
    }),
  );
  await page.route("**/api/v2/me/lawyer/self-profile**", (route) => {
    return route.fulfill({
      json: route.request().url().endsWith("/assets")
        ? {
            items: [
              {
                id: "synthetic-pending",
                revision: ready ? 3 : 2,
                status: ready ? "ready" : "uploaded",
                purpose: "portfolio",
              },
            ],
          }
        : profile,
    });
  });
  await page.goto("/lawyer");
  await page
    .getByLabel("포트폴리오 파일 (이미지·PDF)")
    .setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nsynthetic\n%%EOF"),
    });
  await expect(page.getByText("처리 대기는 공개 완료가 아니에요.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "프로필에 연결" })).toBeDisabled();
  await expect(page.getByLabel("활동 제목 1")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "자료 상태 확인" }).click();
  await expect(page.getByRole("button", { name: "프로필에 연결" })).toBeDisabled();
  ready = true;
  await page.getByRole("button", { name: "자료 상태 확인" }).click();
  await page.getByRole("button", { name: "프로필에 연결" }).click();
  await expect(page.getByLabel("활동 제목 1")).toHaveValue("공개 자료");
  await expect(page.getByRole("button", { name: "업로드 자료 삭제" })).toBeDisabled();
});
