import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { V2SummaryReconciliation } from "../src/contracts/v2";
import { Button } from "../src/product-ui/Button";
import { TextareaField } from "../src/product-ui/Field";
import { SelectField } from "../src/product-ui/Select";
import { ContextReviewFields } from "../src/product-ui/summary/ContextReviewView";
import { summaryCompletionMatches } from "../src/product-ui/summary/completion";
import { SummaryChanges, SummaryReading } from "../src/product-ui/summary/SummaryReading";
import {
  SummaryExplanationForm,
  SummaryReconfirmationView,
} from "../src/product-ui/summary/SummaryReconfirmationView";
import type { ContextReviewController } from "../src/product-ui/summary/useContextReviewController";
import type { SummaryReconfirmationController } from "../src/product-ui/summary/useSummaryReconfirmationController";
import { conversationState } from "./helpers/conversation-state";
import {
  reconfirmationCandidate,
  reconfirmationCase,
  reconfirmationSummary,
} from "./helpers/intake-reconfirmation";

const item = reconfirmationCase();
const base = `/cases/${item.id}`;
const context = conversationState().caseContext;
const proposal: NonNullable<V2SummaryReconciliation["proposal"]> = {
  id: "synthetic-proposal",
  requestId: "synthetic-request",
  baseWorkspaceRevision: item.revision,
  baseIntakeRevision: 7,
  baseSummaryRevision: 3,
  before: reconfirmationSummary(),
  after: reconfirmationCandidate(),
  reasons: ["추가 진술과 확인되지 않은 금액을 함께 남겼어요."],
  createdAt: item.updatedAt,
};
function reconciliation(status: V2SummaryReconciliation["status"]): V2SummaryReconciliation {
  return {
    contractVersion: "conversation-report-v1",
    workspaceRevision: item.revision,
    status,
    request: {
      id: proposal.requestId,
      input: {
        expectedRevision: item.revision,
        summaryRevision: 3,
        kind: "addition",
        explanation: "합성 추가 진술입니다.",
      },
      createdAt: item.updatedAt,
    },
    proposal: ["proposed", "confirmed"].includes(status) ? proposal : null,
    currentJobId: ["pending", "running"].includes(status) ? "synthetic-job" : null,
    failure: status === "failed" ? "MODEL_UNAVAILABLE" : null,
    confirmedSummaryRevision: status === "confirmed" ? 4 : null,
    confirmedWorkspaceRevision: status === "confirmed" ? item.revision : null,
  };
}
function controller(
  overrides: Partial<SummaryReconfirmationController> = {},
): SummaryReconfirmationController {
  return {
    caseId: item.id,
    embedded: false,
    base,
    headingId: "synthetic-heading",
    fieldId: "synthetic-explanation",
    item,
    state: null,
    context,
    files: [],
    materialsError: false,
    loading: false,
    busy: false,
    error: null,
    notice: "",
    kind: null,
    explanation: "",
    purposeOpen: false,
    purposeDraft: null,
    confirming: null,
    returnHref: base,
    ready: true,
    canMutate: true,
    locked: false,
    activeRequest: false,
    proposal: null,
    modalActive: false,
    focusTarget: { current: null },
    dialogReturnFocus: { current: null },
    onCancel: undefined,
    retry: () => {},
    requestChange: () => {},
    openPurpose: () => {},
    agree: () => {},
    explain: () => {},
    setExplanation: () => {},
    setPurpose: () => {},
    closePurpose: () => {},
    closeExplanation: () => {},
    closeConfirmation: () => {},
    cancelProposal: () => {},
    explainAgain: () => {},
    confirmInitial: () => {},
    confirmProposal: () => {},
    savePurpose: () => {},
    ...overrides,
  };
}
function contextController(
  overrides: Partial<ContextReviewController> = {},
): ContextReviewController {
  return {
    open: true,
    loading: false,
    busy: false,
    base: { contractVersion: "conversation-report-v1", workspaceRevision: 12, context },
    draft: { purpose: "prepare_claim", kind: "civil", stage: "before_filing", description: "초안" },
    error: "",
    stale: false,
    reviewed: false,
    needsReload: false,
    changed: true,
    frozen: false,
    readDisabled: false,
    pendingAttempt: false,
    saveDisabled: false,
    openFrom: () => {},
    close: () => {},
    save: () => {},
    reloadBase: () => {},
    retryRead: () => {},
    setPurpose: () => {},
    setKind: () => {},
    setStage: () => {},
    setDescription: () => {},
    setReviewed: () => {},
    ...overrides,
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}
const render = (overrides: Partial<SummaryReconfirmationController> = {}) =>
  renderToString(<SummaryReconfirmationView controller={controller(overrides)} />);

describe("summary view and exact completion boundary", () => {
  test("authorization holds private snapshots, proposals and mutation controls out of the rendered view", () => {
    const html = render({ ready: false, loading: true, item: null });
    expect(html).toContain("저장한 사건 정리를 불러오고 있어요.");
    expect(html).not.toContain(item.summary);
    expect(html).not.toContain("맞아요");
    expect(html).not.toContain("data-fact-id");
    expect(render({ ready: false, item })).not.toContain(item.summary);
  });

  test("reading preserves question provenance, adverse/conflicting facts, unknowns and safe original links", () => {
    const summary = reconfirmationSummary();
    const fact = summary.facts[1];
    if (!fact) throw new Error("MISSING_SYNTHETIC_FACT");
    fact.text = '<img src=x onerror="synthetic()">';
    const html = renderToString(
      <SummaryReading
        summary={summary}
        base={base}
        context={item.intakeQuestions}
        files={[{ id: "synthetic-contract", name: "합성 계약서" }]}
      />,
    );
    expect(html).toContain("지급일은 언제였나요?");
    expect(html).toContain('data-fact-id="synthetic-other-date"');
    expect(html).toContain("서로 다른 진술 확인 필요");
    expect(html).toContain("불리한 사실");
    expect(html).toContain("지급일 변경에 합의했는지는 확인되지 않았습니다.");
    expect(html).toContain(`${base}/files?file=synthetic-contract`);
    expect(html).toContain("합성 계약서");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<textarea|contenteditable=|\sstyle=/i);
  });

  test("before/after snapshots remain distinct read-only server proposals", () => {
    const html = renderToString(<SummaryChanges proposal={proposal} base={base} />);
    expect(html).toContain("변경 전 전체 내용");
    expect(html).toContain("변경 후 제안");
    expect(html).toContain(proposal.before.overview);
    expect(html).toContain(proposal.after.overview);
    expect(html).toContain("추가 진술과 확인되지 않은 금액을 함께 남겼어요.");
    expect(html).not.toContain("<textarea");
    const proposed = render({ state: reconciliation("proposed"), proposal, activeRequest: true });
    for (const label of ["변경안 확정하기", "변경안 취소", "다시 설명하기"])
      expect(proposed).toContain(label);
    expect(proposed).not.toContain(">맞아요<");
    expect(proposed).toContain('aria-label="사건 정리 확인"');
    expect(proposed).toContain('tabindex="-1"');
  });

  test("pending and failed work retain their actual cancellation and recovery paths", () => {
    for (const status of ["pending", "running", "failed", "stale"] as const) {
      const html = render({ state: reconciliation(status), activeRequest: true });
      expect(html).toContain("요청 취소");
      expect(html).not.toContain("변경안 확정하기");
      expect(html).not.toContain(">맞아요<");
      expect(html).toContain(
        status === "pending" || status === "running" ? "변경안을 준비하고 있어요" : "다시 설명하기",
      );
    }
  });

  test("legacy, archive and intake continuations stay readable without summary mutation actions", () => {
    for (const changed of [
      { ...item, schemaVersion: "1" as const },
      { ...item, stage: "archived" as const },
      { ...item, stage: "intake" as const },
    ]) {
      const html = render({ item: changed });
      expect(html).not.toContain(">맞아요<");
      expect(html).not.toContain("다른 부분이 있어요");
      expect(html).toContain(changed.stage === "intake" ? `${base}/intake` : base);
    }
    const readonly = render({ canMutate: false, locked: true });
    expect(readonly).toContain('href="/consent"');
    const agree = readonly.match(/<button\b[^>]*>[\s\S]*?맞아요[\s\S]*?<\/button>/)?.[0];
    expect(agree).toContain('disabled=""');
  });

  test("explanation uses Unicode capacity and native submit/change paths without mutating canonical text", () => {
    const text = "😀".repeat(5001);
    const html = renderToString(
      <SummaryExplanationForm controller={controller({ kind: "addition", explanation: text })} />,
    );
    expect(html).toContain(`${text}</textarea>`);
    expect(html.replaceAll("<!-- -->", "")).toContain("5,001 / 5,000자");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("설명은 5,000자까지 입력할 수 있어요.");
    expect(html).not.toMatch(/maxlength=/i);
    const calls: string[] = [];
    const tree = elements(
      SummaryExplanationForm({
        controller: controller({
          kind: "correction",
          setExplanation: (value) => calls.push(typeof value === "string" ? value : value("")),
          requestChange: () => calls.push("request"),
          closeExplanation: () => calls.push("cancel"),
        }),
      }),
    );
    const field = tree.find((node) => node.type === TextareaField);
    const form = tree.find((node) => node.type === "form");
    if (!field || !form) throw new Error("MISSING_NATIVE_SUMMARY_FORM");
    (field.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "설명 😀" },
    });
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: () => calls.push("preventDefault"),
    });
    const cancel = tree.find((node) => node.type === Button && node.props.variant === "secondary");
    if (!cancel) throw new Error("MISSING_NATIVE_CANCEL");
    (cancel.props.onClick as () => void)();
    expect(calls).toEqual(["설명 😀", "preventDefault", "request", "cancel"]);
  });

  test("initial completion requires exact canonical body, owner case, ACK and fresh workspace proof", () => {
    const active = reconfirmationCase("active");
    const fresh = { ...conversationState(), workspaceRevision: active.revision };
    const intent = {
      kind: "initial" as const,
      caseId: active.id,
      revision: active.revision,
      summaryRevision: 3,
      canonical: reconfirmationSummary(),
      acknowledged: true,
    };
    expect(summaryCompletionMatches(active, null, intent, fresh)).toBe(true);
    expect(summaryCompletionMatches(active, null, { ...intent, acknowledged: false }, fresh)).toBe(
      false,
    );
    expect(summaryCompletionMatches({ ...active, id: "other-case" }, null, intent, fresh)).toBe(
      false,
    );
    expect(
      summaryCompletionMatches(active, null, intent, { ...fresh, summaryConfirmed: false }),
    ).toBe(false);
    expect(
      summaryCompletionMatches(active, null, intent, { ...fresh, workspaceRevision: 11 }),
    ).toBe(false);
    const changed = reconfirmationSummary();
    changed.overview = "동일 revision이어도 다른 내용";
    expect(
      summaryCompletionMatches({ ...active, summaryDetails: changed }, null, intent, fresh),
    ).toBe(false);
  });

  test("proposal completion cannot accept a peer request, changed body or stale publication revision", () => {
    const active = { ...reconfirmationCase("active"), summaryDetails: proposal.after };
    const state = reconciliation("confirmed");
    const intent = {
      kind: "proposal" as const,
      caseId: item.id,
      proposalId: proposal.id,
      requestId: proposal.requestId,
      revision: item.revision,
      summaryRevision: 4,
    };
    expect(summaryCompletionMatches(active, state, intent, null)).toBe(true);
    expect(
      summaryCompletionMatches(active, state, { ...intent, requestId: "peer-request" }, null),
    ).toBe(false);
    expect(
      summaryCompletionMatches(active, { ...state, workspaceRevision: 11 }, intent, null),
    ).toBe(false);
    expect(
      summaryCompletionMatches(active, { ...state, confirmedWorkspaceRevision: 11 }, intent, null),
    ).toBe(false);
    expect(
      summaryCompletionMatches({ ...active, summaryNeedsConfirmation: true }, state, intent, null),
    ).toBe(false);
    expect(
      summaryCompletionMatches({ ...active, summaryDetails: proposal.before }, state, intent, null),
    ).toBe(false);
  });
});

describe("context review fields", () => {
  test("uncertain save freezes all controls and stale comparison retains user draft behind explicit review", () => {
    const html = renderToString(
      <ContextReviewFields
        controller={contextController({ frozen: true, stale: true, needsReload: true })}
      />,
    );
    expect(html).toContain("초안</textarea>");
    expect(html).toContain("선택값은 그대로 보존했어요.");
    expect(html).toContain("최신 기준 불러오기");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<textarea[^>]*maxLength="500"[^>]*disabled=""/);
    expect(html).not.toContain("공식 사건 조회 결과입니다");
  });

  test("controlled Select values, native text, comparison and reload reach exact controller ports", () => {
    const calls: string[] = [];
    const tree = elements(
      ContextReviewFields({
        controller: contextController({
          stale: true,
          setPurpose: (value) => calls.push(`purpose:${value}`),
          setKind: (value) => calls.push(`kind:${value}`),
          setStage: (value) => calls.push(`stage:${value}`),
          setDescription: (value) => calls.push(`description:${value}`),
          setReviewed: (value) => calls.push(`reviewed:${value}`),
          reloadBase: () => {
            calls.push("reload");
          },
        }),
      }),
    );
    const selects = tree.filter((node) => node.type === SelectField);
    for (const [index, value] of ["respond_to_claim", "criminal", "appeal"].entries()) {
      const select = selects[index];
      if (!select) throw new Error("MISSING_CONTROLLED_SELECT");
      (select.props.onValueChange as (value: string) => void)(value);
    }
    const textarea = tree.find((node) => node.type === TextareaField);
    if (!textarea) throw new Error("MISSING_NATIVE_TEXTAREA");
    (textarea.props.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: "새 진행 상황 😀" },
    });
    const checkbox = tree.find((node) => node.type === "input");
    if (!checkbox) throw new Error("MISSING_NATIVE_CHECKBOX");
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    const reload = tree.find((node) => node.type === Button);
    if (!reload) throw new Error("MISSING_NATIVE_RELOAD");
    (reload.props.onClick as () => void)();
    expect(calls).toEqual([
      "purpose:respond_to_claim",
      "kind:criminal",
      "stage:appeal",
      "description:새 진행 상황 😀",
      "reviewed:true",
      "reload",
    ]);
  });
});
