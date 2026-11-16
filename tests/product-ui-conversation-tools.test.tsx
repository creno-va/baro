import { describe, expect, test } from "bun:test";
import { dirname, extname, resolve } from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { WorkspaceView } from "../src/client/api/types";
import type { ConversationPaneProps } from "../src/components/workspace/ConversationAgent";
import { ProgressiveReply } from "../src/components/workspace/ProgressiveReply";
import { Button, ButtonLink } from "../src/product-ui/Button";
import { AgentView } from "../src/product-ui/conversation-tools/AgentView";
import { AnalysisView } from "../src/product-ui/conversation-tools/AnalysisView";
import { PanelView } from "../src/product-ui/conversation-tools/PanelView";
import { PreparationView } from "../src/product-ui/conversation-tools/PreparationView";
import { ProgressiveReplyView } from "../src/product-ui/conversation-tools/ProgressiveReplyView";
import { SourceCardsView } from "../src/product-ui/conversation-tools/SourceCardsView";
import type { ConversationAgentController } from "../src/product-ui/conversation-tools/useConversationAgentController";
import { conversationState, limitedConversationState } from "./helpers/conversation-state";

function workspace(): WorkspaceView {
  return {
    case: {
      id: "synthetic-case",
      title: "합성 사건",
      subjectContext: "individual",
      stage: "active",
      schemaVersion: "2",
      revision: 8,
      updatedAt: "2026-11-16T00:00:00.000Z",
      summary: "합성 요약",
    },
    files: [],
    actions: [],
    timeline: [],
    messages: [],
  };
}
function controller(
  overrides: Partial<ConversationAgentController> = {},
): ConversationAgentController {
  return {
    state: conversationState(),
    pane: null,
    error: "",
    busy: false,
    paneBusy: false,
    checkingConfirmation: false,
    attempt: { current: null },
    recheck: async () => {},
    execute: async () => {},
    canMutate: true,
    reportHref: undefined,
    next: "analyze_legal",
    disabled: false,
    stateIsCurrent: true,
    menu: { current: null },
    continuationPending: false,
    continuationUnconfirmed: false,
    close: async () => {},
    origin: { current: null },
    mounted: { current: true },
    current: () => true,
    paneEpoch: { current: 1 },
    abort: { current: new AbortController() },
    result: null,
    waiting: false,
    missingItems: [],
    workspace: workspace(),
    onReviewFile: () => {},
    renderPane: () => <p>합성 소유 모듈</p>,
    changed: async () => null,
    changeDirty: () => {},
    changePaneBusy: () => {},
    setViewedReport: () => {},
    dirty: { current: false },
    setHasDraft: () => {},
    setResult: () => {},
    setPane: () => {},
    ...overrides,
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...elements(child.props.children as ReactNode)]
      : [],
  );
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
    (node) => node.type === Button && text(node.props.children as ReactNode).trim() === label,
  );
  if (!found) throw new Error(`MISSING_SYNTHETIC_CONVERSATION_ACTION:${label}`);
  return found;
}
function render(overrides: Partial<ConversationAgentController> = {}) {
  return renderToStaticMarkup(<AgentView controller={controller(overrides)} />);
}

describe("conversation action state and owning pane contracts", () => {
  test("the first render remains an honest current-state read with no private pane or action", () => {
    const html = render({ state: null, next: null });
    expect(html).toContain("사건의 현재 작업 상태를 확인하고 있어요.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("대화에서 이어갈 작업");
    expect(html).not.toContain("합성 소유 모듈");
    expect(html).not.toContain('role="alert"');
  });

  test("all existing busy, external disable and stale-revision fences disable the action and menu", () => {
    for (const overrides of [
      { busy: true },
      { paneBusy: true },
      { disabled: true },
      { stateIsCurrent: false },
    ]) {
      const nodes = elements(AgentView({ controller: controller(overrides) }));
      expect(action(nodes, "법률·판례와 현재 약점 확인").props.disabled).toBe(true);
      const menu = nodes.find((node) => node.props["data-product-conversation-menu"] === "");
      expect(menu?.type).toBe("fieldset");
      expect(menu?.props.disabled).toBe(true);
    }
    const nodes = elements(AgentView({ controller: controller() }));
    expect(action(nodes, "법률·판례와 현재 약점 확인").props.disabled).toBe(false);
    expect(render({ busy: true })).toContain('aria-busy="true"');
  });

  test("read-only ownership explains consent and passes separate read/write fences unchanged", () => {
    let received: ConversationPaneProps | null = null;
    const value = controller({
      pane: "preparation",
      canMutate: false,
      renderPane: (_pane, props) => {
        received = props;
        return <p>권한이 확인된 보관 내용</p>;
      },
    });
    const html = renderToStaticMarkup(<AgentView controller={value} />);
    const props = received as ConversationPaneProps | null;
    expect(html).toContain("현재 정책 동의 후 이어갈 수");
    expect(html).toContain("권한이 확인된 보관 내용");
    expect(props?.disabled).toBe(true);
    expect(props?.readDisabled).toBe(false);
    expect(props?.onChanged).toBe(value.changed);
    expect(props?.onCancel).toBe(value.close);
    expect(props?.onDirtyChange).toBe(value.changeDirty);
    expect(props?.onBusyChange).toBe(value.changePaneBusy);
  });

  test("a stale analysis never renders the old snapshot as current; other panes retain disabled drafts", () => {
    const state = limitedConversationState();
    const html = render({ state, pane: "analysis", stateIsCurrent: false });
    expect(html).toContain("검토 중인 입력은 보존돼요.");
    expect(html).not.toContain("공식 근거를 확인하지 못했어요");
    for (const overrides of [{ stateIsCurrent: false }, { busy: true }, { disabled: true }]) {
      let received: ConversationPaneProps | null = null;
      AgentView({
        controller: controller({
          ...overrides,
          pane: "reconfirmation",
          renderPane: (_pane, props) => {
            received = props;
            return null;
          },
        }),
      });
      const props = received as ConversationPaneProps | null;
      expect(props?.disabled).toBe(true);
      expect(props?.readDisabled).toBe(true);
    }
  });

  test("report routes remain native links for the exact same ready-report actions", () => {
    const state = limitedConversationState();
    state.report = { ...state.report, id: "synthetic-report", revision: 3, status: "ready" };
    const nodes = elements(
      AgentView({
        controller: controller({
          state,
          next: "prepare_report",
          reportHref: "/cases/synthetic-case/reports",
        }),
      }),
    );
    const links = nodes.filter((node) => node.type === ButtonLink);
    expect(links.map((node) => text(node.props.children as ReactNode).trim())).toEqual([
      "리포트 열기",
      "이후 해결 방법 선택",
      "검토한 리포트 저장",
      "변호사와 해결 준비",
    ]);
    expect(links.every((node) => node.props.href === "/cases/synthetic-case/reports")).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.type === Button && text(node.props.children as ReactNode).includes("리포트 열기"),
      ),
    ).toBe(false);
  });

  test("only a retained attempt exposes same-request recovery; checking disables rechecks", () => {
    const value = controller({
      error: "합성 일시 오류",
      checkingConfirmation: true,
      attempt: {
        current: {
          identity: "synthetic-identity",
          input: { action: "analyze_legal", expectedRevision: 8, requestId: "synthetic-request" },
        },
      },
    });
    const nodes = elements(AgentView({ controller: value }));
    expect(action(nodes, "상태 다시 확인").props.disabled).toBe(true);
    expect(action(nodes, "같은 요청 결과 확인").props.disabled).toBe(false);
    expect(render({ error: "합성 일시 오류" })).not.toContain("같은 요청 결과 확인");
    expect(render({ error: "합성 일시 오류" })).toContain('role="alert"');
  });

  test("continuation and pending receipts never announce a completed result", () => {
    const checking = render({ continuationPending: true });
    expect(checking).toContain("아직 완료된 결과는 아니에요.");
    const unknown = render({ continuationUnconfirmed: true });
    expect(unknown).toContain("입력과 자료는 보존돼요.");
    expect(unknown).toContain("리포트 상태 다시 확인");
    expect(render({ continuationUnconfirmed: true, error: "합성 읽기 오류" })).not.toContain(
      "리포트 상태 다시 확인",
    );
    const receipt: NonNullable<ConversationAgentController["result"]> = {
      contractVersion: "conversation-report-v1",
      requestId: "synthetic-request",
      status: "pending",
      pane: "preparation",
      workspaceRevision: 8,
      missingItems: [],
      operationId: null,
    };
    const pending = render({
      pane: "preparation",
      result: receipt,
      waiting: true,
      missingItems: ["합성 미확인 날짜"],
    });
    expect(pending).toContain("요청을 접수했어요.");
    expect(pending).toContain("아직 완료된 결과는");
    expect(pending).toContain("합성 미확인 날짜");
    expect(render({ pane: "preparation", result: receipt, waiting: false })).not.toContain(
      "요청을 접수했어요.",
    );
  });

  test("accepted report identity callbacks retain live mount, epoch, abort and report-pane fences", () => {
    for (const rejected of ["unmounted", "epoch", "abort", "other-pane", "accepted"] as const) {
      const accepted: string[] = [];
      let received: ConversationPaneProps | null = null;
      const value = controller({
        pane: rejected === "other-pane" ? "preparation" : "report",
        current: () => rejected !== "epoch",
        mounted: { current: rejected !== "unmounted" },
        setViewedReport: (identity) => {
          if (typeof identity === "string") accepted.push(identity);
        },
        renderPane: (_pane, props) => {
          received = props;
          return null;
        },
      });
      if (rejected === "abort") value.abort.current.abort();
      AgentView({ controller: value });
      const props = received as ConversationPaneProps | null;
      props?.onReportViewed({ id: "synthetic-report", revision: 7 });
      expect(accepted).toEqual(rejected === "accepted" ? ["synthetic-report:7"] : []);
    }
  });

  test("pane transitions clear draft metadata only after the same live owner epoch", () => {
    for (const active of [false, true]) {
      const calls: unknown[] = [];
      let received: ConversationPaneProps | null = null;
      const value = controller({
        pane: "report",
        current: () => active,
        dirty: { current: true },
        setHasDraft: (dirty) => calls.push(dirty),
        setResult: (result) => calls.push(result),
        setPane: (pane) => calls.push(pane),
        renderPane: (_pane, props) => {
          received = props;
          return null;
        },
      });
      AgentView({ controller: value });
      const props = received as ConversationPaneProps | null;
      props?.onOpenPane("preparation");
      expect(calls).toEqual(active ? [false, null, "preparation"] : []);
      expect(value.dirty.current).toBe(!active);
    }
  });
});

describe("read-only analysis, preparation and published text", () => {
  test("every analysis status keeps its exact meaning and deduplicates missing checks", () => {
    const labels = {
      not_started: "법률·판례 조사를 준비할 수 있어요",
      pending: "법률·판례 조사 접수됨",
      running: "법률·판례를 확인하고 있어요",
      ready: "현재 기준의 법률·판례 조사",
      partial: "일부 근거를 확인했어요",
      empty: "확인한 범위에서 관련 근거를 찾지 못했어요",
      unavailable: "공식 근거를 확인하지 못했어요",
      failed: "조사를 완료하지 못했어요",
      stale: "사건이나 자료가 바뀌어 다시 확인해야 해요",
    } as const;
    for (const [status, label] of Object.entries(labels)) {
      const state = conversationState();
      state.analysis.status = status as keyof typeof labels;
      state.analysis.missingItems = ["합성 남은 확인", "합성 남은 확인"];
      const html = renderToStaticMarkup(
        <AnalysisView
          state={state}
          files={[]}
          onReviewFile={() => {
            throw new Error("READ_ONLY_REVIEW");
          }}
        />,
      );
      expect(html).toContain(label);
      expect(html.match(/합성 남은 확인/g)).toHaveLength(1);
      expect(html).not.toContain("href=");
    }
  });

  test("only stale, pending, running and failed snapshots carry the previous-basis warning", () => {
    for (const status of [
      "stale",
      "pending",
      "running",
      "failed",
      "partial",
      "ready",
      "unavailable",
      "empty",
    ] as const) {
      const state = limitedConversationState();
      state.analysis.status = status;
      const html = renderToStaticMarkup(
        <AnalysisView state={state} files={[]} onReviewFile={() => {}} />,
      );
      expect(html.includes('aria-label="이전 조사 결과"')).toBe(
        ["stale", "pending", "running", "failed"].includes(status),
      );
      expect(html).toContain("요약 2판 기준");
      expect(html).toContain('dateTime="2026-11-01T00:00:00.000Z"');
      expect(html).toContain("이 결과의 한계");
    }
  });

  test("timeline sorting is nonmutating, missing dates remain last and caller history stays visible", () => {
    const view = workspace();
    view.timeline = [
      { id: "unknown", date: "", title: "합성 미확인 일정", detail: "날짜 미확인" },
      { id: "later", date: "2026-11-15", title: "합성 늦은 일정", detail: "후속 연락" },
      { id: "earlier", date: "2026-10-01", title: "합성 이른 일정", detail: "처음 연락" },
    ];
    const html = renderToStaticMarkup(
      <PreparationView
        view={view}
        disabled={false}
        onReviewFile={() => {}}
        onActionChange={() => {}}
        onRefresh={() => {}}
        history={{
          timeline: <p>합성 이전 일정 불러오기</p>,
          actions: <p>합성 이전 행동 불러오기</p>,
        }}
      />,
    );
    expect(html.indexOf("합성 이른 일정")).toBeLessThan(html.indexOf("합성 늦은 일정"));
    expect(html.indexOf("합성 늦은 일정")).toBeLessThan(html.indexOf("합성 미확인 일정"));
    expect(view.timeline.map((item) => item.id)).toEqual(["unknown", "later", "earlier"]);
    expect(html).toContain("합성 이전 일정 불러오기");
    expect(html).toContain("합성 이전 행동 불러오기");
  });

  test("missing linked facts and inaccessible evidence remain unknown while conflicting and unfavorable statements stay visible", () => {
    const state = limitedConversationState();
    if (!state.snapshot) throw new Error("MISSING_SYNTHETIC_SNAPSHOT");
    state.snapshot.issues = [
      {
        id: "synthetic-issue",
        title: "합성 반환 약정 검토",
        requirements: [
          {
            id: "synthetic-requirement",
            label: "합성 반환 내용",
            assessment: "conflicting",
            sourceClaimIds: ["unavailable-claim"],
            factIds: ["uncertain", "unfavorable", "not-loaded"],
            conflictingFactIds: ["conflicting"],
            evidence: [
              {
                kind: "user_material",
                fileId: "inaccessible-file",
                fileRevision: 1,
                position: { kind: "document", page: 2, paragraph: 1, table: null },
              },
            ],
            gaps: ["합성 추가 확인", "합성 추가 확인"],
          },
        ],
      },
    ];
    const facts: NonNullable<WorkspaceView["facts"]> = [
      {
        id: "uncertain",
        text: "합성 날짜 진술",
        attribution: "user_statement",
        certainty: "uncertain",
        significance: "neutral",
        references: [],
        conflictingFactIds: [],
        userEdited: false,
      },
      {
        id: "unfavorable",
        text: "합성 우리 쪽에 불리한 진술",
        attribution: "user_statement",
        certainty: "reported",
        significance: "unfavorable",
        references: [],
        conflictingFactIds: [],
        userEdited: false,
      },
      {
        id: "conflicting",
        text: "합성 상반 진술",
        attribution: "user_statement",
        certainty: "conflicting",
        significance: "neutral",
        references: [],
        conflictingFactIds: [],
        userEdited: false,
      },
    ];
    const html = renderToStaticMarkup(
      <AnalysisView
        state={state}
        files={[]}
        facts={facts}
        onReviewFile={() => {
          throw new Error("READ_ONLY_FILE_REVIEW");
        }}
      />,
    );
    for (const value of [
      "상반된 내용 확인 필요",
      "합성 날짜 진술",
      "· 미확인",
      "합성 우리 쪽에 불리한 진술",
      "합성 상반 진술",
      "· 상반된 내용",
      "이를 확인된 사실로 새로 추정하지 않아요.",
      "현재 확인할 수 없는 자료",
    ])
      expect(html).toContain(value);
    expect(html.match(/합성 추가 확인/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>현재 확인할 수 없는 자료/);
    expect(html).not.toContain("공식 원문</a>");
  });

  test("controlled native checkboxes retain action identity, done state and write disable; refresh callbacks keep exact targets", () => {
    const view = workspace();
    view.actions = [
      { id: "one", title: "합성 완료 행동", detail: "완료 상태", done: true },
      { id: "two", title: "합성 남은 행동", detail: "남은 확인", done: false },
    ];
    const refreshed: string[] = [];
    const tree = PreparationView({
      view,
      disabled: true,
      onReviewFile: () => {},
      onActionChange: () => {},
      onRefresh: (target) => refreshed.push(target),
    });
    const nodes = elements(tree);
    const inputs = nodes.filter((node) => node.type === "input");
    expect(
      inputs.map((node) => [node.props.type, node.props.checked, node.props.disabled]),
    ).toEqual([
      ["checkbox", true, true],
      ["checkbox", false, true],
    ]);
    expect(inputs.every((node) => String(node.props.className).includes("appearance-auto"))).toBe(
      true,
    );
    const enabled = elements(
      PreparationView({
        view,
        disabled: false,
        onReviewFile: () => {},
        onActionChange: () => {},
        onRefresh: (target) => refreshed.push(target),
      }),
    );
    for (const label of ["최신 자료로 흐름 정리", "최신 자료로 행동 정리"])
      (action(enabled, label).props.onClick as () => void)();
    expect(refreshed).toEqual(["timeline", "actions"]);
    expect(renderToStaticMarkup(tree)).toContain("다음 행동 · 1/2 완료");
  });

  test("partial preparation collections remain explicitly partial when no history slot is supplied", () => {
    const view = { ...workspace(), pagination: { messages: false, timeline: true, actions: true } };
    const html = renderToStaticMarkup(
      <PreparationView
        view={view}
        disabled
        onReviewFile={() => {}}
        onActionChange={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("현재 불러온 일정만 표시했어요. 이전 기록도 보존돼요.");
    expect(html).toContain("현재 불러온 행동만 표시했어요. 이전 기록도 보존돼요.");
  });

  test("source cards preserve exact source identity, text, URL, safe new-tab attributes and no inferred verification", () => {
    const html = renderToStaticMarkup(
      <SourceCardsView
        citations={[
          {
            id: "synthetic-source",
            title: "합성 <출처>",
            url: "https://www.law.go.kr/synthetic?view=1&part=2",
          },
        ]}
      />,
    );
    expect(html).toContain('aria-label="공식 출처"');
    expect(html).toContain("합성 &lt;출처&gt;");
    expect(html).toContain('href="https://www.law.go.kr/synthetic?view=1&amp;part=2"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="합성 &lt;출처&gt; 원문 보기"');
    expect(html).not.toContain("검증 완료");
    expect(renderToStaticMarkup(<SourceCardsView citations={[]} />)).not.toContain("<li");
  });

  test("initial reveal remains grapheme-safe and full published answers stay immediately readable without animation", () => {
    const props = { text: "👨‍👩‍👧‍👦 합성 공개 답변", onProgress: () => {}, onComplete: () => {} };
    const revealing = renderToStaticMarkup(<ProgressiveReply {...props} animate />);
    expect(revealing).toContain("👨‍👩‍👧‍👦");
    expect(revealing).not.toContain("합성 공개 답변");
    expect(revealing).toContain('aria-busy="true"');
    expect(revealing).toContain("답변 전체 바로 보기");
    const complete = renderToStaticMarkup(<ProgressiveReply {...props} animate={false} />);
    expect(complete).toContain("👨‍👩‍👧‍👦 합성 공개 답변");
    expect(complete).not.toContain("답변 전체 바로 보기");
    const showAll = () => {};
    expect(
      action(
        elements(ProgressiveReplyView({ text: "공개 일부", typing: true, showAll })),
        "답변 전체 바로 보기",
      ).props.onClick,
    ).toBe(showAll);
  });

  test("the inline panel keeps the stable heading, explicit close and real key handler association", () => {
    const heading = { current: null };
    const onClose = () => {};
    const onKeyDown = () => {};
    const nodes = elements(
      PanelView({
        id: "synthetic-panel",
        heading,
        title: "합성 작업",
        busy: true,
        onClose,
        children: <p>합성 읽기 내용</p>,
        onKeyDown,
      }),
    );
    const panel = nodes.find((node) => node.type === "section");
    const title = nodes.find((node) => node.type === "h3");
    const close = nodes.find((node) => node.type === Button);
    expect(panel?.props["aria-labelledby"]).toBe("synthetic-panel");
    expect(panel?.props.onKeyDown).toBe(onKeyDown);
    expect(String(panel?.props.className).split(" ")).toContain("conversation-panel");
    expect(title?.props.id).toBe("synthetic-panel");
    expect(title?.props.tabIndex).toBe(-1);
    expect(title?.props.ref).toBe(heading);
    expect(close?.props["aria-label"]).toBe("대화 작업 닫기");
    expect(close?.props.disabled).toBe(true);
    expect(close?.props.onClick).toBe(onClose);
  });
});

test("the pure view runtime graph cannot pull in authenticated APIs, transport, stores or polling", async () => {
  const project = resolve(import.meta.dir, "..");
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const relative = path.slice(project.length + 1);
    expect(relative).not.toMatch(
      /^src\/(?:client\/(?:api(?:\/|\.)|foreground-poll|confirm)|server\/)/,
    );
    expect(relative).not.toMatch(/^src\/product-ui\/(?:state|queries)\.ts$/);
    const source = ts.createSourceFile(
      path,
      await Bun.file(path).text(),
      ts.ScriptTarget.Latest,
      true,
      extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((item) => item.isTypeOnly))
        )
          continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const stem = resolve(dirname(path), specifier);
      const candidates = extname(stem)
        ? [stem]
        : [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
      const resolved = (
        await Promise.all(
          candidates.map(async (candidate) =>
            (await Bun.file(candidate).exists()) ? candidate : null,
          ),
        )
      ).find(Boolean);
      if (!resolved) throw new Error(`UNRESOLVED_PURE_VIEW_IMPORT:${relative}:${specifier}`);
      await visit(resolved);
    }
  }
  for (const name of [
    "AnalysisView",
    "PreparationView",
    "PanelView",
    "AgentView",
    "MessageView",
    "ProgressiveReplyView",
    "SourceCardsView",
  ])
    await visit(resolve(project, `src/product-ui/conversation-tools/${name}.tsx`));
  expect(seen.size).toBeGreaterThan(12);
});
