import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ApiError } from "../src/client/api/errors";
import type { FileView, FileReviewView as ReviewData } from "../src/client/api/types";
import { CaseContextOverview, CaseContextView } from "../src/product-ui/materials/CaseContextView";
import { coverageRows } from "../src/product-ui/materials/coverage";
import { FileReviewView } from "../src/product-ui/materials/FileReviewView";
import { MaterialsPanelView } from "../src/product-ui/materials/MaterialsPanelView";
import type { CaseContextPanelProps, MaterialsPanelProps } from "../src/product-ui/materials/types";
import {
  type CaseContextController,
  useCaseContextController,
} from "../src/product-ui/materials/useCaseContextController";
import type { FileReviewController } from "../src/product-ui/materials/useFileReviewController";
import { audioCoverage, documentCoverage, readyFile, videoCoverage } from "./fixtures/contracts/v2";

function review(overrides: Partial<ReviewData> = {}): ReviewData {
  const value = readyFile.observations[0];
  if (!value) throw new Error("MISSING_SYNTHETIC_OBSERVATION");
  return {
    file: { id: "synthetic-file", revision: 7, name: "합성 계약서.pdf", status: "ready" },
    workspaceRevision: 23,
    coverage: documentCoverage,
    observations: [{ ordinal: 0, value, original: { ...value, text: "원본의 합성 추출 내용" } }],
    nextAfterOrdinal: null,
    pendingReview: null,
    recovery: null,
    ...overrides,
  };
}
function controller(overrides: Partial<FileReviewController> = {}): FileReviewController {
  return {
    fieldPrefix: "synthetic-review",
    review: review(),
    drafts: {},
    busy: false,
    loadingAfter: null,
    notice: "",
    error: null,
    ready: true,
    canMutate: true,
    canEdit: true,
    canWrite: true,
    dirty: false,
    rows: coverageRows(documentCoverage),
    photo: false,
    partial: false,
    limit: 100,
    setLimit: () => {},
    retry: async () => {},
    updateDraft: () => {},
    loadMore: () => {},
    continueSave: () => {},
    discardPending: () => {},
    saveDrafts: () => {},
    ...overrides,
  };
}
function buttonAttributes(html: string, label: string) {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g))
    if (match[2]?.replace(/<[^>]+>/g, "").trim() === label) return match[1] ?? "";
  throw new Error(`MISSING_SYNTHETIC_BUTTON:${label}`);
}
function file(overrides: Partial<FileView> = {}): FileView {
  return {
    id: "synthetic-file",
    name: "합성 자료.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1025,
    status: "ready",
    coverage: "1쪽 처리됨",
    extractedText: "",
    ...overrides,
  };
}
function materials(overrides: Partial<MaterialsPanelProps> = {}): MaterialsPanelProps {
  return {
    caseId: "synthetic-case",
    files: [file()],
    children: null,
    busy: "",
    readonly: false,
    ready: true,
    evidenceIds: new Set(),
    selected: [],
    onSelect: () => {},
    onReview: () => {},
    onDelete: () => {},
    onRetry: () => {},
    acceptedFileRetries: [],
    report: null,
    ...overrides,
  };
}
function context(overrides: Partial<CaseContextPanelProps> = {}): CaseContextPanelProps {
  return {
    caseId: "synthetic-case",
    files: [],
    materials: null,
    viewer: null,
    onAdd: () => {},
    canAdd: true,
    onReview: () => {},
    ...overrides,
  };
}
function initialContext(props: CaseContextPanelProps) {
  let result: CaseContextController | undefined;
  function Probe() {
    result = useCaseContextController(props);
    return null;
  }
  renderToString(<Probe />);
  if (!result) throw new Error("MISSING_SYNTHETIC_CONTEXT");
  return result;
}

describe("material extraction coverage", () => {
  test("document, audio and video positions retain silence, gaps and failed scene detection", () => {
    expect(coverageRows(documentCoverage)).toEqual(["1쪽 · 처리됨"]);
    expect(coverageRows(audioCoverage)).toEqual(["0–1초 · 처리됨", "1–2초 · 무음"]);
    if (videoCoverage.category !== "video") throw new Error("MISSING_SYNTHETIC_VIDEO");
    const rows = coverageRows({
      ...videoCoverage,
      status: "partial",
      sceneDetection: "failed",
      frames: videoCoverage.frames.map((frame, index) => ({
        ...frame,
        status: index === 0 ? "failed" : "missing",
      })),
    });
    expect(rows.some((row) => row.includes("프레임 0 · 실패"))).toBe(true);
    expect(rows.some((row) => row.includes("미처리"))).toBe(true);
    expect(rows).toContain("장면 변화 탐지 실패 · 추가 장면이 누락될 수 있어요.");
  });
});

describe("file correction presentation boundaries", () => {
  test("unresolved authorization never renders private text, revisions or correction controls", () => {
    const html = renderToString(
      <FileReviewView
        controller={controller({
          ready: false,
          review: review({
            file: {
              id: "private-sentinel",
              name: "private-name-sentinel",
              revision: 47,
              status: "ready",
            },
          }),
        })}
      />,
    );
    expect(html).toContain("처리 위치와 저장한 교정 내용을 불러오고 있어요.");
    expect(html).not.toContain("private-name-sentinel");
    expect(html).not.toContain("원본의 합성 추출 내용");
    expect(html).not.toContain("<textarea");
  });

  test("correction fields retain original text, file revision, Unicode capacity and exclusion semantics", () => {
    const value = review().observations[0]?.value;
    if (!value) throw new Error("MISSING_SYNTHETIC_OBSERVATION");
    const text = `${"😀".repeat(5001)}<script>synthetic</script>`;
    const html = renderToString(
      <FileReviewView
        controller={controller({ dirty: true, drafts: { [value.id]: { text, included: false } } })}
      />,
    );
    expect(html).toContain('for="synthetic-review-observation-0"');
    expect(html).toContain("확인·교정한 내용");
    expect(html).toContain("원본의 합성 추출 내용");
    expect(html).toContain("파일 v");
    expect(html).toContain("7");
    expect(html).toContain("교정 내용은 5,000자 이내로 작성해 주세요.");
    expect(html).toContain("원본은 보관하고 AI 처리·새 리포트에서 제외합니다.");
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(html).not.toMatch(/\sstyle=|maxLength=|<script\b/i);
    expect(buttonAttributes(html, "교정 내용 저장")).toContain('disabled=""');
    const valid = renderToString(
      <FileReviewView
        controller={controller({
          dirty: true,
          drafts: { [value.id]: { text: "😀".repeat(5000), included: true } },
        })}
      />,
    );
    expect(buttonAttributes(valid, "교정 내용 저장")).not.toContain('disabled=""');
  });

  test("dirty or pending page reads cannot replace edits through the load-more action", () => {
    for (const override of [{ dirty: true }, { loadingAfter: 0 }, { busy: true }]) {
      const html = renderToString(
        <FileReviewView
          controller={controller({ review: review({ nextAfterOrdinal: 3 }), ...override })}
        />,
      );
      expect(buttonAttributes(html, "추출 내용 더 보기")).toContain('disabled=""');
    }
    const html = renderToString(
      <FileReviewView controller={controller({ review: review({ nextAfterOrdinal: 3 }) })} />,
    );
    expect(buttonAttributes(html, "추출 내용 더 보기")).not.toContain('disabled=""');
  });

  test("unfinished correction receipts retain explicit continue/cancel choices and partial acknowledgement", () => {
    const pending = {
      reviewId: "synthetic-review",
      fileId: "synthetic-file",
      revision: 7,
      workspaceRevision: 23,
      status: "saving" as const,
      completed: 2,
      total: 4,
    };
    const html = renderToString(
      <FileReviewView
        controller={controller({
          canWrite: false,
          review: review({ pendingReview: pending }),
          notice:
            "2개 교정은 저장했어요. 남은 교정은 아직 저장하지 못했으며 입력은 그대로 남아 있어요.",
        })}
      />,
    );
    expect(html).toContain("교정 저장 중 2 / 4");
    expect(buttonAttributes(html, "저장 이어가기")).toContain('disabled=""');
    expect(buttonAttributes(html, "미완료 교정 취소")).not.toContain('disabled=""');
    expect(html).toContain("남은 교정은 아직 저장하지 못했으며 입력은 그대로 남아 있어요.");
    expect(html).not.toContain("교정 내용 저장</button>");
  });

  test("conflicted pending receipts cannot continue, while read-only access still explains consent", () => {
    const pending = {
      reviewId: "synthetic-review",
      fileId: "synthetic-file",
      revision: 7,
      workspaceRevision: 23,
      status: "conflict" as const,
      completed: 2,
      total: 4,
    };
    const html = renderToString(
      <FileReviewView
        controller={controller({
          canMutate: false,
          canWrite: false,
          review: review({ pendingReview: pending }),
        })}
      />,
    );
    expect(html).toContain("미완료 교정을 취소한 뒤 다시 확인해 주세요.");
    expect(html).not.toContain("저장 이어가기");
    expect(html).toContain('href="/consent"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  test("partial material warnings and recoverable errors remain honest and explicit", () => {
    const html = renderToString(
      <FileReviewView
        controller={controller({
          partial: true,
          photo: true,
          error: new ApiError("CONFLICT", "자료가 변경됐어요."),
        })}
      />,
    );
    expect(html).toContain("일부만 분석했어요.");
    expect(html).toContain("선명한 전체 사진이나 확대 사진을 추가해 주세요.");
    expect(html).toContain("최신 내용 불러오기");
    expect(html).not.toContain("교정 내용을 저장했어요.");
  });
});

describe("material list and context presentation", () => {
  test("rendering metadata never executes processing, deletion, selection or report callbacks", () => {
    const calls: string[] = [];
    const html = renderToString(
      <MaterialsPanelView
        {...materials({
          files: [file({ status: "failed", canRetry: true })],
          onRetry: () => calls.push("retry"),
          onReview: () => calls.push("review"),
          onDelete: () => calls.push("delete"),
          onReportRefresh: () => calls.push("report"),
          report: { status: "stale" } as MaterialsPanelProps["report"],
        })}
      />,
    );
    expect(calls).toEqual([]);
    expect(html).toContain("처리 다시 시도");
    expect(html).toContain("자료 확인");
    expect(html).toContain('href="/cases/synthetic-case/reports?mode=conversation"');
    expect(html).toContain("저장된 리포트와 현재 사건의 기준을 확인해 주세요.");
    expect(html).not.toMatch(/\sstyle=|<audio\b|<video\b/);
  });

  test("accepted retries and read-only selection are disabled without removing inspection", () => {
    const html = renderToString(
      <MaterialsPanelView
        {...materials({
          readonly: true,
          files: [file({ id: "retry-file", status: "failed", canRetry: true }), file()],
          acceptedFileRetries: ["retry-file"],
          selected: ["synthetic-file"],
        })}
      />,
    );
    expect(buttonAttributes(html, "처리 다시 시도")).toContain('disabled=""');
    expect(buttonAttributes(html, "자료 확인")).not.toContain('disabled=""');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(html.replaceAll("<!-- -->", "")).toContain("대화에 사용할 합성 자료.pdf");
  });

  test("pending owner checks conceal private metadata with inert content and block deletion", () => {
    const html = renderToString(<MaterialsPanelView {...materials({ ready: false })} />);
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(buttonAttributes(html, "삭제")).toContain('disabled=""');
    expect(html).not.toMatch(/\sstyle=/);
  });

  test("context priorities reflect persisted file/report state and research requires intent", () => {
    const prepared = initialContext(context({ files: [file()] }));
    expect(prepared.active).toBe(1);
    expect(prepared.attention).toBe(false);
    expect(prepared.researchOpened).toBe(false);
    const failed = initialContext(context({ files: [file({ status: "failed" })] }));
    expect(failed.active).toBe(0);
    expect(failed.failed).toHaveLength(1);
    expect(initialContext(context({ files: [file()], reportStatus: "stale" })).active).toBe(0);
    expect(initialContext(context()).active).toBe(0);
  });

  test("context SSR defers mounted Headless panels and overview preserves real report/add actions", () => {
    const props = context({ canAdd: false, reportStatus: "failed" });
    const state = initialContext(props);
    expect(renderToString(<CaseContextView {...props} controller={state} />)).toBe("");
    const html = renderToString(<CaseContextOverview {...props} controller={state} />);
    expect(html).toContain("리포트 상태를 확인해 주세요");
    expect(html).toContain('href="/cases/synthetic-case/reports?mode=conversation"');
    expect(buttonAttributes(html, "첫 자료 추가하기받은 문서나 관련 자료를 첨부하세요")).toContain(
      "disabled",
    );
    expect(html).toContain("관련 판례 살펴보기");
  });
});
