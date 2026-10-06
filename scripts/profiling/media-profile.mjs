import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:4351";
const browser = await chromium.launch();
const runs = [];
try {
  for (let run = 1; run <= 5; run++) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addInitScript(() => {
      const profile = {
        id: "media-profile",
        revision: 1,
        name: "합성 변호사",
        introduction: "합성 소개",
        officeName: "합성 사무실",
        address: "서울",
        region: "seoul",
        practiceAreas: ["civil"],
        phone: "",
        email: "synthetic@example.invalid",
        website: "",
        photoUrl: null,
        portfolio: Array.from({ length: 30 }, (_, i) => ({
          id: `portfolio-${i}`,
          title: `합성 portfolio ${i}`,
          url: "https://example.com",
        })),
        published: false,
        verificationStatus: "self_declared",
      };
      if (!sessionStorage.getItem("media-seeded")) {
        localStorage.setItem(
          "baro-api-mock-v1:session",
          JSON.stringify({
            user: { id: "media-owner", name: "합성 이용자", accountType: "lawyer" },
            needsConsent: false,
          }),
        );
        localStorage.setItem(
          "baro-api-mock-v1:lawyers",
          JSON.stringify({ profiles: [profile], owners: { "media-owner": "media-profile" } }),
        );
        sessionStorage.setItem("media-seeded", "true");
      }
      window.mediaEvents = [];
      window.mediaLongTasks = [];
      new PerformanceObserver((list) =>
        window.mediaEvents.push(
          ...list
            .getEntries()
            .filter((e) => e.interactionId)
            .map((e) => ({ id: e.interactionId, start: e.startTime, duration: e.duration })),
        ),
      ).observe({ type: "event", buffered: true, durationThreshold: 16 });
      new PerformanceObserver((list) =>
        window.mediaLongTasks.push(
          ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
        ),
      ).observe({ type: "longtask", buffered: true });
    });
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const requests = [];
    page.on("request", (r) =>
      requests.push({ path: new URL(r.url()).pathname, type: r.resourceType() }),
    );
    await page.goto(`${base}/lawyer`);
    await page.getByLabel("이름", { exact: true }).waitFor();
    const source = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2048;
      canvas.height = 2048;
      const context = canvas.getContext("2d"),
        data = context.createImageData(2048, 2048);
      let seed = 7;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data.data[i] = (seed >>> 16) & 255;
        data.data[i + 1] = (seed >>> 8) & 255;
        data.data[i + 2] = seed & 255;
        data.data[i + 3] = 255;
      }
      context.putImageData(data, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "synthetic-photo.jpg", { type: "image/jpeg" }));
      const input = document.querySelector('input[type="file"]');
      input.files = transfer.files;
      window.mediaStart = performance.now();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { width: 2048, height: 2048, bytes: blob.size };
    });
    await page.locator('img[alt="내 프로필 사진"]').waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="내 프로필 사진"]')?.complete);
    const photo = await page.evaluate(() => ({
      elapsedMs: performance.now() - window.mediaStart,
      characters: document.querySelector('img[alt="내 프로필 사진"]').src.length,
      longTasks: window.mediaLongTasks.filter((e) => e.start >= window.mediaStart),
    }));
    const inputStart = await page.evaluate(() => performance.now());
    await page
      .getByLabel("이름", { exact: true })
      .pressSequentially(" synthetic input 12345", { delay: 30 });
    const inputEnd = await page.evaluate(() => performance.now());
    await page.waitForTimeout(200);
    const input = await page.evaluate(
      ({ inputStart, inputEnd }) => ({
        events: window.mediaEvents.filter((e) => e.start >= inputStart && e.start <= inputEnd),
        longTasks: window.mediaLongTasks.filter(
          (e) => e.start >= inputStart && e.start <= inputEnd,
        ),
      }),
      { inputStart, inputEnd },
    );
    await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    await page.getByText("프로필을 저장했어요.", { exact: true }).waitFor();
    await page.reload();
    await page.locator('img[alt="내 프로필 사진"]').waitFor();
    const persisted = await page.evaluate(
      () => JSON.parse(localStorage.getItem("baro-api-mock-v1:lawyers")).profiles[0],
    );
    runs.push({
      run,
      source,
      photo,
      input,
      storedProfileUtf8Bytes: Buffer.byteLength(JSON.stringify(persisted)),
      portfolio: persisted.portfolio.length,
      photoPersisted: !!persisted.photoUrl,
      requests,
      externalAssetsFetched: requests.filter(
        (r) => r.type === "image" && !r.path.startsWith("/brand"),
      ).length,
    });
    console.log(
      `media ${run}: ${source.bytes} bytes -> ${photo.characters} chars in ${photo.elapsedMs.toFixed(0)}ms`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
await mkdir("test-results/final-media", { recursive: true });
await writeFile(
  "test-results/final-media/raw.json",
  JSON.stringify(
    { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runs },
    null,
    2,
  ),
);
