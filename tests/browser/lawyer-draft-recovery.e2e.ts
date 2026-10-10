import { expect, test } from "@playwright/test";

test("publication confirmation preserves edits made after opening it", async ({ page }) => {
  let publications = 0;
  const profile = {
    id: "synthetic-profile",
    revision: 2,
    name: "Synthetic lawyer",
    introduction: "Saved introduction",
    officeName: "Synthetic office",
    address: "Synthetic address",
    region: "",
    practiceAreas: [],
    phone: "010-1234-5678",
    email: "",
    website: "",
    photoAssetId: null,
    photoUrl: null,
    portfolio: [],
    published: false,
    verificationStatus: "self_declared",
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
          needsConsent: false,
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile") return route.fulfill({ json: profile });
    if (path.endsWith("/publication")) {
      publications++;
      return route.fulfill({ json: profile });
    }
    if (path.endsWith("/assets")) return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/lawyer");
  const intro = page.locator("textarea").first();
  await expect(intro).toHaveValue(profile.introduction);
  await page.getByRole("button", { name: "프로필 공개", exact: true }).click();
  await intro.fill("Unsaved revised introduction");
  await page
    .getByLabel("내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.", { exact: true })
    .check();
  await expect(page.getByRole("button", { name: "동의하고 공개", exact: true })).toBeDisabled();
  await expect(intro).toHaveValue("Unsaved revised introduction");
  expect(publications).toBe(0);
});

test("selecting another ready photo replaces an uploaded photo preview before saving", async ({
  page,
}) => {
  let photoBReads = 0;
  let savedPhoto: string | null = null;
  let profile = {
    id: "synthetic-photo-profile",
    revision: 2,
    name: "Synthetic lawyer",
    introduction: "Saved introduction",
    officeName: "Synthetic office",
    address: "Synthetic address",
    region: "",
    practiceAreas: [],
    phone: "010-1234-5678",
    email: "",
    website: "",
    photoAssetId: null,
    photoUrl: null,
    portfolio: [],
    published: false,
    verificationStatus: "self_declared",
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "lawyer" },
          needsConsent: false,
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile") {
      if (req.method() === "PUT") {
        savedPhoto = req.postDataJSON().profile.photoAssetId;
        profile = { ...req.postDataJSON().profile, revision: profile.revision + 1 };
      }
      return route.fulfill({ json: profile });
    }
    if (path === "/api/v2/me/lawyer/profile")
      return route.fulfill({ json: { profileId: profile.id, revision: 1 } });
    if (path === "/api/v2/me/lawyer/portfolio-assets")
      return route.fulfill({
        json: {
          assetId: "synthetic-photo-a",
          revision: 1,
          value: { request: { mediaType: "image/jpeg" } },
        },
      });
    if (path === "/api/v2/me/lawyer/assets/synthetic-photo-a/content")
      return route.fulfill({
        json: {
          assetId: "synthetic-photo-a",
          revision: 3,
          value: {
            id: "synthetic-photo-a",
            revision: 3,
            kind: "image",
            status: "ready",
            byteLength: 1000,
            originalHash: "a".repeat(64),
            sanitizedDerivative: {
              id: "synthetic-photo-a-derivative",
              contentHash: "a".repeat(64),
              byteLength: 1000,
              format: "jpeg",
            },
            currentJobId: null,
            failure: null,
          },
        },
      });
    if (path === "/api/v2/me/lawyer/self-profile/assets")
      return route.fulfill({
        json: {
          items: ["a", "b"].map((id) => ({
            id: `synthetic-photo-${id}`,
            revision: 3,
            status: "ready",
            purpose: "profile_photo",
          })),
          nextCursor: null,
        },
      });
    if (path.endsWith("/self-profile/assets/synthetic-photo-b/content")) {
      photoBReads++;
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw2kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/lawyer");
  await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const context = canvas.getContext("2d");
    context?.fillRect(0, 0, 24, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("프로필 사진", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png ?? "", "base64"),
  });
  const image = page.getByAltText("내 프로필 사진", { exact: true });
  await expect(image).toHaveAttribute("src", /^data:image/);
  await page.getByRole("button", { name: "자료 상태 확인", exact: true }).click();
  const rows = page.getByRole("list", { name: "업로드 자료 상태" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole("button", { name: "프로필에 연결", exact: true }).click();
  await expect.poll(() => photoBReads).toBeGreaterThan(0);
  await expect(image).toHaveAttribute("src", /^data:image\/png/);
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await expect(page.getByText("프로필을 저장했어요.", { exact: true })).toBeVisible();
  expect(savedPhoto).toBe("synthetic-photo-b");
});
