import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { V2ConversationState, V2LegalAnalysisSnapshot } from "../../src/contracts/v2";
import type { V2ResolutionState } from "../../src/contracts/v2/resolution";

const basis = {
  researchRevision: 7,
  summaryRevision: 2,
  evidenceHash: "a".repeat(64),
  casePurpose: "prepare_claim" as const,
};
function resolutionState(report = preparedReport()): V2ResolutionState {
  return {
    contractVersion: "conversation-report-v1",
    revision: 1,
    basis: {
      ...basis,
      workspaceRevision: 7,
      analysisId: "synthetic-analysis",
      reportId: report.id,
      reportRevision: report.revision,
      procedure: { kind: "civil", stage: "before_filing", description: null },
    },
    selection: null,
    selectedFileIds: [],
    maskIdentifiers: false,
    status: "active",
    draft: null,
    procedureChecks: [
      {
        id: "unknown-court",
        label: "관할",
        detail: "관할 확인에 필요한 사실을 확인해 주세요.",
        status: "needs_confirmation",
        sourceClaimIds: [],
      },
    ],
    weaknessChecks: ["반환 조건의 전체 원본 확인"],
    consultationPreparation: ["사건 경위와 확인한 자료를 준비해 주세요."],
    citations: [],
    sourceClaims: [],
    allowedDocumentKinds: ["fact_statement"],
  };
}
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

test("report evidence uses the real upload and review components, requests case reflection, then prepares a new immutable report", async ({
  page,
}) => {
  const state = conversationState();
  state.snapshot = partialSnapshot(state.caseContext);
  state.analysis = {
    status: "partial",
    basis,
    currentJobId: null,
    missingItems: ["반환 약정 원본 추가"],
    failure: null,
  };
  let report = preparedReport();
  const original = report.content;
  state.report = {
    status: "ready",
    id: report.id,
    revision: 1,
    basis,
    currentJobId: null,
    failure: null,
  };
  const files: Record<string, unknown>[] = [];
  let fileRevision = 2,
    workspaceRevision = 7,
    reflection = 0,
    preparations = 0,
    edited = "[문서 기재] 합성 반환 약정";
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-report-owner", name: "합성", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/rework/conversation")) return route.fulfill({ json: state });
    if (path.endsWith("/rework/resolution"))
      return route.fulfill({ json: resolutionState(report ?? undefined) });
    if (path.endsWith("/rework/report")) return route.fulfill({ json: report });
    if (path.endsWith("/files") && request.method() === "GET")
      return route.fulfill({ json: files });
    if (path.endsWith("/files") && request.method() === "POST") {
      const input = request.postDataJSON();
      files.push({
        id: "synthetic-added-photo",
        revision: 1,
        name: input.name,
        declaredMediaType: input.mediaType,
        byteLength: input.byteLength,
        contentHash: input.contentHash,
        status: "reserved",
      });
      return route.fulfill({
        json: {
          schemaVersion: "2",
          fileId: "synthetic-added-photo",
          uploadSession: "synthetic-report-upload",
          chunkBytes: 8388608,
          reservedBytes: input.byteLength,
          expiresAt: "2099-01-01T00:00:00Z",
        },
      });
    }
    if (path.includes("/parts/")) return route.fulfill({ json: { accepted: true } });
    if (path.endsWith("/complete")) {
      if (!files[0]) throw new Error("Synthetic upload missing");
      files[0].status = "uploaded";
      files[0].revision = 2;
      report = { ...report, stale: true };
      workspaceRevision++;
      state.workspaceRevision = workspaceRevision;
      state.analysis.status = "stale";
      state.pendingEvidenceIds = ["synthetic-added-photo"];
      return route.fulfill({
        json: {
          fileId: "synthetic-added-photo",
          revision: 2,
          status: "uploaded",
          processingQueued: false,
        },
      });
    }
    if (path.endsWith("/review"))
      return route.fulfill({
        json: {
          file: {
            id: "synthetic-added-photo",
            revision: fileRevision,
            name: "합성 반환 약정.jpg",
            status: "ready",
          },
          workspaceRevision,
          coverage: { category: "image", status: "complete", observation: "processed" },
          observations: [
            {
              ordinal: 0,
              original: {
                id: "synthetic-report-observation",
                text: "[문서 기재] 합성 반환 약정",
                position: { kind: "image", region: null },
                certainty: "uncertain",
                userEdited: false,
                included: true,
              },
              value: {
                id: "synthetic-report-observation",
                text: edited,
                position: { kind: "image", region: null },
                certainty: "uncertain",
                userEdited: fileRevision > 2,
                included: true,
              },
            },
          ],
          nextAfterOrdinal: null,
          pendingReview: null,
          recovery: null,
        },
      });
    if (path.endsWith("/observations") && request.method() === "PATCH") {
      edited = request.postDataJSON().edits[0].text;
      fileRevision++;
      workspaceRevision++;
      state.workspaceRevision = workspaceRevision;
      if (files[0]) files[0].revision = fileRevision;
      return route.fulfill({
        json: {
          reviewId: "synthetic-report-review",
          fileId: "synthetic-added-photo",
          revision: fileRevision,
          workspaceRevision,
          status: "ready",
          completed: 1,
          total: 1,
        },
      });
    }
    if (path.endsWith("/workspace"))
      return route.fulfill({
        json: {
          case: {
            id: "synthetic-rework-case",
            title: "합성 사건",
            subjectContext: "individual",
            stage: "active",
            revision: workspaceRevision,
            updatedAt: "2026-11-01T00:00:00Z",
            summary: "합성 사건 요약",
            schemaVersion: "2",
          },
          messages: [],
          actions: [],
          timeline: [],
          files: [],
        },
      });
    if (path.endsWith("/messages") && request.method() === "POST") {
      reflection++;
      expect(request.postDataJSON()).toMatchObject({
        expectedRevision: workspaceRevision,
        selectedFileIds: ["synthetic-added-photo"],
      });
      workspaceRevision++;
      state.workspaceRevision = workspaceRevision;
      return route.fulfill({
        json: {
          operationId: "synthetic-reflection-operation",
          jobId: "synthetic-reflection-job",
          status: "queued",
          retryAfter: 1,
        },
      });
    }
    if (path.endsWith("/rework/actions")) {
      preparations++;
      const nextBasis = {
        ...basis,
        researchRevision: workspaceRevision,
        evidenceHash: "b".repeat(64),
      };
      state.snapshot = {
        ...partialSnapshot(state.caseContext),
        id: "synthetic-new-analysis",
        basis: nextBasis,
      };
      state.analysis = {
        status: "partial",
        basis: nextBasis,
        currentJobId: null,
        missingItems: ["판례 미확인 부분"],
        failure: null,
      };
      state.pendingEvidenceIds = [];
      report = {
        ...report,
        id: "synthetic-new-evidence-report",
        revision: 2,
        stale: false,
        content:
          "리포트 준비 상태\n보완 필요 · 현재 자료로 확인한 합성 리포트\n\n사건 개요\n새 약정 자료의 사용자 교정을 반영한 새 리포트입니다.",
        analysisReview: { ...report.analysisReview, analysisId: "synthetic-new-analysis" },
      };
      state.report = {
        status: "ready",
        id: report.id,
        revision: 2,
        basis: nextBasis,
        currentJobId: null,
        failure: null,
      };
      return route.fulfill({
        json: {
          contractVersion: "conversation-report-v1",
          requestId: request.postDataJSON().requestId,
          workspaceRevision,
          pane: "report",
          status: "ready",
          missingItems: [],
          operationId: null,
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-rework-case/reports?embedded=true&rework=true");
  const upload = page.getByRole("region", { name: "새 증거 추가", exact: true });
  await expect(upload.getByRole("button", { name: "촬영해서 추가", exact: true })).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await upload.getByRole("button", { name: "파일 선택", exact: true }).click();
  await (await chooser).setFiles({
    name: "합성 반환 약정.jpg",
    mimeType: "image/jpeg",
    buffer: readFileSync(new URL("../fixtures/media/image-markers.jpg", import.meta.url)),
  });
  await upload.getByLabel("추가한 자료의 자동 처리에 동의합니다.", { exact: true }).check();
  await upload.getByRole("button", { name: "새 증거 업로드", exact: true }).click();
  await expect(upload.getByRole("list", { name: "사건에 추가한 증거" })).toContainText(
    "합성 반환 약정.jpg",
  );
  await expect(page.getByText("과거 기준의 리포트", { exact: true })).toBeVisible();
  await expect(page.locator(".report-reading")).toContainText("제거할 파생 설명");
  if (!files[0]) throw new Error("Synthetic upload absent");
  files[0].status = "ready";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await upload.getByRole("button", { name: "관찰 검토", exact: true }).click();
  await upload
    .getByLabel("확인·교정한 내용", { exact: true })
    .fill("[문서 기재] 사용자가 확인하고 고친 반환 약정");
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "true");
  await expect(page.getByRole("button", { name: "새 버전 만들기", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(upload.getByLabel("확인·교정한 내용", { exact: true })).toHaveValue(
    "[문서 기재] 사용자가 확인하고 고친 반환 약정",
  );
  await expect(
    upload.getByRole("button", { name: "자료 내용 반영하기", exact: true }),
  ).toBeDisabled();
  await upload.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(
    upload.getByRole("button", { name: "자료 내용 반영하기", exact: true }),
  ).toBeEnabled();
  await upload.getByRole("button", { name: "자료 내용 반영하기", exact: true }).click();
  await expect(upload).toContainText("반영을 요청했어요");
  expect(reflection).toBe(1);
  expect(preparations).toBe(0);
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(page.locator(".report-reading")).toContainText("사용자 교정을 반영한 새 리포트");
  expect(preparations).toBe(1);
  expect(original).toContain("제거할 파생 설명");
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
    if (path.endsWith("/rework/resolution"))
      return route.fulfill({ json: resolutionState(report ?? undefined) });
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

for (const side of ["prepare_claim", "respond_to_claim"] as const)
  for (const choice of ["직접 해결", "변호사와 해결", "리포트만 저장"] as const)
    test(`actual report composition: ${side} → ${choice}`, async ({ page }) => {
      const report = preparedReport();
      const state = conversationState();
      state.caseContext.casePurpose = side;
      state.snapshot = partialSnapshot(state.caseContext);
      let resolution = resolutionState(report);
      if (resolution.basis) resolution.basis.casePurpose = side;
      let updates = 0,
        drafts = 0,
        analysisActions = 0,
        pdfs = 0,
        legacyReads = 0;
      let failPdf = true;
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        if (path === "/api/me/session")
          return route.fulfill({
            json: {
              user: { id: "synthetic-report-owner", name: "합성", accountType: "customer" },
              needsConsent: false,
            },
          });
        if (path.endsWith("/rework/conversation")) return route.fulfill({ json: state });
        if (path.endsWith("/rework/report")) return route.fulfill({ json: report });
        if (path.endsWith("/rework/resolution/draft")) {
          drafts++;
          return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
        }
        if (path.endsWith("/rework/resolution")) {
          if (req.method() === "PATCH") {
            updates++;
            resolution = { ...resolution, selection: req.postDataJSON().choice };
          }
          return route.fulfill({ json: resolution });
        }
        if (path.endsWith("/rework/actions")) {
          analysisActions++;
          return route.fulfill({ status: 503, json: {} });
        }
        if (path.endsWith("/report")) {
          legacyReads++;
          return route.fulfill({ json: report });
        }
        if (path.endsWith("/files")) return route.fulfill({ json: [] });
        if (path.endsWith("/pdf")) {
          pdfs++;
          if (failPdf)
            return route.fulfill({
              status: 503,
              json: { error: { code: "STORAGE_UNAVAILABLE", message: "합성 PDF 실패" } },
            });
          return route.fulfill({
            contentType: "application/pdf",
            body: Buffer.from("%PDF-1.7\nSynthetic offline transport verification\n%%EOF"),
          });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto("/cases/synthetic-rework-case/reports?rework=true&embedded=true");
      const button = page.getByRole("button", { name: new RegExp(`^${choice}`) });
      await expect(button).toBeEnabled();
      await button.click();
      if (choice === "직접 해결") {
        await expect(page.getByRole("heading", { name: "준비 순서와 확인할 안내" })).toBeVisible();
        await expect(page.getByText("관할", { exact: true })).toBeVisible();
        expect(updates).toBe(1);
      } else if (choice === "변호사와 해결") {
        await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveAttribute(
          "href",
          "/lawyers",
        );
        expect(updates).toBe(1);
      } else {
        await expect(page.locator(".resolution").getByRole("alert")).toContainText(
          "완료하지 못했어요",
        );
        await expect(page.locator(".resolution").getByRole("status")).toHaveCount(0);
        failPdf = false;
        const download = page.waitForEvent("download");
        await button.click();
        expect((await download).suggestedFilename()).toContain(report.id);
        await expect(page.locator(".resolution").getByRole("status")).toContainText("저장 요청");
        expect(updates).toBe(0);
        expect(pdfs).toBe(2);
      }
      expect(drafts).toBe(0);
      expect(analysisActions).toBe(0);
      expect(legacyReads).toBe(0);
    });
