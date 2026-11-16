import { describe, expect, test } from "bun:test";
import { dirname, extname, resolve } from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { FileView } from "../src/client/api/types";
import type { V2EvidenceRequirement } from "../src/contracts/v2";
import { Button, ButtonLink } from "../src/product-ui/Button";
import { CaseMaterialsView } from "../src/product-ui/evidence/CaseMaterialsView";
import { ChatAttachmentsView } from "../src/product-ui/evidence/ChatAttachmentsView";
import { EvidencePickerView } from "../src/product-ui/evidence/EvidencePickerView";
import { EvidenceRequirementsView } from "../src/product-ui/evidence/EvidenceRequirementsView";
import { EvidenceUploadView } from "../src/product-ui/evidence/EvidenceUploadView";
import type { ChatAttachmentsController } from "../src/product-ui/evidence/useChatAttachmentsController";
import type { EvidencePickerController } from "../src/product-ui/evidence/useEvidencePickerController";
import type { EvidenceUploadController } from "../src/product-ui/evidence/useEvidenceUploadController";

const local = new File(["synthetic evidence"], "합성 자료.txt", { type: "text/plain" });
const file: FileView = {
  id: "synthetic-file",
  revision: 2,
  name: "합성 자료.txt",
  mimeType: "text/plain",
  sizeBytes: 18,
  status: "ready",
  coverage: "",
  extractedText: "",
};
const requirement: V2EvidenceRequirement = {
  id: "synthetic-requirement",
  kind: "contract",
  label: "계약 내용 자료",
  reason: "합의 내용을 확인해 주세요.",
  fileIds: [],
};
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
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
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find(
    (node) => node.type === Button && text(node.props.children as ReactNode).trim() === label,
  );
  if (!found) throw new Error(`MISSING_EVIDENCE_ACTION:${label}`);
  return found;
}
function picker(overrides: Partial<EvidencePickerController> = {}): EvidencePickerController {
  return {
    fileInput: { current: null },
    cameraInput: { current: null },
    description: "synthetic-picker-description",
    disabled: false,
    photoOnly: false,
    compact: false,
    captureOnly: false,
    notice: "",
    open: () => {},
    select: async () => {},
    acceptedFiles: ".txt,.pdf,.jpg",
    ...overrides,
  };
}
function upload(overrides: Partial<EvidenceUploadController> = {}): EvidenceUploadController {
  return {
    caseId: "synthetic-case",
    disabled: false,
    photoOnly: false,
    facts: [],
    onReflect: async () => {},
    upload: {
      local: [local],
      uploaded: [],
      consent: true,
      setConsent: () => {},
      busy: false,
      selecting: false,
      error: null,
      notice: "",
      progress: null,
      writable: true,
      ready: true,
      scopeKey: "synthetic-case:1",
      select: async () => {},
      upload: async () => {},
      refresh: async () => {},
      report: () => {},
      verifyWrite: async () => true,
      remove: () => {},
    },
    reviewFile: undefined,
    reviewDirty: false,
    busy: false,
    reflectionNotice: "",
    setReviewId: () => {},
    setReflectionNotice: () => {},
    setReviewDirty: () => {},
    setReviewBusy: () => {},
    changed: async () => {},
    reflect: async () => {},
    reflectBusy: false,
    ...overrides,
  };
}
function uploadTree(controller = upload()) {
  return EvidenceUploadView({
    controller,
    picker: <p>합성 실제 선택기 slot</p>,
    attachments: <p>합성 첨부 slot</p>,
    review: <p>합성 실제 검토 slot</p>,
  });
}
function attachments(
  overrides: Partial<ChatAttachmentsController> = {},
): ChatAttachmentsController {
  return {
    local: [],
    uploaded: [],
    disabled: false,
    removeLocal: () => {},
    removeUploaded: () => {},
    label: "이번 메시지의 첨부 파일",
    localKey: () => 1,
    ...overrides,
  };
}

describe("native evidence picker contracts", () => {
  test("both native choosers retain their own stable refs, labels, accept and camera capture semantics", () => {
    const c = picker({ disabled: true });
    const inputs = nodes(EvidencePickerView({ controller: c })).filter(
      (node) => node.type === "input",
    );
    expect(inputs).toHaveLength(2);
    expect(
      inputs.map((node) => [
        node.props.ref,
        node.props.type,
        node.props.hidden,
        node.props.disabled,
      ]),
    ).toEqual([
      [c.fileInput, "file", true, true],
      [c.cameraInput, "file", true, true],
    ]);
    expect(inputs[0]?.props.multiple).toBe(true);
    expect(inputs[0]?.props.accept).toBe(c.acceptedFiles);
    expect(inputs[0]?.props["aria-label"]).toBe("추가할 증거 파일 선택");
    expect(inputs[1]?.props.capture).toBe("environment");
    expect(inputs[1]?.props.accept).toBe("image/*");
    expect(inputs[1]?.props["aria-label"]).toBe("촬영한 사진 선택");
    expect(inputs.every((node) => typeof node.props.onChange === "function")).toBe(true);
    expect(button(EvidencePickerView({ controller: c }), "파일 선택").props.disabled).toBe(true);
  });

  test("capture-only and photo-only presentations keep both chooser nodes mounted and open only the explicit target", () => {
    const calls: boolean[] = [];
    const c = picker({
      photoOnly: true,
      captureOnly: true,
      compact: true,
      open: (camera) => calls.push(camera),
    });
    const tree = EvidencePickerView({ controller: c });
    expect(nodes(tree).filter((node) => node.type === "input")).toHaveLength(2);
    expect(
      nodes(tree)
        .filter((node) => node.type === "input")
        .every((node) => node.props.accept === "image/*"),
    ).toBe(true);
    expect(renderToStaticMarkup(tree)).not.toContain("파일 선택</button>");
    (button(tree, "촬영해서 추가").props.onClick as () => void)();
    const general = EvidencePickerView({
      controller: picker({ open: (camera) => calls.push(camera) }),
    });
    (button(general, "파일 선택").props.onClick as () => void)();
    expect(calls).toEqual([true, false]);
    expect(button(tree, "촬영해서 추가").props["aria-describedby"]).toBe(c.description);
    expect(renderToStaticMarkup(tree)).toContain(`id="${c.description}"`);
  });

  test("capture cancellation is a status, with the ordinary file fallback described", () => {
    const html = renderToStaticMarkup(
      <EvidencePickerView
        controller={picker({ notice: "선택을 취소했어요. 파일 선택으로도 추가할 수 있어요." })}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("선택을 취소했어요.");
    expect(html).toContain("촬영이 지원되지 않거나 권한을 거절했다면");
  });
});

describe("upload admission and honest processing state", () => {
  test("local files, automatic-processing consent, writable authority and busy state all gate upload", () => {
    expect(button(uploadTree(), "새 증거 업로드").props.disabled).toBe(false);
    for (const state of [{ busy: true }, { consent: false }, { writable: false }, { local: [] }]) {
      const c = upload();
      const tree = uploadTree(
        "busy" in state ? { ...c, busy: true } : { ...c, upload: { ...c.upload, ...state } },
      );
      expect(button(tree, "새 증거 업로드").props.disabled).toBe(true);
    }
    const checkbox = nodes(uploadTree()).find((node) => node.type === "input");
    expect(checkbox?.props.type).toBe("checkbox");
    expect(checkbox?.props.checked).toBe(true);
    expect(checkbox?.props.disabled).toBe(false);
    expect(renderToStaticMarkup(uploadTree())).toContain("추가한 자료의 자동 처리에 동의합니다.");
    expect(
      nodes(uploadTree(upload({ upload: { ...upload().upload, local: [] } }))).some(
        (node) => node.type === "input",
      ),
    ).toBe(false);
  });

  test("upload invokes the actual owning callback and composes the real child slots", () => {
    let called = 0;
    const c = upload();
    c.upload.upload = async () => {
      called++;
    };
    const tree = uploadTree(c);
    (button(tree, "새 증거 업로드").props.onClick as () => void)();
    expect(called).toBe(1);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("합성 실제 선택기 slot");
    expect(html).toContain("합성 첨부 slot");
    expect(html).not.toContain("합성 실제 검토 slot");
    expect(html).not.toContain("업로드 완료");
  });

  test("permission notices appear only for the original consent condition, not a temporary busy or dirty lock", () => {
    const c = upload();
    c.upload.writable = false;
    expect(renderToStaticMarkup(uploadTree(c))).toContain("최신 동의 확인");
    for (const state of [{ disabled: true }, { busy: true }, { reviewDirty: true }])
      expect(renderToStaticMarkup(uploadTree({ ...c, ...state }))).not.toContain("최신 동의 확인");
  });

  test("ACK checking, selection and errors remain pending states and never invent successful analysis", () => {
    const c = upload();
    c.upload.selecting = true;
    c.upload.progress = {
      name: "합성 전송.txt",
      value: { stage: "confirming", completedBytes: 18, totalBytes: 18 },
    };
    c.upload.error = new Error("synthetic raw transport detail");
    const html = renderToStaticMarkup(uploadTree(c));
    expect(html).toContain("선택한 자료를 확인하고 있어요.");
    expect(html).toContain("합성 전송.txt");
    expect(html).toContain("접수 결과 확인 중");
    expect(html).toContain("요청을 완료하지 못했어요. 입력은 그대로 남아 있어요.");
    expect(html).not.toContain("synthetic raw transport detail");
    expect(html).not.toContain("분석 완료");
    expect(html).toContain("다시 시도");
  });

  test("every retained file keeps its actual processing, rejection or review state and encoded recovery route", () => {
    const c = upload({ caseId: "case/slash" });
    c.upload.uploaded = [
      { ...file, id: "transfer", status: "uploading" },
      { ...file, id: "pending", status: "waiting" },
      { ...file, id: "analysis", status: "processing" },
      { ...file, id: "failed/slash", status: "failed" },
      { ...file, id: "rejected", status: "uploading", uploadRejection: "FILE_REJECTED" },
      file,
    ];
    const html = renderToStaticMarkup(uploadTree(c));
    for (const label of [
      "업로드 중",
      "처리 대기",
      "분석 중",
      "처리 실패 · 확인 필요",
      "등록 거절",
      "내용 확인 후 반영 가능",
    ])
      expect(html).toContain(label);
    expect(html).toContain("기존 업로드를 이어서 확인해요.");
    expect(html).toContain("암호·보호를 해제하거나");
    expect(html).toContain("/cases/case%2Fslash/files?file=failed%2Fslash");
    expect(html).not.toContain("사실에 연결된 자료");
    expect(c.upload.uploaded).toHaveLength(6);
  });

  test("review and reflect use the existing file identity and keep independent dirty/busy/readiness fences", () => {
    const calls: unknown[] = [];
    const c = upload({
      reviewFile: file,
      setReviewId: (id) => calls.push(id),
      setReflectionNotice: (notice) => calls.push(notice),
      reflect: async (id) => {
        calls.push(id);
      },
    });
    c.upload.uploaded = [file];
    const tree = uploadTree(c);
    (button(tree, "관찰 검토").props.onClick as () => void)();
    (button(tree, "자료 내용 반영하기").props.onClick as () => void)();
    expect(calls).toEqual([file.id, "", file.id]);
    expect(renderToStaticMarkup(tree)).toContain("합성 실제 검토 slot");
    for (const state of [
      { busy: true },
      { reviewDirty: true },
      { reviewFile: { ...file, status: "processing" as const } },
    ])
      expect(button(uploadTree({ ...c, ...state }), "자료 내용 반영하기").props.disabled).toBe(
        true,
      );
    expect(
      button(uploadTree({ ...c, upload: { ...c.upload, writable: false } }), "자료 내용 반영하기")
        .props.disabled,
    ).toBe(true);
    const route = renderToStaticMarkup(uploadTree({ ...c, onReflect: undefined }));
    expect(route).toContain("대화에서 자료 내용 반영하기");
    expect(route).toContain('href="/cases/synthetic-case"');
  });
});

describe("attachments, requirements and the case's material list", () => {
  test("removal preserves the exact local File and uploaded ID; readiness never claims reviewed content", () => {
    const removed: unknown[] = [];
    const c = attachments({
      local: [local],
      uploaded: [file],
      removeLocal: (value) => removed.push(value),
      removeUploaded: (value) => removed.push(value),
    });
    const tree = ChatAttachmentsView({ controller: c });
    for (const action of nodes(tree).filter((node) => node.type === Button))
      (action.props.onClick as () => void)();
    expect(removed).toEqual([local, file.id]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("전송 전");
    expect(html).toContain("대화에 함께 보낼 준비 완료 · 내용 검토 필요");
    expect(html).not.toContain("분석 완료");
    expect(ChatAttachmentsView({ controller: attachments() })).toBeNull();
    expect(
      nodes(ChatAttachmentsView({ controller: { ...c, disabled: true } }))
        .filter((node) => node.type === Button)
        .every((node) => node.props.disabled),
    ).toBe(true);
  });

  test("a pending associated requirement cannot request the same evidence; failure keeps explicit replacement", () => {
    const add: V2EvidenceRequirement[] = [];
    const props = {
      requirements: [requirement],
      files: [] as FileView[],
      disabled: false,
      onAdd: (value: V2EvidenceRequirement) => add.push(value),
    };
    const missing = EvidenceRequirementsView(props);
    (button(missing, "자료 추가").props.onClick as () => void)();
    expect(add).toEqual([requirement]);
    const pending = EvidenceRequirementsView({
      ...props,
      files: [{ ...file, status: "uploading" }],
      pendingFileIdsByRequirement: { [requirement.id]: [file.id] },
    });
    expect(nodes(pending).some((node) => node.type === Button)).toBe(false);
    const failed = EvidenceRequirementsView({
      ...props,
      requirements: [{ ...requirement, fileIds: [file.id] }],
      files: [{ ...file, status: "failed" }],
      disabled: true,
    });
    expect(button(failed, "수정한 자료 선택").props.disabled).toBe(true);
    expect(renderToStaticMarkup(pending)).toContain("업로드 중");
  });

  test("only ready associated files expose review; empty lists stay empty and real fallback links retain encoded IDs", () => {
    const reviewed: string[] = [];
    const tree = EvidenceRequirementsView({
      requirements: [{ ...requirement, fileIds: [file.id] }],
      files: [file],
      onAdd: () => {},
      onReview: (id) => reviewed.push(id),
    });
    (button(tree, "내용 확인").props.onClick as () => void)();
    expect(reviewed).toEqual([file.id]);
    expect(EvidenceRequirementsView({ requirements: [], files: [], onAdd: () => {} })).toBeNull();
    expect(CaseMaterialsView({ caseId: "synthetic", files: [] })).toBeNull();
    const list = CaseMaterialsView({
      caseId: "case/slash",
      files: [{ ...file, id: "file/slash", status: "processing" }],
    });
    expect(
      nodes(list)
        .filter((node) => node.type === ButtonLink)
        .map((node) => node.props.href),
    ).toEqual(["/cases/case%2Fslash/files?file=file%2Fslash"]);
    expect(renderToStaticMarkup(list)).toContain("분석 중");
    expect(renderToStaticMarkup(list)).toContain("사건 정리 재확인");
  });

  test("file names and status text stay escaped with no executable inline attributes", () => {
    const name = '<img src=x onerror="synthetic()">';
    const html = renderToStaticMarkup(
      <ChatAttachmentsView controller={attachments({ uploaded: [{ ...file, name }] })} />,
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    const tags = (html.match(/<[^>]+>/g) ?? []).map((tag) => tag.replace(/"[^"]*"|'[^']*'/g, '""'));
    expect(tags.some((tag) => /\son[a-z]+\s*=/i.test(tag))).toBe(false);
    expect(tags.some((tag) => /\sstyle\s*=/i.test(tag))).toBe(false);
  });
});

test("evidence pure views cannot import authenticated transport or upload controllers at runtime", async () => {
  const project = resolve(import.meta.dir, "..");
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const relative = path.slice(project.length + 1);
    expect(relative).not.toMatch(
      /^src\/(?:server\/|client\/(?:api(?:\.ts|\/(?!errors\.ts))|foreground-poll|confirm))/,
    );
    expect(relative).not.toMatch(
      /(?:useEvidenceUpload|useEvidencePicker|useChatAttachments)Controller\.ts$/,
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
      if (!resolved) throw new Error(`UNRESOLVED_EVIDENCE_VIEW_IMPORT:${relative}:${specifier}`);
      await visit(resolved);
    }
  }
  for (const name of [
    "EvidenceUploadView",
    "EvidencePickerView",
    "ChatAttachmentsView",
    "EvidenceRequirementsView",
    "CaseMaterialsView",
  ])
    await visit(resolve(project, `src/product-ui/evidence/${name}.tsx`));
  expect(seen.size).toBeGreaterThan(8);
});
