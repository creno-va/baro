import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { v2ResolutionStateSchema } from "../src/contracts/v2/resolution";
import { Button } from "../src/product-ui/Button";
import { Dialog } from "../src/product-ui/Dialog";
import { TextareaField } from "../src/product-ui/Field";
import { ResolutionScope } from "../src/product-ui/resolution/ResolutionScope";
import {
  ResolutionDraft,
  ResolutionPreparation,
  ResolutionView,
} from "../src/product-ui/resolution/ResolutionView";
import type { ResolutionController } from "../src/product-ui/resolution/useResolutionController";
import { SelectField } from "../src/product-ui/Select";
import { resolutionReadingLinks } from "../src/utils/resolution";

function resolutionState() {
  const basis = {
    researchRevision: 2,
    summaryRevision: 3,
    evidenceHash: "a".repeat(64),
    casePurpose: "respond_to_claim",
    workspaceRevision: 8,
    analysisId: "synthetic-analysis",
    reportId: "synthetic-report",
    reportRevision: 4,
    procedure: { kind: "civil", stage: "before_filing", description: null },
  };
  return v2ResolutionStateSchema.parse({
    contractVersion: "conversation-report-v1",
    revision: 6,
    basis,
    selection: "self",
    selectedFileIds: ["synthetic-file"],
    maskIdentifiers: false,
    status: "active",
    draft: {
      id: "synthetic-draft",
      revision: 2,
      documentKind: "fact_statement",
      title: "합성 사실 정리 초안",
      content: "합성 사용자의 진술이며 날짜는 확인이 필요합니다.",
      basis,
      selectedFileIds: ["synthetic-file"],
      maskIdentifiers: false,
      userEdited: false,
      missingFields: ["정확한 날짜"],
      reviewed: true,
      status: "saved",
      createdAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z",
    },
    procedureChecks: [
      {
        id: "synthetic-guidance",
        label: "절차와 제출처 확인",
        detail: `확인 가능한 안내를 직접 읽어주세요. ${resolutionReadingLinks.legalAid}`,
        status: "needs_confirmation",
        sourceClaimIds: [],
      },
      {
        id: "public-defender",
        label: "별도 국선 안내",
        detail: "이 목록에 중복하지 않는 항목",
        status: "unavailable",
        sourceClaimIds: [],
      },
    ],
    weaknessChecks: ["약속 날짜가 서로 다르게 기억됩니다.", "약속 날짜가 서로 다르게 기억됩니다."],
    consultationPreparation: [],
    citations: [],
    sourceClaims: [],
    allowedDocumentKinds: ["fact_statement", "answer"],
  });
}

function controller(overrides: Partial<ResolutionController> = {}): ResolutionController {
  const state = resolutionState();
  return {
    props: { caseId: "synthetic-case", embedded: true, onSaveReport: async () => {} },
    state,
    selected: "self",
    lawyerNoticeOpen: false,
    lawyerTrigger: { current: null },
    files: [{ id: "synthetic-file", name: "합성 계약서.pdf" }],
    report: {
      id: "synthetic-report",
      revision: 4,
      stale: false,
      excludedFileIds: [],
      maskIdentifiers: false,
    },
    ids: ["synthetic-file"],
    mask: false,
    kind: "fact_statement",
    factsConfirmed: true,
    reviewed: true,
    content: state.draft?.content ?? "",
    busy: false,
    needsConsent: false,
    error: "",
    loadError: "",
    loadDiagnostic: null,
    actionDiagnostic: null,
    actionFailureStep: undefined,
    notice: "",
    pendingChoice: null,
    scopeDirty: false,
    contentDirty: false,
    dirty: false,
    reportMismatch: false,
    draftCurrent: true,
    viewBlocked: false,
    blocked: false,
    reference: { reportId: "synthetic-report", reportRevision: 4 },
    requestChoice: () => {},
    changeFile: () => {},
    changeMask: () => {},
    applyScope: () => {},
    resume: () => {},
    prepareDraft: () => {},
    changeContent: () => {},
    pause: () => {},
    changeKind: () => {},
    changeFactsConfirmed: () => {},
    changeReviewed: () => {},
    retry: () => {},
    saveDraft: () => {},
    exportDraft: () => {},
    closeLawyerNotice: () => {},
    closePendingChoice: () => {},
    discardAndChange: () => {},
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
function action(nodes: ReturnType<typeof elements>, label: string) {
  const found = nodes.find(
    (node) => node.type === Button && text(node.props.children as ReactNode) === label,
  );
  if (!found) throw new Error(`MISSING_SYNTHETIC_RESOLUTION_ACTION:${label}`);
  return found;
}
const render = (overrides: Partial<ResolutionController> = {}) =>
  renderToStaticMarkup(<ResolutionView controller={controller(overrides)} />);

describe("resolution view access and state boundaries", () => {
  test("pure SSR imports no browser API and cannot display a private draft before state is accepted", () => {
    const calls: string[] = [];
    const html = render({
      state: null,
      selected: null,
      busy: true,
      files: [],
      report: null,
      draftCurrent: null,
      reference: null,
      requestChoice: (value) => calls.push(value),
    });
    expect(html).not.toContain("합성 사실 정리 초안");
    expect(html).not.toContain("합성 사용자의 진술");
    expect(html).not.toContain("합성 계약서.pdf");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("직접 해결");
    expect(calls).toEqual([]);
  });

  test("metadata failure keeps explicit recovery and all three choices, including the existing report save path", () => {
    const html = render({
      state: null,
      selected: null,
      loadError: "후속 해결 상태를 확인하지 못했어요.",
      loadDiagnostic: { code: "UNAVAILABLE", httpStatus: 503, transport: "unknown" },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("다시 확인");
    expect(html).toContain('data-load-error-http-status="503"');
    for (const label of ["직접 해결", "변호사와 해결", "리포트만 저장"])
      expect(html).toContain(label);
    expect(html).not.toContain("<textarea");
    const calls: string[] = [];
    const c = controller({
      state: null,
      selected: null,
      requestChoice: (value) => calls.push(value),
    });
    const choices = elements(ResolutionView({ controller: c })).filter(
      (node) => node.props["data-product-resolution-path"] === "",
    );
    expect(choices).toHaveLength(3);
    for (const choice of choices) (choice.props.onClick as () => void)();
    expect(calls).toEqual(["self", "lawyer", "save_report"]);
  });

  test("unsupported lawyer notice preserves exact text, one confirmation and explicit trigger focus restoration", () => {
    const c = controller({ lawyerNoticeOpen: true });
    const nodes = elements(ResolutionView({ controller: c }));
    const dialog = nodes.find(
      (node) => node.type === Dialog && node.props.title === "아직 지원하지 않는 기능이에요",
    );
    if (!dialog) throw new Error("MISSING_UNSUPPORTED_LAWYER_DIALOG");
    expect(dialog.props.open).toBe(true);
    expect(dialog.props.description).toBe("현재 변호사 연결 기능은 제공하지 않습니다.");
    expect(dialog.props.returnFocusRef).toBe(c.lawyerTrigger);
    expect(dialog.props.showCloseButton).toBe(false);
    const controls = elements(dialog.props.children as ReactNode).filter(
      (node) => node.type === Button,
    );
    expect(controls).toHaveLength(1);
    expect(text(controls[0]?.props.children as ReactNode)).toBe("확인");
    expect(controls[0]?.props.onClick).toBe(c.closeLawyerNotice);
  });

  test("drafts with obsolete report or scope basis remain identified but their body and export controls stay concealed", () => {
    const state = resolutionState();
    state.status = "stale";
    const html = render({
      state,
      reportMismatch: true,
      draftCurrent: false,
      viewBlocked: true,
      blocked: true,
    });
    expect(html).toContain("합성 사실 정리 초안");
    expect(html).toContain("이전 기준의 초안이에요.");
    expect(html).toContain("현재 기준 다시 확인");
    expect(html).not.toContain("합성 사용자의 진술이며");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("초안 다운로드");
  });

  test("consent blocks new edits but preserves clean reviewed TXT downloads and view-only choice changes", () => {
    const c = controller({ needsConsent: true, blocked: true });
    const draft = elements(ResolutionDraft({ controller: c }));
    expect(action(draft, "검토한 초안 저장").props.disabled).toBe(true);
    expect(action(draft, "초안 다운로드").props.disabled).toBe(false);
    const field = draft.find((node) => node.type === TextareaField);
    expect(field?.props.disabled).toBe(true);
    const html = render({ needsConsent: true, blocked: true });
    expect(html).toContain("동의 전에는 화면만 전환하며 선택을 저장하지 않아요.");
    expect(html).toContain("합성 사용자의 진술이며");
    const paths = elements(ResolutionView({ controller: c })).filter(
      (node) => node.props["data-product-resolution-path"] === "",
    );
    for (const path of paths) expect(path.props.disabled).toBeFalsy();
  });

  test("paused state keeps read access and verified stored export while preventing preparation and save", () => {
    const state = resolutionState();
    state.status = "paused";
    const c = controller({ state });
    const draft = elements(ResolutionDraft({ controller: c }));
    expect(draft.find((node) => node.type === TextareaField)?.props.disabled).toBe(true);
    expect(action(draft, "검토한 초안 저장").props.disabled).toBe(true);
    expect(action(draft, "초안 다운로드").props.disabled).toBe(false);
    expect(
      action(elements(ResolutionPreparation({ controller: c })), "검토용 초안 준비").props.disabled,
    ).toBe(true);
    const view = elements(ResolutionView({ controller: c }));
    expect(action(view, "이어서 진행").props.disabled).toBe(false);
    expect(action(view, "이어서 진행").props.onClick).toBe(c.resume);
    expect(render({ state })).toContain("잠시 중단했어요. 저장된 내용을 이어갈 수 있어요.");
  });

  test("uncertain or in-flight writes lock actual controls and preserve the draft without claiming a successful save", () => {
    const state = resolutionState();
    if (!state.draft) throw new Error("MISSING_SYNTHETIC_DRAFT");
    state.draft.status = "draft";
    state.draft.reviewed = false;
    const c = controller({
      state,
      content: "응답이 불확실한 합성 수정",
      busy: true,
      contentDirty: true,
      dirty: true,
      reviewed: false,
      error: "작업을 완료하지 못했어요. 저장된 내용은 보존돼요.",
    });
    const html = render({ ...c });
    expect(html).toContain("응답이 불확실한 합성 수정</textarea>");
    expect(html).toContain("작성 중 · 미저장 수정 있음");
    expect(html).not.toContain("검토 완료 · 저장됨");
    const draft = elements(ResolutionDraft({ controller: c }));
    for (const label of ["검토한 초안 저장", "초안 다운로드"])
      expect(action(draft, label).props.disabled).toBe(true);
    expect(
      elements(ResolutionScope({ controller: c })).find((node) => node.type === "fieldset")?.props
        .disabled,
    ).toBe(true);
  });
});

describe("resolution native inputs and verified scope", () => {
  test("document selector exposes only server-allowed kinds and passes direct strings, with native fact confirmation", () => {
    const calls: string[] = [];
    const c = controller({
      changeKind: (value) => calls.push(value),
      changeFactsConfirmed: (value) => calls.push(`facts:${value}`),
    });
    const nodes = elements(ResolutionPreparation({ controller: c }));
    const select = nodes.find((node) => node.type === SelectField);
    const confirm = nodes.find((node) => node.type === "input");
    if (!select || !confirm) throw new Error("MISSING_NATIVE_PREPARATION_CONTROLS");
    expect(select.props.options).toEqual([
      { value: "fact_statement", label: "사실 정리 초안" },
      { value: "answer", label: "답변서 초안" },
    ]);
    (select.props.onValueChange as (value: string) => void)("answer");
    (confirm.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });
    expect(calls).toEqual(["answer", "facts:false"]);
    const html = render();
    expect(html).toContain("방어 선택만으로 항소를");
    expect(html).not.toContain("항소장 초안");
  });

  test("preparing requires the exact loaded reference, confirmed facts and clean scope/body", () => {
    const baseline = elements(ResolutionPreparation({ controller: controller() }));
    expect(action(baseline, "검토용 초안 준비").props.disabled).toBe(false);
    for (const overrides of [
      { busy: true },
      { blocked: true },
      { scopeDirty: true },
      { contentDirty: true },
      { factsConfirmed: false },
      { reference: null },
    ]) {
      const nodes = elements(ResolutionPreparation({ controller: controller(overrides) }));
      expect(action(nodes, "검토용 초안 준비").props.disabled).toBe(true);
    }
    const state = resolutionState();
    state.status = "not_ready";
    expect(
      action(
        elements(ResolutionPreparation({ controller: controller({ state }) })),
        "검토용 초안 준비",
      ).props.disabled,
    ).toBe(true);
  });

  test("scope labels mask filenames, preserve the report masking floor and send real checkbox values", () => {
    const calls: unknown[] = [];
    const c = controller({
      mask: true,
      report: {
        id: "synthetic-report",
        revision: 4,
        stale: false,
        excludedFileIds: [],
        maskIdentifiers: true,
      },
      scopeDirty: true,
      changeFile: (id, checked) => calls.push([id, checked]),
      changeMask: (checked) => calls.push(checked),
    });
    const html = renderToStaticMarkup(<ResolutionScope controller={c} />);
    expect(html).toContain("선택 자료 1");
    expect(html).not.toContain("합성 계약서.pdf");
    expect(html).toContain("원본은 첨부하거나 전송하지 않아요.");
    const nodes = elements(ResolutionScope({ controller: c }));
    const inputs = nodes.filter((node) => node.type === "input");
    const [file, mask] = inputs;
    if (!file || !mask) throw new Error("MISSING_NATIVE_SCOPE_INPUTS");
    expect(file.props.checked).toBe(true);
    expect(mask.props.disabled).toBe(true);
    (file.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });
    (mask.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    expect(calls).toEqual([["synthetic-file", false], true]);
    expect(action(nodes, "범위 적용").props.onClick).toBe(c.applyScope);
  });

  test("draft review keeps the 20,000 UTF-16 capacity and native edit/review events before explicit save", () => {
    const calls: unknown[] = [];
    const c = controller({
      content: "😀".repeat(10000),
      contentDirty: true,
      dirty: true,
      reviewed: false,
      changeContent: (value) => calls.push(value),
      changeReviewed: (value) => calls.push(value),
    });
    const nodes = elements(ResolutionDraft({ controller: c }));
    const field = nodes.find((node) => node.type === TextareaField);
    const review = nodes.find((node) => node.type === "input");
    if (!field || !review) throw new Error("MISSING_NATIVE_DRAFT_INPUTS");
    expect(field.props.maxLength).toBe(20000);
    (field.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "검토할 수정 😀" },
    });
    (review.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    expect(calls).toEqual(["검토할 수정 😀", true]);
    expect(action(nodes, "검토한 초안 저장").props.disabled).toBe(true);
    expect(action(nodes, "초안 다운로드").props.disabled).toBe(true);
    const html = renderToStaticMarkup(<ResolutionDraft controller={c} />);
    expect(html).toContain(`${c.content}</textarea>`);
    expect(html).toContain("정확한 날짜");
  });

  test("TXT export requires the saved reviewed clean draft and exact view access", () => {
    expect(
      action(elements(ResolutionDraft({ controller: controller() })), "초안 다운로드").props
        .disabled,
    ).toBe(false);
    for (const overrides of [{ busy: true }, { viewBlocked: true }, { dirty: true }]) {
      expect(
        action(elements(ResolutionDraft({ controller: controller(overrides) })), "초안 다운로드")
          .props.disabled,
      ).toBe(true);
    }
    const state = resolutionState();
    if (!state.draft) throw new Error("MISSING_SYNTHETIC_DRAFT");
    state.draft.reviewed = false;
    expect(
      action(elements(ResolutionDraft({ controller: controller({ state }) })), "초안 다운로드")
        .props.disabled,
    ).toBe(true);
    state.draft.reviewed = true;
    state.draft.status = "draft";
    expect(
      action(elements(ResolutionDraft({ controller: controller({ state }) })), "초안 다운로드")
        .props.disabled,
    ).toBe(true);
  });

  test("dirty path change is an explicit dialog and pause/host close stay interlocked", () => {
    const c = controller({
      pendingChoice: "save_report",
      dirty: true,
      props: { caseId: "synthetic-case", onSaveReport: async () => {}, onCancel: () => {} },
    });
    const nodes = elements(ResolutionView({ controller: c }));
    const dialog = nodes.find(
      (node) => node.type === Dialog && node.props.title === "저장하지 않은 변경이 있어요",
    );
    if (!dialog) throw new Error("MISSING_DIRTY_CHANGE_DIALOG");
    expect(dialog.props.open).toBe(true);
    expect(dialog.props.onClose).toBe(c.closePendingChoice);
    const choices = elements(dialog.props.children as ReactNode);
    expect(action(choices, "계속 검토").props.onClick).toBe(c.closePendingChoice);
    expect(action(choices, "수정을 버리고 경로 변경").props.onClick).toBe(c.discardAndChange);
    expect(action(nodes, "잠시 중단").props.disabled).toBe(true);
    expect(action(nodes, "닫기").props.disabled).toBe(true);
  });

  test("official guidance stays explicit, unsupported entries stay excluded and untrusted content remains escaped", () => {
    const state = resolutionState();
    if (!state.draft) throw new Error("MISSING_SYNTHETIC_DRAFT");
    const unsafe = '<img src=x onerror="synthetic()">';
    state.draft.title = unsafe;
    state.procedureChecks[0] = {
      id: "synthetic-guidance",
      label: unsafe,
      detail: `임의 주소 https://untrusted.example/path\n${resolutionReadingLinks.legalAid}`,
      status: "needs_confirmation",
      sourceClaimIds: [],
    };
    const html = render({
      state,
      content: unsafe,
      files: [{ id: "synthetic-file", name: unsafe }],
    });
    expect(html).toContain("공식 안내 확인 필요");
    expect(html).toContain(`href="${resolutionReadingLinks.legalAid.replaceAll("&", "&amp;")}"`);
    expect(html).not.toContain('href="https://untrusted.example/path"');
    expect(html).not.toContain("별도 국선 안내");
    expect(html.match(/<li[^>]*>약속 날짜가 서로 다르게 기억됩니다\.<\/li>/g)).toHaveLength(1);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/\sstyle=|class="resolution(?:[ -]|"|__)/i);
    expect(html).toContain("이 화면에서 제출·발송·대리를 수행하지 않아요.");
  });
});
