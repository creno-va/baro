import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { reportPhotoToken } from "../../src/utils/report-markdown";

test("explicit mock photos use saved selection, do not refetch on metadata checks, and discard masked, deleted and late foreign-owner originals", async ({
  page,
}) => {
  let owner = "synthetic-owner";
  let masked = false;
  let deleted = false;
  let reads = 0;
  let release: (() => void) | undefined;
  let hold = false;
  const original = await readFile("tests/fixtures/media/image-markers.jpg");
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/session")
      return route.fulfill({
        json: { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false },
      });
    if (path.endsWith("/reports"))
      return route.fulfill({
        json: {
          id: "synthetic-mock-photo-report",
          caseId: "synthetic-mock-photo-case",
          title: "합성 사진 저장본",
          revision: 1,
          updatedAt: "2026-11-01T00:00:00Z",
          stale: false,
          excludedFileIds: [],
          maskIdentifiers: masked,
          content: `사건 개요\n합성 진술과 관찰을 구분합니다.\n\n증거 자료\n${masked ? "사진을 가렸습니다." : reportPhotoToken("saved-photo", "저장 당시 이름.jpg")}`,
          includedPhotoIds: masked ? [] : ["saved-photo"],
          photoCandidates: [{ id: "saved-photo", name: "저장 당시 이름.jpg", revision: 1 }],
        },
      });
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "saved-photo",
            name: "현재 이름.jpg",
            mimeType: "image/jpeg",
            sizeBytes: original.length,
            status: "ready",
            coverage: "전체",
            extractedText: "합성",
            revision: 2,
          },
          {
            id: "unselected-photo",
            name: "선택하지 않은 사진.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1024,
            status: "ready",
            coverage: "전체",
            extractedText: "합성",
          },
        ],
      });
    if (path.endsWith("/files/saved-photo/content")) {
      reads++;
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (deleted)
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "삭제한 합성 자료" } },
        });
      return route.fulfill({ body: original, contentType: "image/jpeg" });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  const url = "/cases/synthetic-mock-photo-case/reports";
  await page.goto(url);
  const image = page.locator(".report-inline-photo img");
  await expect(image).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  await expect(image).toHaveAttribute("alt", "저장 당시 이름.jpg");
  expect(reads).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".report-edit-toggle")).toBeEnabled();
  expect(reads).toBe(1);
  expect(await page.locator("html").getAttribute("data-report-dirty")).toBe("false");
  masked = true;
  await page.reload();
  await expect(page.locator(".report-reading")).toContainText("사진을 가렸습니다.");
  await expect(image).toHaveCount(0);
  expect(reads).toBe(1);
  masked = false;
  deleted = true;
  await page.reload();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator(".report-photo-placeholder")).toHaveText("저장 당시 이름.jpg");
  await expect(image).toHaveCount(0);
  deleted = false;
  hold = true;
  await page.reload();
  await expect.poll(() => reads).toBe(3);
  owner = "synthetic-other-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".report-reading")).toHaveCount(0);
  release?.();
  await expect(page.locator(".report-inline-photo img")).toHaveCount(0);
  await expect(page.locator(".report-heading")).not.toContainText("합성 사진 저장본");
});
