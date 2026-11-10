import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { chooseOption, selectControl } from "../helpers/headless-controls";

const audioGroup = (page: Page) =>
  page.getByRole("group", { name: "합성 녹음 재생기", exact: true });
const audio = (page: Page) => page.locator("audio");
test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post("/__synthetic-media-control", { data: { available: true, reset: true } })
    ).ok(),
  ).toBe(true);
});
async function open(page: Page) {
  await page.goto("/__media-player");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(audioGroup(page).getByRole("button", { name: "재생", exact: true })).toBeEnabled();
}

test("original playback surfaces use theme tokens, custom controls and no overflowing native chrome", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("audio[controls],video[controls],input[type=range]")).toHaveCount(0);
  for (const mode of ["light", "dark"] as const) {
    await page.getByRole("button", { name: "화면 테마 변경", exact: true }).first().click();
    await page
      .getByRole("menuitem", { name: mode === "light" ? "라이트 모드" : "다크 모드", exact: true })
      .click();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const play = await audioGroup(page)
        .getByRole("button", { name: "재생", exact: true })
        .boundingBox();
      expect(play?.width).toBeGreaterThanOrEqual(44);
      expect(play?.height).toBeGreaterThanOrEqual(44);
      for (const slider of await page.getByRole("slider").all()) {
        const surface = await slider.boundingBox();
        const track = await slider.locator(".ui-range__track").boundingBox();
        expect(track?.width).toBeGreaterThan((surface?.width ?? 0) * 0.7);
      }
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(scan.violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath("media-" + mode + "-" + width + ".png"),
        fullPage: true,
      });
    }
  }
});

test("real playback, keyboard and pointer seeking, volume and speed use the original media clock", async ({
  page,
}) => {
  await open(page);
  const group = audioGroup(page);
  await group.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0);
  await group.getByRole("button", { name: "일시정지", exact: true }).click();
  await expect.poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  const seek = group.getByRole("slider", { name: "재생 위치", exact: true });
  await expect(seek).toBeEnabled();
  await seek.focus();
  await seek.press("Home");
  await seek.press("ArrowRight");
  // Decoder clocks can quantize a seek by a few milliseconds (WebKit: 1.01s).
  // Verify the real clock within one frame, then require the seek to complete.
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeCloseTo(1, 1);
  await seek.press("End");
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeCloseTo(20, 1);
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.seeking))
    .toBe(false);
  await expect(group.locator(".ui-media__time")).toHaveText("0:20 / 0:20");
  await expect(seek).toBeEnabled();
  await seek.scrollIntoViewIfNeeded();
  const bounds = await seek.boundingBox();
  if (!bounds) throw new Error("Synthetic seek control missing");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeCloseTo(10, 0);
  const volume = group.getByRole("slider", { name: "음량", exact: true });
  await volume.focus();
  await volume.press("Home");
  await expect.poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.muted)).toBe(true);
  await volume.press("ArrowRight");
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.volume))
    .toBeCloseTo(0.05);
  await group.getByRole("button", { name: "소리 끄기", exact: true }).click();
  await expect.poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.muted)).toBe(true);
  await chooseOption(selectControl(group, { name: "재생 속도", exact: true }), "1.5");
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.playbackRate))
    .toBe(1.5);
});

test("suspending access pauses without resuming automatically; removal releases the original", async ({
  page,
}) => {
  await open(page);
  const group = audioGroup(page);
  await group.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.paused))
    .toBe(false);
  await page.getByRole("button", { name: "원본 접근 잠그기", exact: true }).click();
  await expect.poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await expect(group.getByRole("button", { name: "재생", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "원본 접근 풀기", exact: true }).click();
  await expect(group.getByRole("button", { name: "재생", exact: true })).toBeEnabled();
  expect(await audio(page).evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await group.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.paused))
    .toBe(false);
  const element = await audio(page).elementHandle();
  if (!element) throw new Error("Synthetic original missing");
  await page.getByRole("button", { name: "원본 음성 닫기", exact: true }).click();
  await expect(group).toHaveCount(0);
  expect(
    await element.evaluate((node: HTMLAudioElement) => ({
      paused: node.paused,
      src: node.getAttribute("src"),
      connected: node.isConnected,
    })),
  ).toEqual({ paused: true, src: null, connected: false });
});

test("an unavailable original only reloads after an explicit retry", async ({ page, request }) => {
  await request.post("/__synthetic-media-control", { data: { available: false } });
  const reads = async () =>
    ((await (await request.get("/__synthetic-media-control")).json()) as { reads: number }).reads;
  await page.goto("/__media-player");
  const group = audioGroup(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  // Engines can defer metadata until a gesture, or fail preload before hydration.
  // A disabled native button ignores the click if the error is already displayed.
  await group.getByRole("button", { name: "재생", exact: true }).click({ force: true });
  await expect(group.getByRole("alert")).toContainText("원본을 재생하지 못했어요");
  await expect(group.getByRole("button", { name: "재생", exact: true })).toBeDisabled();
  const before = await reads();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await reads()).toBe(before);
  await request.post("/__synthetic-media-control", { data: { available: true } });
  await group.getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(group.getByRole("button", { name: "재생", exact: true })).toBeEnabled();
  await group.getByRole("button", { name: "재생", exact: true }).click();
  await expect.poll(reads).toBeGreaterThan(before);
  await expect
    .poll(() => audio(page).evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0);
  await expect(group.getByRole("alert")).toHaveCount(0);
});
