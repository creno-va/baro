import { expect, type Page, test } from "@playwright/test";

const photo = { id: "synthetic-photo", revision: 3, status: "ready", purpose: "profile_photo" };
const documentAsset = {
  id: "synthetic-document",
  revision: 7,
  status: "ready",
  purpose: "portfolio",
};
const pdf = Buffer.from("%PDF-1.4\nsynthetic private owner document\n%%EOF");
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRDsAAAAASUVORK5CYII=",
  "base64",
);

async function setup(page: Page, initialRole: "customer" | "lawyer" = "lawyer") {
  const state = {
    owner: "synthetic-owner-a",
    role: initialRole,
    consent: false,
    signedIn: true,
    assets: [photo, documentAsset],
    reads: 0,
    profiles: 0,
    writes: [] as Array<{ path: string; body: unknown }>,
  };
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: state.signedIn
            ? { id: state.owner, name: "합성 기존 이용자", accountType: state.role }
            : null,
          needsConsent: state.consent,
        },
      });
    if (path === "/api/me/deletion")
      return route.fulfill({
        json: {
          ownerTag: (state.owner.endsWith("a") ? "a" : "b").repeat(64),
          recentOAuth: false,
          authenticatedAt: null,
          providers: ["google"],
        },
      });
    if (path.endsWith("/usage"))
      return route.fulfill({
        json: {
          newCases: { used: 0, limit: 3 },
          aiResponses: { used: 0, limit: 200 },
          mediaMinutes: { used: 0, limit: 60 },
          storageBytes: { used: 0, limit: 10000000000 },
        },
      });
    if (path === "/api/cases" || path === "/api/v2/cases")
      return route.fulfill({ json: { items: [], nextCursor: null, previews: [] } });
    if (path === "/api/v2/me/lawyer/self-profile/assets") {
      state.reads++;
      return route.fulfill({ json: { items: state.assets, nextCursor: null } });
    }
    if (path.endsWith("/self-profile")) {
      state.profiles++;
      return route.fulfill({ status: 500 });
    }
    if (path.endsWith("/synthetic-document/content"))
      return route.fulfill({ contentType: "application/pdf", body: pdf });
    if (path.endsWith("/synthetic-photo/content"))
      return route.fulfill({ contentType: "image/png", body: image });
    if (request.method() !== "GET") {
      state.writes.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 202, json: { status: "deleting" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}
const region = (page: Page) =>
  page.getByRole("region", { name: "이전에 등록한 자료", exact: true });
async function load(page: Page) {
  await page.goto("/settings");
  await expect(
    region(page).getByRole("button", { name: "자료 목록 확인", exact: true }),
  ).toBeEnabled();
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect(
    region(page).getByRole("button", { name: "등록 자료 2 내려받기", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `.wrangler/redesign-04-legacy-assets-${page.viewportSize()?.width ?? 0}.png`,
    fullPage: true,
  });
}

test("general accounts trigger no legacy requests; existing owners explicitly read without creating a profile", async ({
  page,
}) => {
  const state = await setup(page, "customer");
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeEnabled();
  await expect(region(page)).toHaveCount(0);
  expect(state.reads).toBe(0);
  expect(state.profiles).toBe(0);
  expect(state.writes).toEqual([]);
  state.role = "lawyer";
  await page.reload();
  await expect(
    region(page).getByRole("button", { name: "자료 목록 확인", exact: true }),
  ).toBeEnabled();
  expect(state.reads).toBe(0);
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    region(page).getByRole("button", { name: "프로필 사진 1 보기", exact: true }),
  ).toBeEnabled();
  expect(state.reads).toBe(1);
  expect(state.profiles).toBe(0);
  expect(state.writes).toEqual([]);
  await expect(region(page).getByRole("textbox")).toHaveCount(0);
});

test("private image preview and PDF download preserve bytes, keyboard focus and narrow/zoom layouts", async ({
  page,
}) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await load(page);
  const opener = region(page).getByRole("button", { name: "프로필 사진 1 보기", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "이전에 등록한 자료", exact: true });
  await expect(preview.getByRole("img", { name: "프로필 사진 1", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  const pending = page.waitForEvent("download");
  await region(page).getByRole("button", { name: "등록 자료 2 내려받기", exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(pdf);
  expect(download.suggestedFilename()).toBe("등록 자료 2.pdf");
  await expect(
    region(page).getByRole("button", { name: "자료 목록 확인", exact: true }),
  ).toBeEnabled();
  for (const width of [320, 640, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.profiles).toBe(0);
});

test("deletion is explicit, sends the displayed revision and stays visible while accepted", async ({
  page,
}) => {
  const state = await setup(page);
  await load(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  await page.route("**/api/v2/me/lawyer/portfolio-assets/synthetic-document", async (route) => {
    sent++;
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: 7 });
    await gate;
    await route.fulfill({
      status: 202,
      json: { assetId: "synthetic-document", status: "deleting" },
    });
  });
  await region(page).getByRole("button", { name: "등록 자료 2 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "이 자료를 삭제할까요?", exact: true });
  expect(sent).toBe(0);
  await dialog.getByRole("button", { name: "자료 삭제 요청", exact: true }).click();
  await expect.poll(() => sent).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(region(page)).toContainText("자료 삭제를 접수했어요");
  await expect(
    region(page).getByRole("button", { name: "등록 자료 2 내려받기", exact: true }),
  ).toHaveCount(0);
  expect(state.profiles).toBe(0);
});

test("a late private download checks the current owner even without a browser event", async ({
  page,
}) => {
  const state = await setup(page);
  await load(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0,
    delivered = 0;
  page.on("download", () => {
    delivered++;
  });
  await page.route(
    "**/api/v2/me/lawyer/self-profile/assets/synthetic-document/content",
    async (route) => {
      requested++;
      await gate;
      await route.fulfill({ contentType: "application/pdf", body: pdf });
    },
  );
  await region(page).getByRole("button", { name: "등록 자료 2 내려받기", exact: true }).click();
  await expect.poll(() => requested).toBe(1);
  state.owner = "synthetic-owner-b";
  release();
  await expect(
    region(page).getByRole("button", { name: "자료 목록 확인", exact: true }),
  ).toBeEnabled();
  await expect(region(page).getByRole("list")).toHaveCount(0);
  expect(delivered).toBe(0);
  expect(state.writes).toEqual([]);
});

test("peer account/consent changes clear preview and confirmation; old list responses never reappear", async ({
  page,
}) => {
  const state = await setup(page);
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL;
    const tracked = window as unknown as { revokedAssetUrls: string[] };
    tracked.revokedAssetUrls = [];
    URL.revokeObjectURL = (url) => {
      tracked.revokedAssetUrls.push(url);
      original.call(URL, url);
    };
  });
  await load(page);
  await region(page).getByRole("button", { name: "프로필 사진 1 보기", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  state.consent = true;
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { revokedAssetUrls: string[] }).revokedAssetUrls.length,
    ),
  ).toBeGreaterThan(0);
  await expect(region(page).getByRole("list")).toHaveCount(0);
  await expect(region(page).getByRole("link", { name: "정책 확인", exact: true })).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  await page.route("**/api/v2/me/lawyer/self-profile/assets", async (route) => {
    requested++;
    await gate;
    await route.fulfill({ json: { items: [photo, documentAsset], nextCursor: null } });
  });
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect.poll(() => requested).toBe(1);
  state.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  release();
  await expect(region(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("renewal preserves existing read and deletion rights while a resource denial purges the private view", async ({
  page,
}) => {
  const state = await setup(page);
  state.consent = true;
  await load(page);
  await expect(region(page).getByRole("link", { name: "정책 확인", exact: true })).toBeVisible();
  await region(page).getByRole("button", { name: "등록 자료 2 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "자료 삭제 요청", exact: true })
    .click();
  await expect(region(page)).toContainText("자료 삭제를 접수했어요");
  expect(state.writes).toEqual([
    {
      path: "/api/v2/me/lawyer/portfolio-assets/synthetic-document",
      body: { expectedRevision: 7 },
    },
  ]);
  await page.route("**/api/v2/me/lawyer/self-profile/assets", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: { code: "FORBIDDEN", message: "자료 접근 권한을 확인해 주세요.", retryable: false },
      },
    }),
  );
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect(region(page).getByRole("alert")).toBeVisible();
  await expect(region(page).getByRole("list")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.profiles).toBe(0);
});

test("empty accounts, failed reads and CAS rejection stay truthful without profile creation or silent retry", async ({
  page,
}) => {
  const state = await setup(page);
  state.assets = [];
  await page.goto("/settings");
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect(region(page)).toContainText("이전에 등록한 자료가 없어요");
  expect(state.profiles).toBe(0);
  state.assets = [photo, documentAsset];
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect(
    region(page).getByRole("button", { name: "등록 자료 2 삭제", exact: true }),
  ).toBeEnabled();
  await page.route("**/api/v2/me/lawyer/portfolio-assets/synthetic-document", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "STALE_REVISION",
          message: "자료 상태가 바뀌었어요. 목록을 다시 확인해 주세요.",
          retryable: false,
        },
      },
    }),
  );
  await region(page).getByRole("button", { name: "등록 자료 2 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "이 자료를 삭제할까요?", exact: true });
  await dialog.getByRole("button", { name: "자료 삭제 요청", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.route("**/api/v2/me/lawyer/self-profile/assets", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "UNAVAILABLE", message: "자료를 불러오지 못했어요.", retryable: true },
      },
    }),
  );
  await region(page).getByRole("button", { name: "자료 목록 확인", exact: true }).click();
  await expect(region(page).getByRole("alert")).toBeVisible();
  await expect(
    region(page).getByRole("button", { name: "등록 자료 2 내려받기", exact: true }),
  ).toBeVisible();
  expect(state.profiles).toBe(0);
});
