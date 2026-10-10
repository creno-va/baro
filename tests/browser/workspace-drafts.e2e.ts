import { expect, test } from "@playwright/test";
import {
  action,
  assistantMessage,
  summary,
  timeline,
  userMessage,
  workspace,
} from "../fixtures/contracts/v2";

const id = "synthetic-draft-case";
const base = `/cases/${id}`;
const file = (letter: string) => ({
  id: `synthetic-file-${letter}`,
  name: `Synthetic ${letter}.txt`,
  mimeType: "text/plain",
  sizeBytes: 100,
  status: "ready",
  coverage: "7쪽 확인 가능",
  extractedText: "Synthetic material",
});
const files = [file("a"), file("b")] as const;
const initial = () => ({
  case: {
    id,
    title: "Synthetic draft case",
    subjectContext: "individual",
    stage: "active",
    revision: 1,
    updatedAt: "2026-10-10T00:00:00Z",
    summary: "Synthetic confirmed summary",
    schemaVersion: "2",
  },
  messages: [],
  actions: [],
  timeline: [
    {
      id: "synthetic-event",
      revision: 1,
      date: "2026-10-01",
      datePrecision: "month",
      title: "가".repeat(400),
      detail: "Synthetic detail",
    },
  ],
  files,
});
test("an open timeline retains its revision across peer refresh and repeated conflicts", async ({
  page,
}) => {
  let view = initial();
  const revisions: number[] = [];
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: view });
    if (route.request().method() === "PUT") {
      revisions.push(route.request().postDataJSON().expectedRevision);
      return route.fulfill({ status: 409, json: { error: { code: "CONFLICT" } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`${base}/timeline`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("수정한 초안");
  view = {
    ...view,
    case: { ...view.case, revision: 2 },
    timeline: [
      {
        id: "synthetic-event",
        date: "2026-10-01",
        datePrecision: "month",
        detail: "Peer detail",
        revision: 2,
        title: "Peer correction",
      },
    ],
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Peer correction" })).toBeVisible();
  await page.getByRole("button", { name: "타임라인 저장", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "타임라인 저장", exact: true }).click();
  await expect.poll(() => revisions.length).toBe(2);
  expect(revisions).toEqual([1, 1]);
  await expect(page.getByLabel("어떤 일이 있었나요?")).toHaveValue("수정한 초안");
});

test("date precision and long valid timeline titles remain editable", async ({ page }) => {
  const view = initial();
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: view });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`${base}/timeline`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const title = page.getByLabel("어떤 일이 있었나요?");
  await expect(title).toHaveValue("가".repeat(400));
  await title.press("End");
  await title.press("Backspace");
  await expect(title).toHaveValue("가".repeat(399));
  expect(await title.evaluate((input: HTMLInputElement) => input.validity.tooLong)).toBe(false);
  await page.getByLabel("날짜 정밀도").selectOption("day");
  await expect(page.getByLabel("날짜 (모르면 비워 두세요)")).toHaveValue("");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-06");
  await page.getByLabel("날짜 정밀도").selectOption("month");
  await expect(page.getByLabel("날짜 (모르면 비워 두세요)")).toHaveValue("2026-10");
  await title.fill("😀".repeat(1999));
  await page.getByLabel("상세 내용").fill("내용");
  await expect(page.getByRole("button", { name: "타임라인 저장", exact: true })).toBeDisabled();
});

test("material links open once and preserve a later manual selection", async ({ page }) => {
  const view = initial();
  let reads = 0;
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) {
      reads++;
      return route.fulfill({ json: view });
    }
    if (u.pathname.endsWith("/review")) {
      const file = files.find((f) => u.pathname.includes(`/files/${f.id}/`));
      if (!file) throw new Error("UNKNOWN_SYNTHETIC_FILE");
      return route.fulfill({
        json: {
          file: { id: file.id, revision: 1, name: file.name, status: "ready" },
          workspaceRevision: 1,
          coverage: {
            category: "document",
            status: "complete",
            pageCount: 7,
            pages: Array.from({ length: 7 }, (_, i) => ({ page: i + 1, status: "processed" })),
          },
          observations: [],
          nextAfterOrdinal: null,
          pendingReview: null,
          recovery: null,
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`${base}/files?file=${files[0].id}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: files[0].name, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).first().click();
  const old = reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThan(old);
  await expect(dialog).not.toBeVisible();
  await page
    .locator(".workspace-file-list > li")
    .filter({ has: page.getByRole("heading", { name: files[1].name, exact: true }) })
    .getByRole("button", { name: "자료 확인", exact: true })
    .click();
  const before = reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(dialog.getByRole("heading", { name: files[1].name, exact: true })).toBeVisible();
});

test("an unsent chat warns before following the upload link", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    return route.fulfill({
      json:
        u.pathname === "/api/me/session"
          ? {
              user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
              needsConsent: false,
            }
          : initial(),
    });
  });
  await page.goto(base);
  await page.getByLabel("추가 사실 또는 질문").fill("미전송 합성 초안");
  const prompt = page.waitForEvent("dialog");
  const click = page
    .getByRole("link", { name: "자료 추가", exact: true })
    .click({ noWaitAfter: true });
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await click;
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("미전송 합성 초안");
});

test("fact sources identify the referenced material and page", async ({ page }) => {
  const ref = {
    kind: "user_material",
    fileId: files[1].id,
    fileRevision: 1,
    position: { kind: "document", page: 7, paragraph: null, table: null },
  };
  const fact = {
    id: "synthetic-fact",
    text: "Synthetic sourced fact",
    attribution: "user_material",
    certainty: "observed",
    significance: "neutral",
    userEdited: false,
    references: [ref],
    conflictingFactIds: [],
  };
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    let value: unknown = { items: [], nextCursor: null };
    if (u.pathname === "/api/me/session")
      value = {
        user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
        needsConsent: false,
      };
    else if (u.pathname.endsWith("/workspace"))
      value = { ...workspace, id, legacySnapshotId: null };
    else if (u.pathname.endsWith("/intake"))
      value = { narrative: "Synthetic sourced case", summary: { revision: summary.revision } };
    else if (u.pathname.endsWith("/summary")) value = { ...summary, facts: [fact] };
    else if (u.pathname.endsWith("/messages"))
      value = {
        items: [{ ...assistantMessage, references: [ref], citations: [], warnings: [] }],
        nextCursor: null,
      };
    else if (u.pathname.endsWith("/files")) value = files;
    else if (u.pathname.endsWith("/workspace-jobs/latest")) value = null;
    return route.fulfill({ json: value });
  });
  await page.goto(base);
  await page.getByText("사건 요약과 준비 현황", { exact: true }).click();
  const link = page.locator(".workspace-fact-source").getByRole("link");
  await expect(link).toHaveAttribute("href", `${base}/files?file=${files[1].id}`);
  await expect(link).toContainText("7쪽");
});

test("chat retains Unicode input, blocks over-limit text and submits the complete valid text", async ({
  page,
}) => {
  const view = { ...initial(), timeline: [], files: [] };
  const sent: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/workspace")) return route.fulfill({ json: view });
    if (path.endsWith("/messages") && route.request().method() === "POST") {
      sent.push(route.request().postDataJSON().text);
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(base);
  const input = page.locator("#workspace-message"),
    send = page.getByRole("button", { name: "보내기", exact: true });
  await expect(input).toBeEnabled();
  await input.focus();
  await page.keyboard.insertText("😀".repeat(6000));
  await expect(input).toHaveValue("😀".repeat(6000));
  await expect(send).toBeEnabled();
  await input.fill("😀".repeat(10001));
  await expect(send).toBeDisabled();
  await input.press("Control+Enter");
  expect(sent).toHaveLength(0);
  await expect(input).toHaveValue("😀".repeat(10001));
  await expect(page.getByText(/10,000자 이하로 줄여 주세요/)).toBeVisible();
  const text = "😀".repeat(10000);
  await input.fill("  " + text + "  ");
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toBe(text);
  await expect(input).toHaveValue("");
});

for (const [collection, suffix, label, count] of [
  ["messages", "", "이전 대화 더 불러오기", 501],
  ["timeline", "/timeline", "타임라인 더 불러오기", 1001],
  ["actions", "/actions", "행동 더 불러오기", 1001],
] as const) {
  test(`remaining ${collection} records can be read without enabling writes or losing a draft`, async ({
    page,
  }) => {
    const consent = collection === "timeline";
    const records = Array.from({ length: count }, (_, i) =>
      collection === "messages"
        ? {
            ...userMessage,
            id: `message_${i}`,
            operationId: `operation_${i}`,
            selectedFileIds: [],
            text: `Saved message ${i}`,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          }
        : collection === "timeline"
          ? {
              ...timeline,
              id: `timeline_${String(i).padStart(4, "0")}`,
              event: `Saved timeline ${i}`,
            }
          : { ...action, id: `action_${String(i).padStart(4, "0")}`, title: `Saved action ${i}` },
    );
    if (collection === "messages") records.reverse();
    const pageSize = collection === "messages" ? 50 : 8;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session")
        return route.fulfill({
          json: {
            user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
            needsConsent: consent,
          },
        });
      if (path.endsWith("/workspace"))
        return route.fulfill({ json: { ...workspace, id, legacySnapshotId: null } });
      if (path.endsWith("/intake"))
        return route.fulfill({
          json: { narrative: "Synthetic paginated case", summary: { revision: summary.revision } },
        });
      if (path.endsWith("/summary")) return route.fulfill({ json: summary });
      if (path.endsWith(`/${collection}`)) {
        const cursor = url.searchParams.get(collection === "messages" ? "before" : "after");
        const offset = cursor ? Number(cursor) : 0;
        const items = records.slice(offset, offset + pageSize);
        return route.fulfill({
          json: {
            items,
            nextCursor:
              offset + items.length < records.length ? String(offset + items.length) : null,
          },
        });
      }
      if (["messages", "timeline", "actions"].some((name) => path.endsWith(`/${name}`)))
        return route.fulfill({ json: { items: [], nextCursor: null } });
      if (path.endsWith("/files")) return route.fulfill({ json: [] });
      if (path.endsWith("/workspace-jobs/latest")) return route.fulfill({ json: null });
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
    });
    await page.goto(`${base}${suffix}`);
    const more = page.getByRole("button", { name: label, exact: true });
    await expect(more).toBeEnabled();
    if (collection === "messages")
      await page.locator("#workspace-message").fill("Keep this unsent draft 😀");
    if (consent)
      await expect(page.getByRole("button", { name: "일정 추가", exact: true })).toBeDisabled();
    await more.click();
    await expect(more).toHaveCount(0);
    if (collection === "messages") {
      await expect(page.locator(".workspace-message")).toHaveCount(count);
      await expect(page.getByText("Saved message 0", { exact: true })).toBeVisible();
      await expect(page.locator("#workspace-message")).toHaveValue("Keep this unsent draft 😀");
    } else if (collection === "timeline") {
      await expect(page.locator(".workspace-timeline > li")).toHaveCount(count);
      await expect(page.getByRole("button", { name: "일정 추가", exact: true })).toBeDisabled();
    } else await expect(page.locator(".workspace-action-list > li")).toHaveCount(count);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(more).toHaveCount(0);
  });
}

test("a failed older-message read preserves the current conversation and can be retried", async ({
  page,
}) => {
  let fail = true;
  const records = Array.from({ length: 501 }, (_, i) => ({
    ...userMessage,
    id: `message_${i}`,
    operationId: `operation_${i}`,
    selectedFileIds: [],
    text: `Saved message ${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  })).reverse();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/workspace"))
      return route.fulfill({ json: { ...workspace, id, legacySnapshotId: null } });
    if (path.endsWith("/intake"))
      return route.fulfill({
        json: { narrative: "Synthetic pagination retry", summary: { revision: summary.revision } },
      });
    if (path.endsWith("/summary")) return route.fulfill({ json: summary });
    if (path.endsWith("/messages")) {
      const offset = Number(url.searchParams.get("before") ?? "0");
      if (offset === 500 && fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE", retryable: true } },
        });
      const items = records.slice(offset, offset + 50);
      return route.fulfill({
        json: {
          items,
          nextCursor: offset + items.length < records.length ? String(offset + items.length) : null,
        },
      });
    }
    if (path.endsWith("/actions") || path.endsWith("/timeline"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/workspace-jobs/latest")) return route.fulfill({ json: null });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(base);
  const more = page.getByRole("button", { name: "이전 대화 더 불러오기", exact: true });
  await expect(more).toBeEnabled();
  await page.locator("#workspace-message").fill("Preserve this draft through failure");
  await more.click();
  await expect(
    page.getByText("지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-message")).toHaveCount(500);
  await expect(page.locator("#workspace-message")).toHaveValue(
    "Preserve this draft through failure",
  );
  fail = false;
  await more.click();
  await expect(page.locator(".workspace-message")).toHaveCount(501);
  await expect(more).toHaveCount(0);
  await expect(page.locator("#workspace-message")).toHaveValue(
    "Preserve this draft through failure",
  );
});
