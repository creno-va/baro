import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportButton } from "../src/product-ui/reports/ReportComponents";
import { ReportReading } from "../src/product-ui/reports/ReportReading";
import { ReportReviewView } from "../src/product-ui/reports/ReportReviewView";
import type { ReportReviewController } from "../src/product-ui/reports/useReportReviewController";
import { reportPhotoToken } from "../src/utils/report-markdown";
import { conversationState } from "./helpers/conversation-state";

const report: NonNullable<ReportReviewController["report"]> = {
  id: "synthetic-report",
  caseId: "synthetic-case",
  revision: 3,
  title: "합성 사건 리포트",
  content: "사건 요약\n검토한 합성 사실입니다.\n\n미확인 사항\n날짜는 미확인입니다.",
  updatedAt: "2026-11-16T00:00:00.000Z",
  stale: false,
  excludedFileIds: [],
  includedPhotoIds: [],
  maskIdentifiers: false,
  pdfAvailable: false,
  basis: { workspaceRevision: 12, summaryRevision: 4, generatedAt: "2026-11-16T00:00:00.000Z" },
};
const file = {
  id: "synthetic-file",
  name: "합성 자료",
  mimeType: "application/pdf",
  sizeBytes: 123,
  status: "ready" as const,
  coverage: "전체",
  extractedText: "",
};
function controller(overrides: Partial<ReportReviewController> = {}): ReportReviewController {
  return {
    accessChecking: false,
    accessUnknown: false,
    actionMissing: [],
    apiMode: "real",
    beginEditing: () => {},
    busy: "",
    cancelEdit: false,
    cancelEditing: () => {},
    caseId: report.caseId,
    changeContent: () => {},
    changeExcluded: () => {},
    changeMask: () => {},
    confirmRegenerate: () => {},
    confirmReload: () => {},
    content: report.content,
    dirty: false,
    discardEditing: () => {},
    dismissCancel: () => {},
    dismissRegenerate: () => {},
    dismissReload: () => {},
    displayTitle: report.title,
    downloadCurrentReport: async () => {},
    downloadPDF: () => {},
    downloadPreservedEdit: () => {},
    editing: false,
    editingBlocked: false,
    embedded: true,
    error: "",
    evidenceBusy: false,
    evidenceChanged: async () => {},
    evidenceDirty: false,
    evidenceFacts: [],
    excluded: [],
    exportExhausted: false,
    exportingPdf: false,
    files: [file],
    generateExcluded: () => {},
    initialLimit: false,
    initialLoading: false,
    maskIdentifiers: false,
    mockPhotoKey: "",
    mockPhotos: null,
    needsConsent: false,
    newReportAvailable: false,
    openAvailableReport: () => {},
    openRegenerate: () => {},
    owner: { current: "synthetic-owner" },
    pendingJob: undefined,
    photoCandidates: [],
    pollPaused: false,
    preparation: null,
    preservedEdit: "",
    progressText: "합성 요청 확인 중…",
    reflectEvidence: async () => true,
    refreshAfterResolution: () => {},
    refreshPreparation: () => {},
    regenerate: false,
    reloadConfirm: false,
    renewDownload: () => {},
    report,
    reportEvidenceError: () => {},
    requestPreparation: () => {},
    resolutionBusy: false,
    resolutionDirty: false,
    retryRead: () => {},
    rework: true,
    saveEditing: () => {},
    saveScope: () => {},
    setEvidenceBusy: () => {},
    setEvidenceDirty: () => {},
    setResolutionBusy: () => {},
    setResolutionDirty: () => {},
    setToolsOpen: () => {},
    toolsOpen: true,
    ...overrides,
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children: ReactNode }>(child) ? text(child.props.children) : String(child),
    )
    .join("");
}
function tree(overrides: Partial<ReportReviewController> = {}) {
  return elements(ReportReviewView({ controller: controller(overrides) }));
}
function action(nodes: ReturnType<typeof tree>, label: string) {
  const found = nodes.find(
    (node) => node.type === ReportButton && text(node.props.children as ReactNode) === label,
  );
  if (!found) throw new Error(`MISSING_SYNTHETIC_REPORT_ACTION:${label}`);
  return found;
}
function render(overrides: Partial<ReportReviewController> = {}) {
  return renderToStaticMarkup(
    <ReportReviewView
      controller={controller(overrides)}
      resolution={<p>합성 후속 절차 슬롯</p>}
      evidence={<p>합성 자료 업로드 슬롯</p>}
    />,
  );
}

describe("product report review authorization and recovery", () => {
  test("initial and unknown authorization render only public loading/error state, without private body or feature slots", () => {
    const pending = {
      report: null,
      content: "",
      owner: { current: null },
      displayTitle: "내 사건 이해와 해결 준비",
      accessChecking: true,
      busy: "접근 상태 확인 중…",
      initialLoading: true,
    };
    const loading = render(pending);
    expect(loading).toContain("리포트를 불러오고 있어요.");
    for (const value of [
      report.title,
      "검토한 합성 사실",
      "PDF 다운로드",
      "합성 자료 업로드 슬롯",
      "합성 후속 절차 슬롯",
    ])
      expect(loading).not.toContain(value);
    const failed = render({
      ...pending,
      initialLoading: false,
      accessChecking: false,
      accessUnknown: true,
      busy: "",
      error: "접근 권한을 다시 확인해 주세요.",
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("다시 확인");
    expect(failed).toContain('href="/login"');
    expect(failed).not.toContain("합성 자료 업로드 슬롯");
    expect(failed).not.toContain("합성 후속 절차 슬롯");
  });

  test("composed features require the current owner and opt-in mode; resolution also requires a report", () => {
    const authorized = render();
    expect(authorized).toContain("합성 후속 절차 슬롯");
    expect(authorized).toContain("합성 자료 업로드 슬롯");
    for (const overrides of [{ owner: { current: null } }, { rework: false }]) {
      const html = render(overrides);
      expect(html).not.toContain("합성 후속 절차 슬롯");
      expect(html).not.toContain("합성 자료 업로드 슬롯");
    }
    const noReport = render({ report: null });
    expect(noReport).not.toContain("합성 후속 절차 슬롯");
    expect(noReport).toContain("합성 자료 업로드 슬롯");
  });

  test("consent changes preserve readable stored content and cached PDF while blocking new writes", () => {
    const value = { ...report, pdfAvailable: true };
    const nodes = tree({ needsConsent: true, report: value });
    expect(action(nodes, "수정하기").props.disabled).toBe(true);
    expect(action(nodes, "새 버전 만들기").props.disabled).toBe(true);
    expect(action(nodes, "PDF 다운로드").props.disabled).toBe(false);
    const html = render({ needsConsent: true, report: value });
    expect(html).toContain("검토한 합성 사실입니다.");
    expect(html).toContain('href="/consent"');
    expect(html).toContain("기존 리포트와 저장된");
    expect(html).toContain("PDF·ZIP은 계속 확인할 수 있어요.");
  });

  test("historical and consent-restricted PDF delivery accepts only saved clean exports", () => {
    for (const restriction of ["stale", "needsConsent"] as const)
      for (const pdfAvailable of [false, true])
        for (const dirty of [false, true]) {
          const nodes = tree({
            report: { ...report, stale: restriction === "stale", pdfAvailable },
            needsConsent: restriction === "needsConsent",
            dirty,
          });
          expect(action(nodes, "PDF 다운로드").props.disabled).toBe(!pdfAvailable || dirty);
        }
    for (const overrides of [{ busy: "저장 중…" }, { exportingPdf: true }, { content: " \n" }]) {
      const nodes = tree(overrides);
      const label = overrides.exportingPdf ? "PDF 만드는 중…" : "PDF 다운로드";
      expect(action(nodes, label).props.disabled).toBe(true);
    }
  });

  test("dirty/stale editing and related-feature work retain distinct save, regeneration and interaction locks", () => {
    expect(action(tree({ editing: true }), "수정 내용 저장").props.disabled).toBe(true);
    expect(action(tree({ editing: true, dirty: true }), "수정 내용 저장").props.disabled).toBe(
      false,
    );
    const stale = tree({ editing: true, dirty: true, report: { ...report, stale: true } });
    expect(action(stale, "수정 내용 저장").props.disabled).toBe(true);
    expect(action(stale, "새 버전 만들기").props.disabled).toBe(false);
    expect(
      action(
        tree({ dirty: true, preservedEdit: "보관한 편집", report: { ...report, stale: true } }),
        "새 버전 만들기",
      ).props.disabled,
    ).toBe(true);
    for (const key of [
      "accessChecking",
      "accessUnknown",
      "evidenceBusy",
      "evidenceDirty",
      "resolutionBusy",
      "resolutionDirty",
    ] as const) {
      const nodes = tree({ [key]: true });
      expect(action(nodes, "수정하기").props.disabled).toBe(true);
      const fields = nodes.find(
        (node) => node.type === "fieldset" && node.props["data-product-report-controls"] === "",
      );
      expect(fields?.props.disabled).toBe(true);
    }
    const html = render({ report: { ...report, stale: true }, dirty: true });
    expect(html).toContain("과거 기준의 리포트");
    expect(html).toContain("미저장 편집 있음");
    expect(html).toContain("이후 사건·증거·분석 변경은 이 리포트를 바꾸지 않습니다.");
    expect(html).toContain("새 버전 만들기로 최신 사건을 반영한 뒤 다운로드하세요.");
  });

  test("request preparation displays actual pending and failed states with explicit status refresh", () => {
    const preparation = conversationState();
    preparation.report = {
      ...preparation.report,
      status: "pending",
      currentJobId: "synthetic-job",
    };
    const pending = render({
      report: null,
      preparation,
      pendingJob: "synthetic-job",
      pollPaused: true,
    });
    expect(pending).toContain("리포트를 준비하고 있어요");
    expect(pending).toContain("처리가 계속되고 있을 수 있어요.");
    const nodes = tree({ report: null, preparation, pendingJob: "synthetic-job" });
    expect(action(nodes, "리포트 준비").props.disabled).toBe(true);
    expect(action(nodes, "상태 확인").props.disabled).toBe(false);
    preparation.report = {
      ...preparation.report,
      status: "failed",
      currentJobId: null,
      failure: "STORAGE_UNAVAILABLE",
    };
    preparation.analysis.missingItems = ["합성 확인 항목"];
    const failed = render({ preparation, actionMissing: ["합성 확인 항목"] });
    expect(failed).toContain("새 리포트를 완성하지 못했어요");
    expect(failed).toContain("리포트 저장을 완료하지 못했어요. 기존 리포트는 보존돼요.");
    expect(failed.match(/<li>합성 확인 항목<\/li>/g)).toHaveLength(1);
  });
});

describe("product report review native controls and content", () => {
  test("scope controls keep real checkbox handlers and freeze while the body is unsaved", () => {
    const calls: unknown[] = [];
    const nativeEvent = { target: { checked: true } };
    const nodes = tree({
      excluded: [file.id],
      changeMask: (event) => calls.push(event),
      changeExcluded: (id) => calls.push(id),
    });
    const inputs = nodes.filter((node) => node.type === "input");
    expect(inputs).toHaveLength(2);
    const [mask, excluded] = inputs;
    if (!mask || !excluded) throw new Error("MISSING_NATIVE_REPORT_SCOPE");
    expect(mask.props.checked).toBe(false);
    expect(excluded.props.checked).toBe(true);
    (mask.props.onChange as (event: typeof nativeEvent) => void)(nativeEvent);
    (excluded.props.onChange as () => void)();
    expect(calls).toEqual([nativeEvent, file.id]);
    expect(action(nodes, "선택 범위 저장").props.disabled).toBe(false);
    expect(action(tree(), "선택 범위 저장").props.disabled).toBe(true);
    for (const overrides of [
      { needsConsent: true },
      { report: { ...report, stale: true } },
      { content: "미저장 변경" },
    ]) {
      const locked = tree(overrides);
      for (const input of locked.filter((node) => node.type === "input"))
        expect(input.props.disabled).toBe(true);
      expect(action(locked, "선택 범위 저장").props.disabled).toBe(true);
    }
  });

  test("masking hides identifier text and removes photo capabilities from read mode without changing source bytes", () => {
    const raw = `사건 요약\n연락처 010-1234-5678, synthetic@example.com\n\n${reportPhotoToken("synthetic-photo", "합성 사진")}`;
    const value = { ...report, content: raw, includedPhotoIds: ["synthetic-photo"] };
    const html = render({
      report: value,
      content: raw,
      maskIdentifiers: true,
      photoCandidates: [{ id: "synthetic-photo", name: "합성 사진", revision: 1, byteLength: 1 }],
    });
    expect(html).toContain("[전화번호 가림]");
    expect(html).toContain("[이메일 가림]");
    expect(html).not.toContain("010-1234-5678");
    expect(html).not.toContain("synthetic@example.com");
    expect(html).not.toContain("<img");
    const editing = render({ report: value, content: raw, maskIdentifiers: true, editing: true });
    expect(editing).toContain("010-1234-5678");
    expect(raw).toContain("010-1234-5678");
    expect(raw).toContain("baro-photo:synthetic-photo");
  });

  test("untrusted title, content, filenames and errors remain escaped text", () => {
    const unsafe = '<img src=x onerror="synthetic()">';
    const html = render({
      embedded: false,
      displayTitle: unsafe,
      report: { ...report, title: unsafe },
      content: `사건 요약\n${unsafe}`,
      files: [{ ...file, name: unsafe }],
      error: unsafe,
    });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="synthetic()"');
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).toContain('aria-label="리포트 검토 본문"');
    expect(html).toContain('aria-label="리포트 다운로드"');
  });

  test("first report limit recovery preserves exclusion selection and exact generation callback", () => {
    const calls: string[] = [];
    const nodes = tree({
      report: null,
      initialLimit: true,
      excluded: [file.id],
      generateExcluded: () => {
        calls.push("generate");
      },
    });
    expect(action(nodes, "선택 자료를 제외하고 생성").props.disabled).toBe(false);
    (action(nodes, "선택 자료를 제외하고 생성").props.onClick as () => void)();
    expect(calls).toEqual(["generate"]);
    expect(
      action(tree({ report: null, initialLimit: true }), "선택 자료를 제외하고 생성").props
        .disabled,
    ).toBe(true);
    const html = render({ report: null, initialLimit: true, excluded: [file.id] });
    expect(html).toContain("자료를 줄여 첫 리포트를 만들어요");
    expect(html).toContain("원본은 그대로 보관돼요.");
  });

  test("new versions and preserved edits remain explicitly separate from the current unsaved draft", () => {
    const html = render({
      newReportAvailable: true,
      dirty: true,
      preservedEdit: "합성 편집 보관본",
    });
    expect(html).toContain("저장하지 않은 편집 내용을 확인한 뒤 전환하세요.");
    expect(html).toContain("합성 편집 보관본</textarea>");
    expect(html).toContain('aria-label="보관한 리포트 편집 내용"');
    expect(html).toMatch(/<textarea[^>]*readOnly=""/);
    expect(html).toContain("검토한 합성 사실입니다.");
    expect(html).toContain("새 리포트 열기");
    expect(html).toContain("보관한 편집 내용 저장");
    const exhausted = tree({ exportExhausted: true, needsConsent: true });
    expect(action(exhausted, "새 버전으로 다시 준비").props.disabled).toBe(true);
  });

  test("native actions preserve exact handler references and textarea edits cross their direct callback", () => {
    const model = controller({
      editing: true,
      dirty: true,
      newReportAvailable: true,
      exportExhausted: true,
      preservedEdit: "합성 편집 보관본",
      error: "다시 확인할 합성 오류",
    });
    const nodes = elements(ReportReviewView({ controller: model }));
    const reading = nodes.find((node) => node.type === ReportReading);
    expect(reading?.props.onChange).toBe(model.changeContent);
    expect(reading?.props.editing).toBe(true);
    for (const [label, handler] of [
      ["편집 취소", model.cancelEditing],
      ["수정 내용 저장", model.saveEditing],
      ["새 리포트 열기", model.openAvailableReport],
      ["다시 확인", model.retryRead],
      ["보관한 편집 내용 저장", model.downloadPreservedEdit],
      ["선택 범위 저장", model.saveScope],
      ["새 버전으로 다시 준비", model.renewDownload],
      ["PDF 다운로드", model.downloadPDF],
    ] as const)
      expect(action(nodes, label).props.onClick).toBe(handler);
  });
});
