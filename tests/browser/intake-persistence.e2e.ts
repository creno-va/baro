import { expect, type Page, test } from "@playwright/test";
import { answerSchema } from "../../src/contracts/questions";
import {
  v2IntakeSchema,
  v2SummaryEditRequestSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "../../src/contracts/v2";
import { batch, intake, summary, workspace } from "../fixtures/contracts/v2";

const id = "synthetic-answer-case";
async function fixture(page: Page, value?: string, reject = false) {
  const question = batch.questions[0];
  if (!question) throw new Error("MISSING_SYNTHETIC_QUESTION");
  let saved = v2IntakeSchema.parse({
    ...intake,
    status: "collecting",
    summary: null,
    batches: [
      {
        ...batch,
        questions: [question],
        answers:
          value === undefined
            ? []
            : [answerSchema.parse({ questionId: question.id, status: "answered", value })],
      },
    ],
  });
  let current = v2WorkspaceSchema.parse({
    ...workspace,
    id,
    status: "intake",
    confirmedSummaryRevision: null,
    legacySnapshotId: null,
  });
  const writes: { status: string; value?: string }[] = [];
  let fail = reject;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: current });
    if (u.pathname.endsWith("/intake")) return route.fulfill({ json: saved });
    if (u.pathname.endsWith("/workspace-jobs/latest")) return route.fulfill({ json: null });
    if (u.pathname.endsWith("/intake/answers") && req.method() === "PUT") {
      const answer = answerSchema.parse(req.postDataJSON().answers[0]);
      writes.push(answer);
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: "DISPATCH_FAILED", retryable: true } },
        });
      saved = v2IntakeSchema.parse({
        ...saved,
        revision: saved.revision + 1,
        batches: [{ ...batch, questions: [question], answers: [answer] }],
      });
      current = v2WorkspaceSchema.parse({
        ...current,
        workspaceRevision: current.workspaceRevision + 1,
        intakeRevision: saved.revision,
      });
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`/cases/${id}/intake?question=0`);
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toBeVisible();
  return {
    writes,
    allowSave: () => {
      fail = false;
    },
  };
}

for (const state of ["unknown", "skipped"] as const)
  test(`a rejected ${state} save remains unsaved until acknowledged`, async ({ page }) => {
    const f = await fixture(page, undefined, true);
    await page
      .getByRole("button", { name: state === "unknown" ? "모름" : "건너뛰기", exact: true })
      .click();
    await expect.poll(() => f.writes.length).toBe(1);
    const label = page.locator(".intake-scene-answer-state");
    await expect(label).toContainText("아직 저장되지 않았어요");
    await expect(label).not.toContainText("저장했어요");
    await expect(page.getByRole("alert")).toBeVisible();
    f.allowSave();
    await page.getByText("답변 관리", { exact: true }).click();
    await page.getByRole("button", { name: "답변 저장", exact: true }).click();
    await expect.poll(() => f.writes.length).toBe(2);
    await expect(label).toHaveText(
      state === "unknown" ? "모름으로 저장했어요." : "건너뛰기로 저장했어요.",
    );
  });

test("a persisted 600-code-point emoji answer can be edited and saved", async ({ page }) => {
  const f = await fixture(page, "😀".repeat(600));
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await expect(answer).toHaveValue("😀".repeat(600));
  await answer.press("End");
  await answer.press("Backspace");
  await expect(answer).toHaveValue("😀".repeat(599));
  await page.getByText("답변 관리", { exact: true }).click();
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0]?.value).toBe("😀".repeat(599));
});

test("typing emoji counts code points and over-limit drafts cannot save", async ({ page }) => {
  const f = await fixture(page);
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.pressSequentially("😀".repeat(600));
  await expect(answer).toHaveValue("😀".repeat(600));
  await answer.fill("😀".repeat(1001));
  await expect(page.getByRole("alert")).toContainText("1,000자");
  await page.getByText("답변 관리", { exact: true }).click();
  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /저장하고/ }).first()).toBeDisabled();
  expect(f.writes).toHaveLength(0);
  await answer.fill("😀".repeat(1000));
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect([...(f.writes[0]?.value ?? "")]).toHaveLength(1000);
});

async function summaryFixture(page: Page) {
  const originalFact = summary.facts[0];
  if (!originalFact) throw new Error("MISSING_SYNTHETIC_FACT");
  let stored = v2SummarySchema.parse({
    ...summary,
    overview: "😀".repeat(3000),
    facts: [{ ...originalFact, text: "😀".repeat(1200) }],
  });
  let metadata = v2IntakeSchema.parse({ ...intake, summary: stored });
  let current = v2WorkspaceSchema.parse({
    ...workspace,
    id,
    status: "intake",
    confirmedSummaryRevision: null,
    legacySnapshotId: null,
  });
  const writes: { overview?: string | undefined; factEdits?: { text: string }[] | undefined }[] =
    [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: current });
    if (u.pathname.endsWith("/intake"))
      return route.fulfill({
        json: { ...metadata, summary: { id: "synthetic-summary", revision: stored.revision } },
      });
    if (u.pathname.endsWith("/summary")) {
      if (req.method() === "PUT") {
        const input = v2SummaryEditRequestSchema.parse(req.postDataJSON());
        writes.push(input);
        stored = v2SummarySchema.parse({
          ...stored,
          revision: stored.revision + 1,
          overview: input.overview ?? stored.overview,
          facts: stored.facts.map((fact) => {
            const edit = input.factEdits?.find((e) => e.factId === fact.id);
            return edit ? { ...fact, text: edit.text, userEdited: true } : fact;
          }),
        });
        metadata = v2IntakeSchema.parse({ ...metadata, summary: stored });
        current = v2WorkspaceSchema.parse({
          ...current,
          workspaceRevision: current.workspaceRevision + 1,
        });
      }
      return route.fulfill({ json: stored });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`/cases/${id}/summary`);
  await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toBeVisible();
  return writes;
}

test("persisted emoji summary and facts remain editable and save full code points", async ({
  page,
}) => {
  const writes = await summaryFixture(page);
  const overview = page.getByRole("textbox", { name: "요약 편집", exact: true });
  const fact = page.getByRole("textbox", { name: "사실 내용", exact: true });
  await expect(overview).toHaveValue("😀".repeat(3000));
  await expect(fact).toHaveValue("😀".repeat(1200));
  await overview.press("End");
  await overview.press("Backspace");
  await fact.press("End");
  await fact.press("Backspace");
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.overview).toBe("😀".repeat(2999));
  expect(writes[0]?.factEdits?.[0]?.text).toBe("😀".repeat(1199));
  await expect(page.getByText("수정한 요약이 저장됐어요.", { exact: true })).toBeVisible();
});

test("summary and fact limits block oversized code-point drafts without cutting input", async ({
  page,
}) => {
  const writes = await summaryFixture(page);
  const overview = page.getByRole("textbox", { name: "요약 편집", exact: true });
  const fact = page.getByRole("textbox", { name: "사실 내용", exact: true });
  await overview.fill("😀".repeat(5001));
  await expect(overview).toHaveValue("😀".repeat(5001));
  await expect(page.getByRole("alert")).toContainText("5,000자");
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeDisabled();
  await overview.fill("😀".repeat(5000));
  await fact.fill("😀".repeat(2001));
  await expect(page.getByRole("alert")).toContainText("2,000자");
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await fact.fill("😀".repeat(2000));
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeEnabled();
});
