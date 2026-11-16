import { describe, expect, test } from "bun:test";
import { dirname, extname, resolve } from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { FileView, WorkspaceView as WorkspaceData } from "../src/client/api/types";
import { MediaPlayer } from "../src/components/ui/media-player";
import { Button } from "../src/product-ui/Button";
import { Dialog } from "../src/product-ui/Dialog";
import { SelectField } from "../src/product-ui/Select";
import type { WorkspaceComponents } from "../src/product-ui/workspace/slots";
import { TimelineEvidenceView } from "../src/product-ui/workspace/TimelineEvidenceView";
import type { WorkspaceController } from "../src/product-ui/workspace/useWorkspaceController";
import { WorkspaceInput, WorkspaceTextarea } from "../src/product-ui/workspace/WorkspaceControls";
import { workspaceFeedback } from "../src/product-ui/workspace/WorkspaceFeedback";
import { WorkspaceFileViewer } from "../src/product-ui/workspace/WorkspaceFileViewer";
import { workspaceHistory } from "../src/product-ui/workspace/WorkspaceHistory";
import { WorkspaceMaterials } from "../src/product-ui/workspace/WorkspaceMaterials";
import { WorkspaceDialogContents, WorkspaceView } from "../src/product-ui/workspace/WorkspaceView";

const file: FileView = {
  id: "synthetic-file",
  revision: 4,
  name: "합성 자료.txt",
  mimeType: "text/plain",
  sizeBytes: 123,
  status: "ready",
  coverage: "합성 전체 범위",
  extractedText: "",
};
const caseId = "synthetic-case";
function data(): WorkspaceData {
  return {
    case: {
      id: caseId,
      title: "합성 사건",
      subjectContext: "individual",
      stage: "active",
      revision: 8,
      updatedAt: "2026-11-16T00:00:00.000Z",
      summary: "합성 사용자 요약",
      schemaVersion: "2",
    },
    files: [file],
    messages: [],
    timeline: [],
    actions: [],
  };
}
const noRequest = async () => {
  throw new Error("SYNTHETIC_WORKSPACE_VIEW_MUST_NOT_REQUEST");
};
const noop = () => {};
const baseline: WorkspaceController = {
  caseId,
  tab: "chat",
  lookupAvailable: false,
  view: null,
  setContextRequested: noop,
  contextLoaded: false,
  progressiveIds: new Set(),
  incomingActionMessages: new Set(),
  conversationRequest: null,
  setConversationRequest: noop,
  setAgentBusy: noop,
  materialsOpen: false,
  setMaterialsOpen: noop,
  materialsRequest: 0,
  composerMenu: { current: null },
  composerTrigger: { current: null },
  conversationState: null,
  setConversationState: noop,
  openMaterials: noop,
  error: null,
  busy: "",
  draft: "",
  setDraft: noop,
  draftComposing: { current: false },
  messageTooLong: false,
  selected: [],
  setSelected: noop,
  localAttachments: [],
  setLocalAttachments: noop,
  chatAttachments: [],
  setChatAttachments: noop,
  queuedSend: false,
  setQueuedSend: noop,
  queuedUpload: { current: null },
  conversationRefresh: 0,
  setConversationRefresh: noop,
  notice: "",
  setNotice: noop,
  uploadReadbackPending: false,
  preview: null,
  deleteFile: null,
  setDeleteFile: noop,
  entry: null,
  setEntry: noop,
  original: null,
  uploadConsent: false,
  setUploadConsent: noop,
  uploadForConversation: { current: true },
  retryUploads: [],
  setRetryUploads: noop,
  acceptedFileRetries: [],
  uploadProgress: null,
  lookupOpen: false,
  setLookupOpen: noop,
  lookupAttempt: { current: null },
  uploadInput: { current: null },
  uploadChooserScope: { current: null },
  dialog: { current: null },
  reviewState: { dirty: false, busy: false },
  fileReviewBusyChanged: noop,
  fileReviewDirtyChanged: noop,
  followingChat: { current: true },
  pauseReplyFollowing: noop,
  chatMessages: { current: null },
  draftInput: { current: null },
  timelineRecovery: false,
  ready: false,
  canMutate: false,
  verify: async () => true,
  ticket: () => 1,
  current: () => true,
  readonly: true,
  privateContent: { style: { visibility: "hidden" }, inert: true, "aria-hidden": true },
  followReply: noop,
  finishReply: noop,
  fileReviewError: () => ({
    code: "UNAVAILABLE",
    message: "합성 오류",
    retryable: true,
    resource: true,
  }),
  load: noRequest,
  run: noRequest,
  refreshPreparation: noRequest,
  toggleAction: noRequest,
  saveConversationReport: noRequest,
  retryFile: noRequest,
  chooseAttachments: noop,
  openUploadChooser: noop,
  chooseConversationAttachments: noRequest,
  openConversationFile: noRequest,
  send: noRequest,
  sendLookup: noRequest,
  reflectMaterial: noRequest,
  upload: noRequest,
  startEntry: noRequest,
  closeDialog: noRequest,
  saveEntry: noRequest,
  base: `/cases/${caseId}`,
  readyFiles: [],
  evidenceIds: new Set(),
  pendingResponse: false,
  missingRequirements: [],
  loadHistory: noop,
  readOriginal: noop,
  downloadOriginal: noop,
  retryMessage: noop,
  deleteSelectedFile: noop,
  changeTimelinePrecision: noop,
  conversationClient: {
    createCase: noRequest,
    getContext: noRequest,
    updateContext: noRequest,
    getReconciliation: noRequest,
    requestReconciliation: noRequest,
    confirmReconciliation: noRequest,
    cancelReconciliation: noRequest,
    getConversation: noRequest,
    getConversationProgress: noRequest,
    executeAction: noRequest,
    getResolution: noRequest,
    updateResolution: noRequest,
    prepareDraft: noRequest,
    peekReport: noRequest,
  },
};
function controller(overrides: Partial<WorkspaceController> = {}): WorkspaceController {
  return {
    ...baseline,
    view: data(),
    ready: true,
    canMutate: true,
    readonly: false,
    privateContent: { style: { visibility: undefined }, inert: false, "aria-hidden": false },
    ...overrides,
  };
}
const components: WorkspaceComponents = {
  CaseDetail: () => <p>합성 v1 읽기 slot</p>,
  ConversationAgent: () => <p>합성 대화 작업 slot</p>,
  ConversationReconfirmation: () => <p>합성 재확인 slot</p>,
  FollowUpResolution: () => <p>합성 후속 해결 slot</p>,
  CaseContextPanel: () => <p>합성 자료 패널 slot</p>,
  EvidencePicker: () => <p>합성 증거 선택기 slot</p>,
  FileReview: () => <p>합성 관찰 검토 slot</p>,
  LookupDialog: () => <p>합성 외부 조회 slot</p>,
};
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  const result: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(value, (node) => {
    if (isValidElement<Record<string, unknown>>(node)) {
      result.push(node, ...nodes(node.props.children as ReactNode));
    }
  });
  return result;
}
function text(value: ReactNode): string {
  return Children.toArray(value)
    .map((node) =>
      isValidElement<{ children: ReactNode }>(node) ? text(node.props.children) : String(node),
    )
    .join("");
}
function action(value: ReactNode, label: string) {
  const result = nodes(value).find(
    (node) => node.type === Button && text(node.props.children as ReactNode).trim() === label,
  );
  if (!result) throw new Error(`MISSING_WORKSPACE_ACTION:${label}`);
  return result;
}
const tree = (overrides: Partial<WorkspaceController> = {}) =>
  WorkspaceView({ controller: controller(overrides), components });
const render = (overrides: Partial<WorkspaceController> = {}) =>
  renderToStaticMarkup(tree(overrides));
const dialogContents = (overrides: Partial<WorkspaceController> = {}) =>
  WorkspaceDialogContents({
    controller: controller(overrides),
    fileViewer: <p>합성 파일 확인 slot</p>,
  });
const fileViewer = (overrides: Partial<WorkspaceController> = {}) =>
  WorkspaceFileViewer({ controller: controller({ preview: file, ...overrides }), components });

describe("workspace host, read scope and recovery", () => {
  test("an unresolved workspace renders no private chat, child admission or legacy conversion", () => {
    const html = render({ view: null, ready: false, canMutate: false, readonly: true });
    expect(html).toContain("사건과 저장된 자료를 불러오고 있어요.");
    expect(html).not.toContain("합성 대화 작업 slot");
    expect(html).not.toContain("합성 사용자 요약");
    expect(html).not.toContain("합성 v1 읽기 slot");
  });
  test("v1 stays a mounted read surface during transient verification and never enters v2 child actions", () => {
    const view = data();
    view.case.schemaVersion = "1";
    const html = render({ view, ready: false });
    expect(html).toContain("계정을 확인하고 있어요.");
    expect(html).toContain('hidden="" inert=""');
    expect(html).toContain("합성 v1 읽기 slot");
    expect(html).not.toContain("합성 대화 작업 slot");
    expect(html).not.toContain("합성 외부 조회 slot");
  });
  test("the original upload chooser and named keyboard-scrollable log keep native IDs and refs", () => {
    const c = controller();
    const entries = nodes(WorkspaceView({ controller: c, components }));
    const chooser = entries.find((node) => node.props.id === "workspace-upload");
    const log = entries.find((node) => node.props.role === "log");
    expect(chooser?.type).toBe(WorkspaceInput);
    expect(chooser?.props.ref).toBe(c.uploadInput);
    expect(chooser?.props.type).toBe("file");
    expect(chooser?.props.hidden).toBe(true);
    expect(chooser?.props.multiple).toBe(true);
    expect(log?.props.ref).toBe(c.chatMessages);
    expect(log?.props.tabIndex).toBe(0);
    expect(log?.props["aria-label"]).toBe("사건 대화");
    expect(String(log?.props.className).split(" ")).toContain("workspace-messages");
    expect(typeof log?.props.onScroll).toBe("function");
  });
  test("a missing preview remains a null viewer prop rather than mounting an empty pane", () => {
    const entries = nodes(tree({ preview: null }));
    const frame = entries.find((node) => node.props.kind === "conversation");
    const panel = frame?.props.panel as ReactElement<Record<string, unknown>>;
    expect(panel.props.viewer).toBeNull();
    expect(panel.props.viewingFileId).toBeUndefined();
  });
  test("message requests preserve published text, pending status and failed-response recovery", () => {
    const view = data();
    view.messages = [
      {
        id: "user-message",
        role: "user",
        text: "합성 추가 진술",
        status: "complete",
        createdAt: "2026-11-16T00:00:00.000Z",
      },
      {
        id: "pending-message",
        role: "assistant",
        text: "",
        status: "pending",
        createdAt: "2026-11-16T00:00:00.000Z",
      },
      {
        id: "failed-message",
        role: "assistant",
        text: "합성 실패 응답",
        status: "failed",
        retryable: true,
        createdAt: "2026-11-16T00:00:00.000Z",
      },
    ];
    const html = render({ view, pendingResponse: true });
    expect(html).toContain("합성 추가 진술");
    expect(html).toContain("응답 준비 중");
    expect(html).toContain("저장된 대화는 유지돼요");
    expect(html).toContain("응답 다시 시도");
    expect(
      action(tree({ view, busy: "pending", pendingResponse: true }), "응답 다시 시도").props
        .disabled,
    ).toBe(true);
  });
  test("uncertain upload ACKs and accepted retry receipts direct readback instead of a duplicate request", () => {
    const { errorFeedback } = workspaceFeedback({
      controller: controller({
        uploadReadbackPending: true,
        error: {
          code: "UNAVAILABLE",
          message: "합성 응답 확인 실패",
          retryable: true,
          resource: false,
        },
      }),
      components,
    });
    expect(renderToStaticMarkup(errorFeedback)).toContain(
      "이미 접수된 자료는 다시 업로드하지 않아도 돼요.",
    );
    const accepted = workspaceFeedback({
      controller: controller({
        acceptedFileRetries: [file.id],
        error: {
          code: "UNAVAILABLE",
          message: "합성 응답 확인 실패",
          retryable: true,
          resource: false,
        },
      }),
      components,
    });
    expect(renderToStaticMarkup(accepted.errorFeedback)).toContain(
      "자료 처리 요청은 이미 접수됐어요.",
    );
    const recovery = workspaceFeedback({
      controller: controller({
        retryUploads: [new File(["synthetic"], "합성.txt")],
        tab: "chat",
        uploadConsent: false,
      }),
      components,
    });
    expect(action(recovery.uploadRecovery, "업로드 다시 시도").props.disabled).toBe(true);
  });
  test("history remains a per-collection explicit action and forwards the exact collection", () => {
    const calls: string[] = [];
    const view = data();
    view.pagination = { messages: true, timeline: false, actions: false };
    const history = workspaceHistory(
      controller({
        view,
        loadHistory: (collection) => {
          calls.push(collection);
        },
      }),
    );
    expect(history("timeline", "일정 더보기")).toBeNull();
    const button = action(history("messages", "이전 대화"), "이전 대화");
    (button.props.onClick as () => void)();
    expect(calls).toEqual(["messages"]);
  });
});

describe("private file viewer and material composition", () => {
  test("the current file review receives the same identity, edit authority, revision and callbacks", () => {
    const c = controller({ preview: file });
    const review = nodes(WorkspaceFileViewer({ controller: c, components })).find(
      (node) => node.type === components.FileReview,
    );
    expect(review?.key).toBe(file.id);
    expect(review?.props.caseId).toBe(caseId);
    expect(review?.props.fileId).toBe(file.id);
    expect(review?.props.canEdit).toBe(true);
    expect(review?.props.onChanged).toBe(c.load);
    expect(review?.props.onDirtyChange).toBe(c.fileReviewDirtyChanged);
    expect(review?.props.onBusyChange).toBe(c.fileReviewBusyChanged);
    expect(review?.props.refreshVersion).toBe("8:ready");
    expect(
      nodes(fileViewer({ readonly: true })).find((node) => node.type === components.FileReview)
        ?.props.canEdit,
    ).toBe(false);
  });
  test("file reflection remains blocked by busy, readonly, dirty review and review work", () => {
    for (const state of [
      { busy: "reading" },
      { readonly: true },
      { reviewState: { dirty: true, busy: false } },
      { reviewState: { dirty: false, busy: true } },
    ])
      expect(action(fileViewer(state), "자료 내용 반영하기").props.disabled).toBe(true);
    const hidden = nodes(fileViewer({ ready: false }))[0];
    expect(hidden?.props.hidden).toBe(true);
    expect(hidden?.props.inert).toBe(true);
  });
  test("original viewing stays explicit and actual audio/video playback keeps the preserved primitive", () => {
    let reads = 0;
    const image = fileViewer({
      original: { url: "data:image/png;base64,c3ludGhldGlj", type: "image/png" },
      readOriginal: () => {
        reads++;
      },
    });
    expect(reads).toBe(0);
    (action(image, "원본 확인 · 다운로드").props.onClick as () => void)();
    expect(reads).toBe(1);
    const img = nodes(image).find((node) => node.type === "img");
    expect(img?.props.alt).toBe(`${file.name} 원본 미리보기`);
    for (const kind of ["audio", "video"] as const) {
      const media = nodes(
        fileViewer({
          original: { url: `data:${kind}/mp4;base64,c3ludGhldGlj`, type: `${kind}/mp4` },
          ready: false,
        }),
      ).find((node) => node.type === MediaPlayer);
      expect(media?.props.kind).toBe(kind);
      expect(media?.props.enabled).toBe(false);
    }
    expect(
      action(fileViewer({ preview: { ...file, status: "uploading" } }), "원본 확인 · 다운로드")
        .props.disabled,
    ).toBe(true);
  });
  test("material upload keeps private gating, actual picker scope and dirty/busy consent controls", () => {
    const c = controller({
      ready: false,
      readonly: true,
      privateContent: { style: { visibility: "hidden" }, inert: true, "aria-hidden": true },
    });
    const tree = WorkspaceMaterials({ controller: c, components });
    const picker = nodes(tree).find((node) => node.type === components.EvidencePicker);
    expect(picker?.props.scopeKey).toBe(`${caseId}:${c.ticket()}`);
    expect(picker?.props.disabled).toBe(true);
    const privateSection = nodes(tree).find(
      (node) => node.props["data-product-workspace-material-upload"] === "",
    );
    expect(privateSection?.props.inert).toBe(true);
    expect(privateSection?.props["aria-hidden"]).toBe(true);
    expect(privateSection?.props.style).toEqual({ visibility: "hidden" });
  });
});

describe("native timeline and destructive-action guards", () => {
  test("the same actual DialogPanel ref and title ID are used while preserving the mounted modal", () => {
    const c = controller({ entry: { title: "합성 일정", expectedRevision: 8 }, busy: "timeline" });
    const modal = nodes(WorkspaceView({ controller: c, components })).find(
      (node) => node.type === Dialog,
    );
    expect(modal?.props.panelRef).toBe(c.dialog);
    expect(modal?.props.titleId).toBe("workspace-dialog-title");
    expect(modal?.props.preserveMounted).toBe(true);
    expect(modal?.props.showCloseButton).toBe(false);
    expect(modal?.props.title).toBe("타임라인 추가");
    const close = nodes(modal?.props.headerActions as ReactNode).find(
      (node) => node.type === Button,
    );
    expect(close?.props.disabled).toBe(true);
    expect(close?.props["aria-label"]).toBe("닫기");
    expect(close?.props.onClick).toBe(c.closeDialog);
  });
  test("timeline recovery freezes acknowledged fields but preserves the retry submit and draft", () => {
    const contents = dialogContents({
      entry: {
        date: "2026-11-01",
        datePrecision: "day",
        title: "합성 일정",
        detail: "보존한 수정",
        expectedRevision: 8,
      },
      timelineRecovery: true,
    });
    const fields = nodes(contents).filter(
      (node) => node.type === WorkspaceInput || node.type === WorkspaceTextarea,
    );
    expect(fields.map((node) => node.props.id)).toEqual([
      "timeline-date",
      "timeline-title",
      "timeline-detail",
    ]);
    expect(fields.every((node) => node.props.disabled)).toBe(true);
    expect(fields.find((node) => node.props.name === "title")?.props.value).toBe("합성 일정");
    expect(fields.find((node) => node.props.name === "detail")?.props.value).toBe("보존한 수정");
    expect(action(contents, "타임라인 저장").props.disabled).toBe(false);
  });
  test("precision selections pass actual strings; year/month/unknown inputs retain their native types and bounds", () => {
    const values: string[] = [];
    const common = { expectedRevision: 8, title: "합성 일정", detail: "" };
    for (const precision of ["year", "month", "unknown"] as const) {
      const contents = dialogContents({
        entry: { ...common, datePrecision: precision, date: "2026-11-03" },
        changeTimelinePrecision: (value) => values.push(value),
      });
      const select = nodes(contents).find((node) => node.type === SelectField);
      (select?.props.onValueChange as (value: string) => void)?.(precision);
      const input = nodes(contents).find((node) => node.props.id === "timeline-date");
      expect(input?.props.type).toBe(
        precision === "year" ? "text" : precision === "month" ? "month" : "date",
      );
      expect(input?.props.disabled).toBe(precision === "unknown");
      if (precision === "year") {
        expect(input?.props.pattern).toBe("[0-9]{4}");
        expect(input?.props.value).toBe("2026");
      }
      if (precision === "month") expect(input?.props.value).toBe("2026-11");
    }
    expect(values).toEqual(["year", "month", "unknown"]);
    expect(
      action(dialogContents({ entry: { ...common, title: "가".repeat(2001) } }), "타임라인 저장")
        .props.disabled,
    ).toBe(true);
  });
  test("delete requires current access and a nonarchived case while retaining the full irreversible scope notice", () => {
    const view = data();
    view.case.stage = "archived";
    expect(
      action(dialogContents({ view, deleteFile: file }), "자료 삭제 확인").props.disabled,
    ).toBe(true);
    const html = renderToStaticMarkup(dialogContents({ deleteFile: file }));
    expect(html).toContain("서버의 PDF·ZIP 내보내기도 함께 삭제되며 되돌릴 수");
    expect(html).toContain("이미 저장된 대화 내용과 다운로드한");
    expect(renderToStaticMarkup(dialogContents({ deleteFile: file, ready: false }))).not.toContain(
      "자료 삭제 확인",
    );
  });
  test("timeline source labels never promote stale or conflicting evidence to a confirmed event", () => {
    const reference = {
      kind: "user_material" as const,
      fileId: file.id,
      fileRevision: 4,
      position: { kind: "image" as const, region: null },
    };
    const entry = {
      id: "event",
      date: "",
      title: "합성 일정",
      detail: "",
      certainty: "observed" as const,
      references: [reference],
    };
    const stale = renderToStaticMarkup(
      <TimelineEvidenceView
        entry={entry}
        files={[{ ...file, revision: 5 }]}
        base="/cases/synthetic"
      />,
    );
    expect(stale).toContain("근거 재확인");
    expect(stale).not.toContain("자료에서 확인");
    const conflict = renderToStaticMarkup(
      <TimelineEvidenceView
        entry={{ ...entry, certainty: "conflicting" }}
        files={[file]}
        base="/cases/synthetic"
      />,
    );
    expect(conflict).toContain("내용 상충");
    expect(conflict).toContain("자료 연결");
    expect(conflict).toContain(`/cases/synthetic/files?file=${file.id}`);
  });
});

test("workspace pure views cannot import authenticated APIs, private child controllers or the v1 fetch entry", async () => {
  const root = resolve(import.meta.dir, "..");
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const relative = path.slice(root.length + 1);
    expect(relative).not.toMatch(/^src\/(?:server\/|client\/api(?:\.ts|\/(?!errors\.ts)))/);
    expect(relative).not.toMatch(
      /(?:useWorkspaceController|CaseDetail|useCustomerAccess)\.(?:ts|tsx)$/,
    );
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
        const c = statement.importClause;
        if (
          c?.isTypeOnly ||
          (c &&
            !c.name &&
            c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.every((part) => part.isTypeOnly))
        )
          continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const stem = resolve(dirname(path), specifier);
      const candidates = extname(stem)
        ? [stem]
        : [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
      const found = (
        await Promise.all(
          candidates.map(async (candidate) =>
            (await Bun.file(candidate).exists()) ? candidate : null,
          ),
        )
      ).find(Boolean);
      if (!found) throw new Error(`UNRESOLVED_WORKSPACE_VIEW_IMPORT:${relative}:${specifier}`);
      await visit(found);
    }
  }
  for (const name of [
    "WorkspaceView",
    "WorkspaceContext",
    "WorkspaceFeedback",
    "WorkspaceFileViewer",
    "WorkspaceMaterials",
    "WorkspaceHistory",
    "WorkspacePanes",
    "TimelineEvidenceView",
  ])
    await visit(resolve(root, `src/product-ui/workspace/${name}.tsx`));
  expect(seen.size).toBeGreaterThan(12);
});
