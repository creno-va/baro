import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch(),
  page = await browser.newPage();
const id = "11111111-1111-4111-8111-111111111111",
  requests = [];
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/me/session")
    return route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 이용자", accountType: "customer" },
        needsConsent: false,
      },
    });
  if (path.endsWith("/workspace")) {
    requests.push(path);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return route.fulfill({
      json: {
        case: {
          id,
          title: "합성 사건",
          subjectContext: "individual",
          stage: "active",
          revision: 1,
          updatedAt: "2026-10-06T00:00:00.000Z",
          summary: "합성 요약",
          schemaVersion: "2",
        },
        messages: [],
        actions: [],
        timeline: [],
        files: [],
      },
    });
  }
  throw new Error("Unexpected probe request");
});
try {
  await page.goto(`http://127.0.0.1:4352/cases/${id}`);
  await page.getByLabel("추가 사실 또는 질문").waitFor();
  const baseline = requests.length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  const result = {
    condition:
      "paired synthetic focus + visibilitychange in visible document; 200ms intercepted aggregate HTTP response",
    baselineRequests: baseline,
    pairedRefreshRequests: requests.length - baseline,
    exactSameEndpoint: true,
  };
  if (result.pairedRefreshRequests !== 2) throw new Error("Refresh behavior changed");
  await mkdir("test-results/final-refresh", { recursive: true });
  await writeFile("test-results/final-refresh/raw.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
