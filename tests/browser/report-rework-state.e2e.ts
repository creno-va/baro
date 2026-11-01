import { expect, test } from "@playwright/test";
import type { V2ConversationState, V2LegalAnalysisSnapshot } from "../../src/contracts/v2";

const basis = {
  researchRevision: 7,
  summaryRevision: 2,
  evidenceHash: "a".repeat(64),
  casePurpose: "prepare_claim" as const,
};
function conversationState(): V2ConversationState {
  return {
    contractVersion: "conversation-report-v1",
    workspaceRevision: 7,
    caseContext: {
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    summaryConfirmed: true,
    pendingEvidenceIds: [],
    snapshot: null,
    intents: [],
    analysis: {
      status: "not_started",
      basis: null,
      currentJobId: null,
      missingItems: ["반환 약정의 원본 확인"],
      failure: null,
    },
    report: {
      status: "not_started",
      id: null,
      revision: null,
      basis: null,
      currentJobId: null,
      failure: null,
    },
  };
}
function partialSnapshot(context: V2ConversationState["caseContext"]): V2LegalAnalysisSnapshot {
  return {
    contractVersion: "conversation-report-v1",
    id: "synthetic-analysis",
    basis,
    context,
    basedOnFactIds: [],
    includedEvidence: [],
    asOfDate: "2026-11-01",
    checkedAt: "2026-11-01T00:00:00Z",
    status: "partial",
    citations: [],
    retrievalHash: "a".repeat(64),
    availability: [{ kind: "precedent", status: "empty", reason: "no_results" }],
    issues: [],
    precedents: [],
    perspective: {
      casePurpose: "prepare_claim",
      weaknesses: [],
      claimGaps: [],
      responsePoints: [],
      additionalMaterials: [],
    },
    evidenceRequirements: [],
    sourceClaims: [],
    limitations: ["합성 UI 상태 검증 전용"],
  };
}
const preparedReport = () => ({
  id: "synthetic-prepared-report",
  caseId: "synthetic-rework-case",
  revision: 1,
  title: "합성 사건 리포트",
  updatedAt: "2026-11-01T00:00:00Z",
  stale: false,
  content:
    "리포트 준비 상태\n보완 필요 · 검증한 항목과 미확인을 구분합니다.\n\n사건 개요\n전화 010-1234-5678 · 제거할 파생 설명\n\n법적 쟁점과 법 조항\n자료와 대조한 합성 요건\n\n판례별 공통점과 차이점\n미확인 비교는 완료로 표시하지 않습니다.",
  excludedFileIds: [] as string[],
  maskIdentifiers: false,
  includedPhotoIds: [],
  analysisReview: {
    analysisId: "synthetic-analysis",
    status: "partial" as "partial" | "review_required",
    userEdited: false,
    checkedAt: "2026-11-01T00:00:00Z" as string | null,
  },
});

test("rework entry only reads; explicit preparation and scope save use the displayed owner and exact returned snapshot", async ({
  page,
}) => {
  let report: ReturnType<typeof preparedReport> | null = null;
  const state = conversationState();
  let legacyReads = 0,
    preparations = 0,
    saves = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-report-owner", name: "합성", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/rework/conversation")) return route.fulfill({ json: state });
    if (path.endsWith("/rework/report")) return route.fulfill({ json: report });
    if (path.endsWith("/rework/actions")) {
      preparations++;
      expect(route.request().headers()["x-baro-expected-owner"]).toBe("synthetic-report-owner");
      expect(route.request().postDataJSON()).toMatchObject({
        action: "prepare_report",
        expectedRevision: 7,
      });
      report = preparedReport();
      state.analysis = {
        status: "partial",
        basis,
        currentJobId: null,
        missingItems: ["관련 판례의 미확인 부분"],
        failure: null,
      };
      state.snapshot = partialSnapshot(state.caseContext);
      state.report = {
        status: "ready",
        id: report.id,
        revision: report.revision,
        basis,
        currentJobId: null,
        failure: null,
      };
      return route.fulfill({
        json: {
          contractVersion: "conversation-report-v1",
          requestId: route.request().postDataJSON().requestId,
          workspaceRevision: 7,
          pane: "report",
          status: "ready",
          missingItems: [],
          operationId: null,
        },
      });
    }
    if (path.endsWith("/reports")) {
      if (route.request().method() === "GET") legacyReads++;
      if (route.request().method() === "PATCH") {
        saves++;
        expect(route.request().postDataJSON()).toMatchObject({
          expectedRevision: 1,
          excludedFileIds: ["synthetic-excluded-file"],
          maskIdentifiers: true,
        });
        if (!report) throw new Error("Synthetic report absent");
        report = {
          ...report,
          id: "synthetic-scoped-report",
          revision: 2,
          excludedFileIds: ["synthetic-excluded-file"],
          maskIdentifiers: true,
          content:
            "리포트 준비 상태\n보완 필요 · 자료 선택 범위가 달라져 다시 분석해야 합니다.\n\n사건 개요\n남은 자료로 정리한 새 내용",
          analysisReview: {
            analysisId: "synthetic-analysis",
            status: "review_required",
            userEdited: false,
            checkedAt: null,
          },
        };
      }
      return route.fulfill({ json: report });
    }
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "synthetic-excluded-file",
            name: "합성 계약서.txt",
            mimeType: "text/plain",
            sizeBytes: 10,
            status: "ready",
            coverage: "전체",
            extractedText: "합성 자료",
          },
        ],
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-rework-case/reports?embedded=true&rework=true");
  await expect(
    page.getByRole("heading", { name: "현재 사건의 법률 분석을 준비해요" }),
  ).toBeVisible();
  expect(legacyReads).toBe(0);
  expect(preparations).toBe(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "법적 쟁점과 법 조항", exact: true }),
  ).toBeVisible();
  expect(preparations).toBe(1);
  await page.getByText("포함할 자료와 식별정보 가림", { exact: true }).click();
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  await expect(page.locator(".report-reading")).not.toContainText("010-1234-5678");
  await page
    .getByRole("checkbox", { name: "합성 계약서.txt · 리포트에서 제외", exact: true })
    .check();
  await page.getByRole("button", { name: "선택 범위 저장", exact: true }).click();
  await expect(page.locator(".report-reading")).toContainText("남은 자료로 정리한 새 내용");
  await expect(page.locator(".report-reading")).not.toContainText("제거할 파생 설명");
  expect(saves).toBe(1);
  expect(preparations).toBe(1);
  expect(legacyReads).toBe(0);
});

test("a failed preparation stays failed, retries only on request, and pending data clears after account change", async ({
  page,
}) => {
  const state = conversationState();
  state.analysis = {
    status: "failed",
    basis,
    currentJobId: null,
    missingItems: [],
    failure: "MODEL_UNAVAILABLE",
  };
  let owner = "synthetic-report-owner",
    requests = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false },
      });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/rework/conversation")) return route.fulfill({ json: state });
    if (path.endsWith("/rework/report")) return route.fulfill({ json: null });
    if (path.endsWith("/rework/actions")) {
      requests++;
      if (requests === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "MODEL_UNAVAILABLE",
              message: "합성 분석 실패 · 저장된 사건은 유지됩니다.",
            },
          },
        });
      state.analysis = {
        status: "running",
        basis,
        currentJobId: "synthetic-analysis-job",
        missingItems: [],
        failure: null,
      };
      return route.fulfill({
        json: {
          contractVersion: "conversation-report-v1",
          requestId: route.request().postDataJSON().requestId,
          workspaceRevision: 7,
          pane: "report",
          status: "pending",
          missingItems: [],
          operationId: "synthetic-analysis-operation",
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-rework-case/reports?embedded=true&rework=true");
  await expect(page.getByRole("heading", { name: "분석을 완료하지 못했어요" })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("요청을 완료하지 못했어요");
  await expect(page.locator(".report-reading")).toHaveCount(0);
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "법 조항과 판례를 확인하고 있어요" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "리포트 준비", exact: true })).toBeDisabled();
  owner = "synthetic-different-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.getByRole("heading", { name: "법 조항과 판례를 확인하고 있어요" })).toHaveCount(
    0,
  );
  await expect(page.locator(".report-reading")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("embedded report preserves stale edits before generating a new snapshot and clears all content on account change", async ({
  page,
}) => {
  let owner = "synthetic-report-owner";
  let report = {
    id: "synthetic-original-report",
    caseId: "synthetic-rework-case",
    revision: 1,
    title: "합성 사건 리포트",
    content: "사건 개요\n이전 분석으로 생성한 합성 리포트입니다.",
    stale: false,
    updatedAt: "2026-11-01T00:00:00Z",
    excludedFileIds: [],
    maskIdentifiers: false,
    basis: { workspaceRevision: 4, summaryRevision: 1, generatedAt: "2026-11-01T00:00:00Z" },
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false },
      });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/reports")) {
      if (route.request().method() === "POST")
        report = {
          ...report,
          id: "synthetic-new-report",
          revision: 2,
          stale: false,
          content: "사건 개요\n최신 사건으로 생성한 새로운 합성 리포트입니다.",
        };
      return route.fulfill({ json: report });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-rework-case/reports?embedded=true");
  await expect(page.getByRole("heading", { name: "전달할 리포트를 준비해요" })).toHaveCount(0);
  await expect(page.locator(".case-navigation")).toHaveCount(0);
  await page.getByRole("button", { name: "수정하기", exact: true }).click();
  await page
    .getByRole("textbox", { name: "사건 개요 수정" })
    .fill("저장 전이지만 유실하면 안 되는 직접 편집입니다.");
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "true");
  report = { ...report, stale: true };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("과거 기준의 리포트", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "사건 개요 수정" })).toHaveValue(
    "저장 전이지만 유실하면 안 되는 직접 편집입니다.",
  );
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(
    page.getByText("최신 사건으로 생성한 새로운 합성 리포트입니다.", { exact: true }),
  ).toBeVisible();
  await page.getByText("새 버전을 만들기 전의 편집 내용 보관", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "보관한 리포트 편집 내용" })).toHaveValue(
    /유실하면 안 되는 직접 편집/,
  );
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "true");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "보관한 편집 내용 저장", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("편집보관.txt");
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "false");
  owner = "synthetic-another-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.locator(".report-reading")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "보관한 리포트 편집 내용" })).toHaveCount(0);
});
