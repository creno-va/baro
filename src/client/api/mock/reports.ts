import { createReportHtml } from "../../../components/reports/document";
import {
  createSyntheticPdf,
  createZip,
  maskReportText,
} from "../../../components/reports/download";
import type { V2CaseContext, V2FileObservation, V2Summary } from "../../../contracts/v2";
import type { DomainRequest, DomainRequestInit } from "../reports";
import { reportSaveSchema } from "../reports";
import type {
  ReportView as BaseReportView,
  CaseView,
  FileView,
  SessionView,
  WorkspaceView,
} from "../types";
import { mockOriginalStore } from "./files";

type ReportView = BaseReportView & {
  pdfAvailable?: boolean | undefined;
  basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string } | undefined;
};
type ReportCase = CaseView & { summaryDetails?: V2Summary | undefined };
export type ReportMockState = {
  session: SessionView;
  cases: Record<string, ReportCase>;
  caseOwners?: Record<string, string>;
  consents?: Record<string, unknown>;
  intake?: Record<string, unknown>;
  caseRequests?: Record<string, { ownerId: string; fingerprint: string; result: unknown }>;
  lawyers?: unknown;
  deletedAccountIds?: string[];
  workspace: Record<string, Partial<WorkspaceView>>;
  files: Record<string, FileView[]>;
  reports: Record<string, ReportView>;
  reportHistory?: Record<string, ReportView>;
  reportZips?: Record<
    string,
    { reportId: string; caseId: string; ownerId: string; fileIds: string[] }
  >;
  reportSources?: Record<string, number>;
  /** Private prepared-analysis identity, never part of the installed report DTO. */
  reworkReportBindings?: Record<string, string>;
  reworkEditedReports?: Record<string, true>;
  reworkContexts?: Record<string, V2CaseContext>;
  deletedCaseIds?: string[];
  reportRequests?: Record<string, { fingerprint: string; value: ReportView }>;
  workspaceReceipts?: Record<string, unknown>;
  fileProcessing?: Record<string, unknown>;
  fileReviews?: Record<string, { observations?: { value: V2FileObservation }[] }>;
  fileReviewReceipts?: Record<string, { signature: string; value: { fileId: string } }>;
  fileExtractions?: Record<string, string>;
  fileUploads?: Record<string, { caseId: string; ownerId: string }>;
  fileUploadReceipts?: Record<string, { fileId: string; fingerprint: string }>;
};
export type ReportMockRuntime = {
  read: () => ReportMockState;
  update: (action: (state: ReportMockState) => void) => void;
  original: (caseId: string, fileId: string) => Promise<Blob>;
};
export class ReportMockError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function requireMockSession(state: ReportMockState) {
  if (!state.session.user || state.deletedAccountIds?.includes(state.session.user.id))
    throw new ReportMockError("UNAUTHENTICATED", "로그인이 필요해요.");
}
export function requireMockAccount(state: ReportMockState) {
  requireMockSession(state);
  if (state.session.needsConsent)
    throw new ReportMockError("CONSENT_REQUIRED", "먼저 필수 동의를 확인해 주세요.");
}
export function requireMockCase(state: ReportMockState, id: string, consent = true) {
  if (consent) requireMockAccount(state);
  else requireMockSession(state);
  if (!["customer", "lawyer"].includes(state.session.user?.accountType ?? ""))
    throw new ReportMockError("ROLE_REQUIRED", "고객 역할로 로그인한 뒤 사건을 확인해 주세요.");
  const item = state.cases[id];
  if (
    !item ||
    state.deletedCaseIds?.includes(id) ||
    (state.caseOwners && state.caseOwners[id] !== state.session.user?.id)
  )
    throw new ReportMockError(
      "NOT_FOUND",
      "사건을 찾을 수 없어요. 삭제했거나 접근할 수 없는 사건이에요.",
    );
  return item;
}
function draft(
  state: ReportMockState,
  item: ReportCase,
  revision: number,
  excluded: string[] = [],
): ReportView {
  const files = (state.files[item.id] ?? []).filter((file) => !excluded.includes(file.id));
  const workspace = state.workspace[item.id];
  const context = state.reworkContexts?.[item.id];
  const generatedAt = new Date().toISOString();
  const facts = (item.summaryDetails?.facts ?? workspace?.facts ?? []).filter((fact) =>
    fact.references.every(
      (ref) => ref.kind !== "user_material" || files.some((file) => file.id === ref.fileId),
    ),
  );
  const summary = item.summaryDetails?.overview ?? item.summary;
  const overview =
    facts.find(
      (fact) =>
        fact.attribution === "user_statement" &&
        fact.references.some((reference) => reference.kind === "intake_narrative"),
    )?.text ?? summary;
  const parties = item.summaryDetails?.parties ?? workspace?.people ?? [];
  const observationText = (value: V2FileObservation) => {
    const p = value.position;
    const position =
      p.kind === "audio"
        ? `${p.startSeconds}–${p.endSeconds}초`
        : p.kind === "video"
          ? `${p.timestampSeconds}초 · 프레임 ${p.frameIndex}`
          : p.kind === "document"
            ? `${p.page}쪽${p.paragraph ? ` · ${p.paragraph}번째 문단` : ""}`
            : "이미지 관찰";
    return `${p.kind === "image" ? "" : `${position}\n`}${value.userEdited ? "직접 수정한 내용 (원문 대조 필요): " : value.certainty === "uncertain" ? "확인 필요: " : ""}${value.text}`;
  };
  const content = [
    "리포트 준비 상태",
    "합성 API 예시 · 실제 AI/공식 법률 조회를 실행하지 않았습니다. 사실 정리와 검증된 법률 분석은 구분해 주세요.",
    "",
    "내 사건 한눈에",
    excluded.length
      ? "자료를 제외한 리포트입니다. 남은 사실과 출처를 아래에서 확인하고 사건 개요를 직접 보완해 주세요."
      : overview || "아직 확인된 사건 요약이 없습니다. 내용을 직접 입력해 주세요.",
    "",
    "사건 입장과 절차",
    context
      ? `사용자가 정한 목적 · ${{ prepare_claim: "고소·청구 준비", respond_to_claim: "상대방 주장에 대응", unconfirmed: "목적 확인 필요" }[context.casePurpose]}`
      : "이 저장 기준에서 사건 목적 정보를 확인하지 못했습니다. 사건에서 정한 목적은 대화에서 확인해 주세요.",
    ...(context
      ? [
          `${{ civil: "민사", criminal: "형사", family: "가사", administrative: "행정", labor: "노동", other: "기타 분야", unconfirmed: "사건 분야 미확인" }[context.procedure.kind]} · ${{ before_filing: "신고·제소 전", investigation: "수사 중", first_instance: "1심", appeal: "항소", final_appeal: "상고", enforcement: "집행", other: "기타 단계", unconfirmed: "절차 단계 미확인" }[context.procedure.stage]}`,
          ...(context.procedure.description ? [context.procedure.description] : []),
        ]
      : []),
    "",
    "먼저 확인할 핵심 쟁점",
    "실제 법률 분석을 실행하지 않은 합성 예시입니다. 법적 요건 충족·법률 선택지·판례 비교를 확인한 것으로 볼 수 없습니다.",
    "",
    "다음 행동과 필요 자료",
    "저장 당시의 준비 항목입니다. 나열한 순서가 법적 필수 순서·기한을 뜻하지 않습니다. 현재 완료 상태는 대화 작업공간에서 확인해 주세요.",
    ...(workspace?.actions?.length
      ? workspace.actions.flatMap((action) => [
          `### ${action.title.replace(/[\r\n]/gu, " ")}`,
          `- 준비 내용 · ${action.detail}`,
          `- 저장 당시 상태 · ${action.done ? "완료로 표시" : "할 일"}`,
        ])
      : ["연결된 준비 행동이 없습니다. 아래 미확인 사항과 보유 자료를 확인해 주세요."]),
    "별도의 이유·준비물·완료 기준은 제공되지 않았습니다. 원본과 연결 근거를 대조하고 필요한 기준을 대화에서 추가로 확인해 주세요.",
    "",
    "선택지와 확인 조건",
    context?.casePurpose === "respond_to_claim"
      ? "직접 준비 · 상대방의 요구, 인정하는 사실과 다투는 사실, 각각의 자료를 구분해 정리할 수 있습니다."
      : context?.casePurpose === "prepare_claim"
        ? "직접 준비 · 원하는 해결과 청구 근거가 되는 사실, 부족한 자료를 구분해 정리할 수 있습니다."
        : "직접 준비 · 사건에서 정한 목적과 상대방의 요구를 대화에서 확인하고 사실·자료를 정리할 수 있습니다.",
    "공식 절차·제출처·기한·서식은 해당 사건의 공식 안내에서 확인해야 합니다. 이 합성 리포트가 확인한 것으로 표시하지 않습니다.",
    "전문가 검토 · 상반된 자료의 법적 의미나 청구·대응 범위의 판단이 필요할 때 선택할 수 있습니다. 확인할 질문과 원문을 함께 준비하세요.",
    "리포트 보관 · 현재 내용을 저장하고 필요한 자료를 더 확인할 수 있습니다. 추가 내용은 새 버전에서 반영합니다.",
    "",
    "당사자",
    ...(!excluded.length && parties.length
      ? []
      : ["이 범위에서 확인한 당사자·관계 정보가 없습니다. 추가 확인이 필요합니다."]),
    ...(excluded.length ? [] : (item.summaryDetails?.parties ?? workspace?.people ?? [])).map(
      (p) => `${p.label} · ${p.role}`,
    ),
    "",
    "주요 사실",
    ...(!excluded.length && summary && summary !== overview
      ? ["### 사용자가 확인한 전체 정리", summary]
      : []),
    ...(facts.length ? [] : ["구체적인 사실과 자료의 연결은 아직 확인하지 못했습니다."]),
    ...facts.map(
      (fact) =>
        `${fact.text} · ${fact.userEdited ? "사용자가 수정한 내용" : fact.attribution === "user_material" ? "자료에 적힌 내용" : fact.attribution === "official_source" ? "공식 출처" : fact.attribution === "ai_organization" ? "AI 정리" : "사용자 진술"} · ${{ reported: "진술됨", observed: "자료 내용 확인됨", uncertain: "미확인", conflicting: "상반됨" }[fact.certainty]}`,
    ),
    "",
    "미확인·상반되는 내용",
    ...(excluded.length
      ? ["종합 요약·당사자·미확인 사항은 제외 자료와의 연결을 구분할 수 없어 옮기지 않았습니다."]
      : (item.summaryDetails?.unknowns ?? workspace?.unknowns ?? [])),
    "상대방의 입장과 원본의 진정성은 확인되지 않았습니다. 날짜·금액·출처와 빠진 내용을 직접 확인하세요.",
    "",
    "타임라인",
    ...(workspace?.timeline?.length
      ? []
      : ["날짜와 사건 순서는 미확인입니다. 확인한 시점과 경위를 대화에서 보완해 주세요."]),
    ...(workspace?.timeline ?? []).map(
      (entry) => `${entry.date} · ${entry.title}: ${entry.detail}`,
    ),
    "",
    "증거 자료",
    ...(files.length
      ? []
      : ["포함된 자료가 없습니다. 자료가 없다는 것만으로 사실의 유무를 판단하지 않습니다."]),
    ...files.flatMap((file) => [
      `${file.name} · ${file.coverage || "처리 범위를 직접 확인하세요."}`,
      ...(state.fileReviews?.[file.id]?.observations
        ?.filter(({ value }) => value.included)
        .map(({ value }) => observationText(value)) ??
        (file.extractedText ? [file.extractedText] : [])),
    ]),
    "",
    "출처와 분석 기준",
    "합성 API 예시입니다. 실제 법 조항·판례와 공식 절차를 확인하지 않았습니다. 사용자 진술·자료 기재와 법률 판단을 구분해 주세요.",
  ].join("\n");
  if (content.length > 30000)
    throw new ReportMockError(
      "EXPORT_LIMIT_EXCEEDED",
      "리포트 본문이 너무 길어요. 자료를 제외한 뒤 다시 생성해 주세요.",
    );
  return {
    id: `report-${crypto.randomUUID()}`,
    caseId: item.id,
    revision,
    title: item.title,
    content,
    updatedAt: generatedAt,
    basis: {
      workspaceRevision: item.revision,
      summaryRevision: item.summaryDetails?.revision ?? item.revision,
      generatedAt,
    },
    stale: false,
    excludedFileIds: excluded,
    maskIdentifiers: false,
    includedPhotoIds: [],
    photoCandidates: files
      .filter(
        (file) =>
          /^(image\/jpeg|image\/png|image\/webp)$/.test(file.mimeType) &&
          file.sizeBytes <= 5_000_000,
      )
      .map((file) => ({ id: file.id, name: file.name, revision: file.revision ?? 1 })),
  };
}
const memoryArchives = new Map<string, Blob>();
async function archiveStore(key: string, value?: Blob) {
  if (typeof indexedDB !== "undefined") return mockOriginalStore(key, value);
  if (value) memoryArchives.set(key, value);
  return memoryArchives.get(key) ?? null;
}
export function createReportsMockHandler(runtime: ReportMockRuntime): DomainRequest {
  const handler: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    const state = runtime.read();
    requireMockSession(state);
    if (!["customer", "lawyer"].includes(state.session.user?.accountType ?? ""))
      throw new ReportMockError("ROLE_REQUIRED", "고객 역할로 로그인한 뒤 리포트를 확인해 주세요.");
    const reportPath = path.match(/^\/api\/v2\/cases\/([^/]+)\/reports$/);
    const exportPath = path.match(/^\/api\/v2\/reports\/([^/]+)\/(html|pdf|zip)$/);
    const method = init.method ?? "GET";
    const key = init.headers?.["idempotency-key"];
    const fingerprint = JSON.stringify([path, method, init.body]);
    if (method !== "GET") requireMockAccount(state);
    if (reportPath) requireMockCase(state, decodeURIComponent(reportPath[1] ?? ""), false);
    if (key && state.reportRequests?.[key]) {
      const prior = state.reportRequests[key];
      if (prior.fingerprint !== fingerprint)
        throw new ReportMockError("CONFLICT", "다른 요청에 사용된 작업 키예요.");
      return structuredClone(prior.value) as T;
    }
    if (reportPath) {
      const id = decodeURIComponent(reportPath[1] ?? "");
      requireMockCase(state, id, false);
      let value: ReportView;
      if (method === "GET") {
        if (!state.reports[id])
          runtime.update((current) => {
            const item = requireMockCase(current, id);
            const report = draft(current, item, 1);
            current.reports[id] = report;
            current.reportHistory ??= {};
            current.reportHistory[report.id] = structuredClone(report);
            current.reportSources ??= {};
            current.reportSources[report.id] = item.revision;
          });
        const current = runtime.read();
        value = structuredClone(current.reports[id] as ReportView);
        value.stale =
          (current.reportSources?.[value.id] ?? current.cases[id]?.revision) !==
          current.cases[id]?.revision;
      } else if (method === "PATCH" || method === "POST") {
        const body = init.body as { expectedRevision?: number; excludedFileIds?: string[] };
        runtime.update((current) => {
          const item = requireMockCase(current, id);
          const prior = current.reports[id];
          if (prior && body?.expectedRevision !== prior.revision)
            throw new ReportMockError(
              "CONFLICT",
              "다른 화면에서 리포트가 변경됐어요. 다시 확인한 뒤 저장해 주세요.",
            );
          if (method === "POST") {
            const exclusions = body.excludedFileIds ?? [];
            if (
              exclusions.length > 100 ||
              new Set(exclusions).size !== exclusions.length ||
              exclusions.some(
                (id) => !(current.files[item.id] ?? []).some((file) => file.id === id),
              )
            )
              throw new ReportMockError("VALIDATION_ERROR", "제외할 자료를 다시 확인해 주세요.");
            const next = draft(current, item, (prior?.revision ?? 0) + 1, exclusions);
            current.reports[id] = next;
            current.reportHistory ??= {};
            current.reportHistory[next.id] = structuredClone(next);
            current.reportSources ??= {};
            current.reportSources[next.id] = item.revision;
          } else {
            if (!prior) throw new ReportMockError("NOT_FOUND", "먼저 리포트를 확인해 주세요.");
            const input = reportSaveSchema.parse(body);
            const allowed = new Set((current.files[id] ?? []).map((file) => file.id));
            if (input.excludedFileIds.some((fileId) => !allowed.has(fileId)))
              throw new ReportMockError("VALIDATION_ERROR", "제외할 자료를 다시 확인해 주세요.");
            const photos = input.includedPhotoIds ?? prior.includedPhotoIds ?? [];
            if (
              photos.some(
                (fileId) =>
                  input.excludedFileIds.includes(fileId) ||
                  !(current.files[id] ?? []).some(
                    (file) =>
                      file.id === fileId &&
                      file.status === "ready" &&
                      /^image\/(jpeg|png|webp)$/.test(file.mimeType) &&
                      file.sizeBytes <= 5_000_000,
                  ),
              ) ||
              (current.files[id] ?? [])
                .filter((file) => photos.includes(file.id))
                .reduce((sum, file) => sum + file.sizeBytes, 0) > 8_000_000
            )
              throw new ReportMockError("VALIDATION_ERROR", "선택 사진을 다시 확인해 주세요.");
            const exclusionsChanged =
              JSON.stringify([...input.excludedFileIds].sort()) !==
              JSON.stringify([...prior.excludedFileIds].sort());
            if (exclusionsChanged && input.content !== prior.content)
              throw new ReportMockError(
                "EDITS_REQUIRE_SAVE",
                "본문 편집을 먼저 저장한 뒤 자료 제외를 적용해 주세요.",
              );
            const rebuilt = exclusionsChanged
              ? draft(current, item, prior.revision + 1, input.excludedFileIds)
              : null;
            const next = {
              ...prior,
              ...input,
              ...(rebuilt ? { content: rebuilt.content, basis: rebuilt.basis } : {}),
              id: `report-${crypto.randomUUID()}`,
              revision: prior.revision + 1,
              updatedAt: new Date().toISOString(),
              stale: false,
              pdfAvailable: false,
            };
            current.reports[id] = next;
            current.reportHistory ??= {};
            current.reportHistory[next.id] = structuredClone(next);
            current.reportSources ??= {};
            current.reportSources[next.id] = item.revision;
            const parentBinding = current.reworkReportBindings?.[prior.id];
            if (
              parentBinding &&
              !prior.stale &&
              !exclusionsChanged &&
              input.maskIdentifiers === prior.maskIdentifiers &&
              current.reportSources[prior.id] === item.revision
            ) {
              current.reworkReportBindings ??= {};
              current.reworkReportBindings[next.id] = parentBinding;
              current.reworkEditedReports ??= {};
              current.reworkEditedReports[next.id] = true;
            }
          }
        });
        value = structuredClone(runtime.read().reports[id] as ReportView);
      } else throw new ReportMockError("NOT_FOUND", "요청한 기능을 찾을 수 없어요.");
      if (key)
        runtime.update((current) => {
          requireMockCase(current, id);
          current.reportRequests ??= {};
          current.reportRequests[key] = { fingerprint, value: structuredClone(value) };
          const keys = Object.keys(current.reportRequests);
          if (keys.length > 100) delete current.reportRequests[keys[0] ?? ""];
        });
      return value as T;
    }
    if (exportPath) {
      const id = decodeURIComponent(exportPath[1] ?? "");
      if (exportPath[2] === "zip" && method === "GET") {
        const saved = state.reportZips?.[id];
        const authorized = () => {
          const current = runtime.read(),
            archive = current.reportZips?.[id];
          if (!saved || !archive || current.session.user?.id !== saved.ownerId)
            throw new ReportMockError("NOT_FOUND", "저장된 ZIP을 찾을 수 없어요.");
          requireMockCase(current, saved.caseId, false);
          if (
            (current.reportHistory?.[saved.reportId] ?? current.reports[saved.caseId])?.id !==
              saved.reportId ||
            saved.fileIds.some(
              (fileId) => !(current.files[saved.caseId] ?? []).some((file) => file.id === fileId),
            )
          )
            throw new ReportMockError("NOT_FOUND", "리포트나 자료가 삭제됐어요.");
        };
        authorized();
        if (!saved) throw new ReportMockError("NOT_FOUND", "저장된 ZIP을 찾을 수 없어요.");
        const blob = await archiveStore(`${saved.ownerId}/${saved.caseId}/report-zip/${id}`);
        authorized();
        if (!blob) throw new ReportMockError("NOT_FOUND", "저장된 ZIP을 찾을 수 없어요.");
        return blob as T;
      }
      const report =
        state.reportHistory?.[id] ?? Object.values(state.reports).find((item) => item.id === id);
      if (!report) throw new ReportMockError("NOT_FOUND", "리포트를 찾을 수 없어요.");
      requireMockCase(state, report.caseId, false);
      if (exportPath[2] === "html" && method === "GET") {
        const stale =
          (state.reportSources?.[id] ?? state.cases[report.caseId]?.revision) !==
          state.cases[report.caseId]?.revision;
        const photos = [];
        const ownerId = state.session.user?.id;
        if (!report.maskIdentifiers)
          for (const fileId of report.includedPhotoIds ?? []) {
            const file = (state.files[report.caseId] ?? []).find(
              (item) => item.id === fileId && item.status === "ready",
            );
            if (!file || report.excludedFileIds.includes(fileId))
              throw new ReportMockError("NOT_FOUND", "사진을 확인하지 못했어요.");
            const original = await runtime.original(report.caseId, fileId);
            if (original.size > 5_000_000)
              throw new ReportMockError("EXPORT_LIMIT_EXCEEDED", "사진 크기를 줄여 주세요.");
            const bytes = new Uint8Array(await original.arrayBuffer());
            let raw = "";
            for (let i = 0; i < bytes.length; i += 8192)
              raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
            photos.push({
              id: fileId,
              name: file.name,
              revision: file.revision ?? 1,
              dataUrl: `data:${file.mimeType};base64,${btoa(raw)}`,
            });
          }
        const current = runtime.read();
        requireMockCase(current, report.caseId, false);
        if (current.session.user?.id !== ownerId)
          throw new ReportMockError("NOT_FOUND", "계정이 바뀌었어요.");
        return new Blob([createReportHtml({ ...report, stale, photos })], {
          type: "text/html;charset=utf-8",
        }) as T;
      }
      const content = report.maskIdentifiers ? maskReportText(report.content) : report.content;
      if (exportPath[2] === "pdf" && method === "GET") {
        if (!report.pdfAvailable) requireMockAccount(state);
        const blob = await createSyntheticPdf(report.title, content, report.revision);
        const latest = runtime.read();
        requireMockCase(latest, report.caseId, false);
        if (latest.session.user?.id !== state.session.user?.id)
          throw new ReportMockError(
            "UNAUTHENTICATED",
            "로그인 상태가 변경됐어요. 다시 확인해 주세요.",
          );
        runtime.update((current) => {
          const stored = current.reportHistory?.[id];
          if (stored) stored.pdfAvailable = true;
          const latest = current.reports[report.caseId];
          if (latest?.id === id) latest.pdfAvailable = true;
        });
        return blob as T;
      }
      if (exportPath[2] === "zip" && method === "POST") {
        const ids = (init.body as { selectedFileIds?: unknown })?.selectedFileIds;
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 100 ||
          new Set(ids).size !== ids.length
        )
          throw new ReportMockError("VALIDATION_ERROR", "원본 자료를 1~100개 선택해 주세요.");
        const materials = state.files[report.caseId] ?? [];
        const entries: { name: string; blob: Blob }[] = [];
        for (const fileId of ids) {
          const file = materials.find((item) => item.id === fileId);
          if (file?.status !== "ready" || report.excludedFileIds.includes(file.id))
            throw new ReportMockError(
              "VALIDATION_ERROR",
              "삭제·제외·처리 중인 자료를 내보낼 수 없어요.",
            );
          entries.push({ name: file.name, blob: await runtime.original(report.caseId, file.id) });
        }
        const latest = runtime.read();
        requireMockCase(latest, report.caseId);
        if (
          ids.some(
            (fileId) => !(latest.files[report.caseId] ?? []).some((file) => file.id === fileId),
          )
        )
          throw new ReportMockError("NOT_FOUND", "내보내는 동안 자료가 삭제됐어요.");
        const blob = await createZip(entries);
        const finalState = runtime.read();
        requireMockCase(finalState, report.caseId);
        if (
          finalState.session.user?.id !== state.session.user?.id ||
          ids.some(
            (fileId) => !(finalState.files[report.caseId] ?? []).some((file) => file.id === fileId),
          )
        )
          throw new ReportMockError("NOT_FOUND", "내보내는 동안 자료나 로그인 상태가 변경됐어요.");
        const archiveId = `export-${crypto.randomUUID()}`,
          ownerId = state.session.user?.id ?? "";
        await archiveStore(`${ownerId}/${report.caseId}/report-zip/${archiveId}`, blob);
        runtime.update((current) => {
          requireMockCase(current, report.caseId);
          if (
            current.session.user?.id !== ownerId ||
            ids.some(
              (fileId) => !(current.files[report.caseId] ?? []).some((file) => file.id === fileId),
            )
          )
            throw new ReportMockError("NOT_FOUND", "자료나 로그인 상태가 변경됐어요.");
          current.reportZips ??= {};
          current.reportZips[archiveId] = {
            reportId: report.id,
            caseId: report.caseId,
            ownerId,
            fileIds: ids as string[],
          };
          const savedZip = {
            id: archiveId,
            fileCount: ids.length,
            createdAt: new Date().toISOString(),
          };
          const historical = current.reportHistory?.[report.id];
          if (historical) historical.savedZip = savedZip;
          const latest = current.reports[report.caseId];
          if (latest?.id === report.id) latest.savedZip = savedZip;
        });
        return blob as T;
      }
    }
    throw new ReportMockError("NOT_FOUND", "리포트 요청 경로를 확인해 주세요.");
  };
  return handler;
}

export function mockResponseError(error: unknown) {
  const known = error instanceof ReportMockError;
  const code = known ? error.code : "VALIDATION_ERROR";
  const status =
    code === "UNAUTHENTICATED"
      ? 401
      : ["CONSENT_REQUIRED", "ROLE_REQUIRED", "REAUTHENTICATION_REQUIRED"].includes(code)
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : code === "CONFLICT"
            ? 409
            : 400;
  return Response.json(
    {
      error: {
        code,
        message: known ? error.message : "입력 내용을 다시 확인해 주세요.",
        retryable: known && error.retryable,
      },
    },
    { status },
  );
}
export function createReportsMock(runtime: ReportMockRuntime) {
  const handle = createReportsMockHandler(runtime);
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (!/^\/api\/v2\/(cases\/[^/]+\/reports|reports\/[^/]+\/(html|pdf|zip))$/.test(path))
      return null;
    try {
      const result = await handle(path, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        ...(request.method !== "GET" ? { body: await request.json() } : {}),
      });
      return result instanceof Blob
        ? new Response(result, { headers: { "content-type": result.type } })
        : Response.json(result);
    } catch (error) {
      return mockResponseError(error);
    }
  };
}
