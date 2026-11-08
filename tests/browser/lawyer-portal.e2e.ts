import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { validateSelfPhoto } from "../../src/server/modules/lawyers/self-profile";
import { emptySelfProfile } from "../../src/server/modules/lawyers/self-profile-contract";
import { installLegacyLawyerPages } from "../helpers/legacy-lawyer-pages";

function readyProfile(id: string, name = "합성 변호사") {
  return {
    ...emptySelfProfile(id),
    name,
    introduction: "합성 소개",
    officeName: "합성 사무실",
    address: "합성 주소",
    region: "seoul" as const,
    practiceAreas: ["civil" as const],
    email: "synthetic@example.invalid",
    published: true,
  };
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(v2\/)?cases\?/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-lawyer", name: "합성", accountType: "lawyer" },
        needsConsent: false,
      },
    }),
  );
});

test.beforeEach(async ({ page }) => {
  await installLegacyLawyerPages(page);
});

test("portal saves one portfolio file without header actions or a sticky divider at 320px", async ({
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
      : {
          ...body.profile,
          revision: profile.revision + 1,
          published: true,
          verificationStatus: "self_declared",
        };
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
    if (url.pathname === "/api/v2/lawyers/directory")
      return route.fulfill({
        json: {
          items: profile.published
            ? [
                {
                  id: profile.id,
                  revision: profile.revision,
                  name: profile.name,
                  officeName: profile.officeName,
                  introduction: profile.introduction,
                  region: profile.region,
                  practiceAreas: profile.practiceAreas,
                  photoUrl: profile.photoUrl,
                  photoAssetId: profile.photoAssetId,
                  verificationStatus: profile.verificationStatus,
                },
              ]
            : [],
          nextCursor: null,
          expiresAt: "2099-01-01T00:00:00Z",
          rotation: { day: "2026-10-14", algorithm: "daily_sha256_pivot_v1" },
        },
      });
    return route.fulfill(profile.published ? { json: profile } : { status: 404, json: {} });
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/lawyer");
  await page.locator('astro-island[component-export="Editor"]:not([ssr])').waitFor();
  await expect(page.getByRole("heading", { name: "내 변호사 프로필" })).toBeVisible();
  await expect(page.getByLabel("이름", { exact: true })).toBeVisible();
  const nameField = page.getByLabel("이름", { exact: true });
  const checkFieldStyles = async () => {
    const actual = await page.locator("#lawyer-profile-form").evaluate((form) => {
      const name = form.querySelector('[aria-label="이름"]');
      const intro = form.querySelector("textarea");
      const select = form.querySelector(".lawyer-select select");
      const arrow = form.querySelector(".lawyer-select > svg");
      if (!name || !intro || !select || !arrow) throw new Error("Missing synthetic profile inputs");
      const properties = [
        "background-color",
        "border-radius",
        "border-top-color",
        "padding-left",
        "font-size",
      ];
      const styles = [name, intro, select].map((node) =>
        properties.map((property) => getComputedStyle(node).getPropertyValue(property)),
      );
      const rect = select.getBoundingClientRect(),
        icon = arrow.getBoundingClientRect();
      return {
        styles,
        appearance: getComputedStyle(select).appearance,
        paddingRight: getComputedStyle(select).paddingRight,
        rightGap: rect.right - icon.right,
        centerDelta: rect.top + rect.height / 2 - icon.top - icon.height / 2,
      };
    });
    expect(actual.styles[0]).toEqual(actual.styles[1]);
    expect(actual.styles[2]).toEqual(actual.styles[1]);
    expect(actual.appearance).toBe("none");
    expect(actual.paddingRight).toBe("48px");
    expect(actual.rightGap).toBe(16);
    expect(Math.abs(actual.centerDelta)).toBeLessThan(1);
    const layout = await page.locator("#lawyer-profile-form").evaluate((form) => {
      const card = form.querySelector(".lawyer-editor-sections");
      const footer = form.querySelector(".lawyer-form-footer");
      const button = footer?.querySelector("button");
      if (!card || !footer || !button) throw new Error("Missing synthetic profile save action");
      const surface = card.getBoundingClientRect(),
        action = button.getBoundingClientRect();
      return {
        x: surface.x,
        width: surface.width,
        actionX: action.x,
        actionWidth: action.width,
        gap: action.y - surface.bottom,
        height: action.height,
        divider: getComputedStyle(footer).borderTopWidth,
      };
    });
    expect(layout.actionX).toBe(layout.x);
    expect(layout.actionWidth).toBe(layout.width);
    expect(layout.gap).toBe(24);
    expect(layout.height).toBeGreaterThanOrEqual(56);
    expect(layout.divider).toBe("0px");
  };
  await checkFieldStyles();
  await page.getByLabel("이름", { exact: true }).fill("합성 변호사");
  await page.getByLabel("사무실 이름").fill("예시 사무실");
  await page.getByLabel("소개", { exact: true }).fill("사실관계 정리를 돕는 합성 소개");
  await page.getByLabel("민사", { exact: true }).check();
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("seoul");
  await page.getByLabel("사무실 주소").fill("서울 서초구 합성로 1");
  await page.getByLabel("이메일", { exact: true }).fill("lawyer@example.invalid");
  await page.getByLabel("전화번호").fill("02-000-0000");
  await page.getByLabel("웹사이트 / 외부 상담 URL").fill("https://example.com");
  expect(errors).toEqual([]);
  await expect(nameField).toHaveValue("합성 변호사");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkFieldStyles();
  expect((await page.locator(".lawyer-photo-surface").boundingBox())?.height).toBeLessThanOrEqual(
    100,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: ".wrangler/lawyer-editor-1440.png", fullPage: true });
  const fields = await page
    .locator(".lawyer-fields--three")
    .first()
    .locator("label")
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(new Set(fields).size).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator(".lawyer-editor .page-header")).toHaveCSS("position", "static");
  await page.screenshot({ path: ".wrangler/lawyer-editor-sticky.png" });

  await expect(
    page.locator(".sidebar-desktop").getByRole("link", { name: "새 사건 입력", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "공개 디렉터리", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.evaluate(() => window.scrollTo(0, 0));
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
  await expect(page.locator(".lawyer-editor .page-header").getByRole("button")).toHaveCount(0);
  await expect(page.locator(".lawyer-editor .page-header")).toHaveCSS("position", "static");
  await expect(page.locator(".lawyer-editor .page-header")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.getByRole("button", { name: "자료 상태 확인", exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const modulePath = "/src/client/api/lawyers.ts";
    const { lawyerAssets } = await import(modulePath);
    lawyerAssets.upload = async (_profileId: string, file: File) => ({
      id: file.name === "replacement.pdf" ? "synthetic-portfolio-2" : "synthetic-portfolio",
      revision: 3,
      status: "ready",
      purpose: "portfolio",
      kind: "pdf",
    });
  });
  await page.getByLabel("포트폴리오 파일", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 synthetic"),
  });
  await expect(page.locator(".lawyer-portfolio-upload")).toContainText("synthetic.pdf");
  await expect(page.getByLabel("포트폴리오 파일", { exact: true })).toBeEnabled();
  await page.getByLabel("포트폴리오 파일", { exact: true }).setInputFiles({
    name: "replacement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 replacement"),
  });
  await expect(page.locator(".lawyer-portfolio-upload")).toContainText("replacement.pdf");

  await expect(page.getByRole("button", { name: "포트폴리오 추가" })).toHaveCount(0);
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('astro-island[component-export="Editor"]:not([ssr])').waitFor();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("합성 변호사");
  expect(profile.published).toBe(true);
  await expect(page.getByRole("button", { name: "프로필 공개", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 취소", exact: true })).toHaveCount(0);
  expect(profile.photoUrl).toMatch(/self-service.*assets.*synthetic-photo/);
  expect(profile.photoAssetId).toBe("synthetic-photo");
  expect(profile.portfolio).toHaveLength(1);
  expect(profile.portfolio[0]?.assetId).toBe("synthetic-portfolio-2");
  expect(profile.verificationStatus).toBe("self_declared");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/lawyer-portal-320.png", fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() =>
      page
        .locator(".lawyer-editor .page-header")
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(0);
  await page.screenshot({ path: ".wrangler/lawyer-editor-mobile-header.png" });

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
  await page.goto("/lawyers");
  await expect(page.getByRole("link", { name: "합성 변호사", exact: true })).toBeVisible();
  await expect(page.getByText("본인 작성 정보 · 자격 확인 표시 없음")).toBeVisible();
  await page.locator("a.directory-profile").click();
  await page.getByRole("button", { name: "연락처 보기", exact: true }).click();
  const contact = page.getByRole("dialog", { name: "연락처", exact: true });
  await expect(contact.getByRole("link", { name: "02-000-0000", exact: true })).toHaveAttribute(
    "href",
    "tel:020000000",
  );
  await expect(
    contact.getByRole("link", { name: "lawyer@example.invalid", exact: true }),
  ).toHaveAttribute("href", "mailto:lawyer%40example.invalid");
  await page.keyboard.press("Escape");
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
  await expect(page.getByRole("button", { name: "비공개로 전환" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keyboard save, error/retry and footer save preserve the user's draft", async ({ page }) => {
  let profile = readyProfile("synthetic-retry-profile");
  let fail = true;
  await page.route("**/api/v2/me/lawyer/self-profile", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: profile });
    if (fail) return route.fulfill({ status: 409, json: {} });
    profile = { ...route.request().postDataJSON().profile, revision: profile.revision + 1 };
    return route.fulfill({ json: profile });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("수정 중");
  await page.getByRole("button", { name: "프로필 저장", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("다른 화면에서 변경됐어요.");
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("수정 중");
  fail = false;
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill("취소할 변경");
  await expect(page.getByRole("button", { name: "변경 취소", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  expect(profile.name).toBe("취소할 변경");
});

test("peer-tab account switch removes old edits, preview and publication confirmation; stale saves are ignored", async ({
  page,
}) => {
  let user = { id: "owner-A", name: "A", accountType: "lawyer" };
  let profile = { ...readyProfile("profile-A"), name: "A 저장 프로필" };
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
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect.poll(() => saveStarted).toBe(true);
  user = { id: "owner-B", name: "B", accountType: "lawyer" };
  profile = { ...readyProfile("profile-B"), name: "B 저장 프로필" };
  await page.evaluate(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "baro-api-mock-v1:session" })),
  );
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("B 저장 프로필");
  releaseSave();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("B 저장 프로필");
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toHaveCount(0);
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
      return route.fulfill({ json: readyProfile("profile-B") });
    }
    return route.fulfill({
      json: { ...readyProfile(owner === "owner-A" ? "profile-A" : "profile-B"), name: owner },
    });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("旧 owner draft");
  owner = "owner-B";
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
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
            nextCursor: null,
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
  await page.getByLabel("포트폴리오 파일", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsynthetic\n%%EOF"),
  });
  await expect(
    page.getByText("자료를 처리하고 있어요. 완료되면 자동으로 연결해요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByLabel("포트폴리오 파일", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsynthetic\n%%EOF"),
  });
  ready = true;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(
    page.getByText("자료를 연결했어요. 프로필을 저장하면 반영돼요.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lawyer-portfolio-upload")).toContainText("synthetic.pdf");
  await expect(page.getByRole("button", { name: "자료 상태 확인" })).toHaveCount(0);
});

test("failed old-owner save cannot retain the draft after an account switch without browser events", async ({
  page,
}) => {
  let account = "synthetic-first";
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: { user: { id: account, name: account, accountType: "lawyer" }, needsConsent: false },
    }),
  );
  await page.route("**/api/v2/me/lawyer/self-profile", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: readyProfile(account, account) });
    started = true;
    await pending;
    return route.fulfill({
      status: 409,
      json: { error: { code: "STALE_REVISION", message: "합성 이전 요청 실패", retryable: false } },
    });
  });
  await page.goto("/lawyer");
  await page.getByLabel("이름", { exact: true }).fill("이전 계정의 비공개 초안");
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  account = "synthetic-second";
  release();
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("synthetic-second");
  await expect(page.getByText("합성 이전 요청 실패", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeDisabled();
});

test("historical text portfolio remains public on unrelated edits and can be removed from the single slot", async ({
  page,
}) => {
  const body = "첫 번째 문단입니다.\n<script>window.untrusted = true</script>\n마지막 문단";
  let profile = {
    ...readyProfile("text-portfolio"),
    portfolio: [{ id: "legacy-text", title: "기존 활동", text: body, url: null }],
  };
  await page.route("**/api/v2/me/lawyer/self-profile", (route) => {
    if (route.request().method() === "PUT")
      profile = { ...route.request().postDataJSON().profile, revision: profile.revision + 1 };
    return route.fulfill({ json: profile });
  });
  await page.route("**/api/v2/lawyers/self-service/text-portfolio", (route) =>
    route.fulfill({ json: profile }),
  );
  await page.goto("/lawyer");
  await expect(page.locator(".lawyer-portfolio-upload")).toContainText("기존 활동");
  await page.locator("textarea").first().fill("소개 수정");
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  expect(profile.portfolio[0]?.text).toBe(body);
  await page.goto("/lawyers/text-portfolio");
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => "untrusted" in window)).toBe(false);
  await page.goto("/lawyer");
  await page.getByRole("button", { name: "포트폴리오 파일 제거", exact: true }).click();
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  expect(profile.portfolio).toEqual([]);
  await expect(page.getByLabel("포트폴리오 파일", { exact: true })).toHaveCount(1);
  await expect(page.getByText("등록된 포트폴리오가 없어요.", { exact: true })).toHaveCount(0);
});

test("renewal keeps existing profile and uploaded download available while edits/publication stay disabled", async ({
  page,
}) => {
  let needsConsent = false;
  let owner = "synthetic-lawyer";
  let writes = 0;
  const profile = {
    ...emptySelfProfile("renewal-profile"),
    name: "기존 프로필",
    portfolio: [{ id: "text", title: "기존 제목", text: "기존 본문", url: null }],
  };
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: { user: { id: owner, name: "합성", accountType: "lawyer" }, needsConsent },
    }),
  );
  await page.route("**/api/v2/me/lawyer/self-profile**", (route) => {
    if (route.request().method() !== "GET") writes++;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/content"))
      return route.fulfill({
        contentType: "application/pdf",
        body: "%PDF-1.4 synthetic saved artifact",
      });
    if (path.endsWith("/assets"))
      return route.fulfill({
        json: {
          nextCursor: null,
          items: [{ id: "saved-upload", revision: 3, status: "ready", purpose: "portfolio" }],
        },
      });
    return owner === "synthetic-lawyer"
      ? route.fulfill({ json: profile })
      : route.fulfill({
          status: 403,
          json: { error: { code: "CONSENT_REQUIRED", message: "동의 필요" } },
        });
  });
  await page.goto("/lawyer");
  await page.locator("textarea").first().fill("저장하지 않은 초안");
  needsConsent = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("재동의 전에도 기존 프로필과 자료를 확인할 수 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("기존 본문", { exact: true })).toBeVisible();
  await expect(page.getByText("저장하지 않은 초안", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "프로필 공개", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "자료 상태 확인", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "업로드 자료 1 다운로드", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("pdf");
  await page.setViewportSize({ width: 320, height: 760 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/lawyer-renewal-320.png", fullPage: true });
  expect(writes).toBe(0);
  let releaseDownload!: () => void;
  let downloadStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    downloadStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  let lateDownloads = 0;
  page.on("download", () => {
    lateDownloads++;
  });
  await page.route("**/assets/saved-upload/content", async (route) => {
    downloadStarted();
    await release;
    await route.fulfill({
      contentType: "application/pdf",
      body: "%PDF-1.4 synthetic saved artifact",
    });
  });
  await page.getByRole("button", { name: "업로드 자료 1 다운로드", exact: true }).click();
  await started;
  owner = "different-lawyer";
  releaseDownload();
  await expect(page.getByText("필수 동의를 확인해 주세요.", { exact: true })).toBeVisible();
  expect(lateDownloads).toBe(0);
  await expect(page.getByText("기존 본문", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "업로드 자료 1 다운로드", exact: true }),
  ).toHaveCount(0);
});
