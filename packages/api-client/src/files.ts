import type {
  FileReviewProgress,
  FileReviewView,
  FileUploadProgress,
  FileView,
  SessionScope,
} from "@baro/client-core";
import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import {
  V2_LIMITS,
  type V2Coverage,
  v2CoverageSchema,
  v2FailureCodeSchema,
  v2FileObservationSchema,
  v2FileProcessingSchema,
  v2HashSchema,
  v2ObservationEditInputSchema,
  v2ObservationEditRequestSchema,
  v2UploadReservationRequestSchema,
  v2UploadSessionSchema,
} from "@baro/contracts/v2";
import { z } from "zod";
import {
  createUploadRecovery,
  type UploadRecovery,
  type UploadRecoveryRecord,
} from "./upload-recovery";
import {
  createWorkspaceOperations,
  type WorkspaceTransport,
  workspaceError,
  workspaceResponse,
} from "./workspace-http";

export interface UploadMetadata {
  name: string;
  size: number;
  type: string;
}
export interface FileUploadOptions {
  metadataOnly?: true;
  /** Explicit user decision after a confirmed CAS conflict, expired session or exact-file 404. */
  resolveConflict?: true;
}
/** The adapter owns immutable byte reads, streaming hash and bounded part buffers. */
export interface UploadReader {
  fingerprint(): Promise<string>;
  part(
    start: number,
    end: number,
  ): Promise<{ body: BodyInit; byteLength: number; contentHash: string }>;
  close(): Promise<void> | void;
}

export const fileViewSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive().optional(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  status: z.enum(["uploading", "processing", "ready", "failed", "waiting"]),
  coverage: z.string(),
  extractedText: z.string(),
  canStartProcessing: z.boolean().optional(),
  canRetry: z.boolean().optional(),
  processing: v2FileProcessingSchema.optional(),
  uploadContentHash: z.string().optional(),
  uploadRejection: z.literal("FILE_REJECTED").optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  failure: v2FailureCodeSchema.nullable().optional(),
});
const metadataSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  name: z.string(),
  declaredMediaType: z.string(),
  byteLength: z.number(),
  contentHash: z.string().optional(),
  uploadRejection: z.literal("FILE_REJECTED").optional(),
  canRetry: z.boolean().optional(),
  processing: v2FileProcessingSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  failure: v2FailureCodeSchema.nullable().optional(),
  status: z.enum([
    "reserved",
    "uploading",
    "uploaded",
    "queued",
    "processing",
    "ready",
    "failed",
    "deleting",
  ]),
});
const reviewProgressSchema = z.object({
  reviewId: z.string(),
  fileId: z.string(),
  revision: z.number(),
  workspaceRevision: z.number(),
  status: z.enum(["saving", "ready", "conflict"]),
  completed: z.number(),
  total: z.number(),
});
const reviewSchema = z.object({
  file: z.object({ id: z.string(), revision: z.number(), name: z.string(), status: z.string() }),
  workspaceRevision: z.number(),
  coverage: v2CoverageSchema.nullable(),
  observations: z.array(
    z.object({
      ordinal: z.number(),
      value: v2FileObservationSchema,
      original: v2FileObservationSchema,
    }),
  ),
  nextAfterOrdinal: z.number().nullable(),
  pendingReview: reviewProgressSchema.nullable(),
  recovery: z
    .object({ code: z.string(), message: z.string(), actions: z.array(z.string()) })
    .nullable(),
});
function coverageLabel(coverage: V2Coverage | null) {
  if (!coverage) return "처리 범위를 아직 확인할 수 없어요.";
  if (coverage.category === "document") {
    const processed = coverage.pages.filter((page) => page.status === "processed").length;
    return `문서 ${coverage.pageCount}쪽 중 ${processed}쪽 확인 가능${processed < coverage.pageCount ? " · 누락·품질 저하 구간은 원본으로 확인해 주세요." : ""}`;
  }
  if (coverage.category === "image")
    return coverage.observation === "processed"
      ? "이미지 관찰 결과 확인 가능 · 원본과 함께 확인해 주세요."
      : "이미지 일부 내용을 확인하지 못했어요. 원본을 확인해 주세요.";
  if (coverage.category === "audio")
    return `음성 ${Math.ceil(coverage.audio.durationSeconds)}초 · ${coverage.audio.status === "complete" ? "전체 구간 처리" : "일부 누락·품질 저하 구간 있음"}`;
  const processed = coverage.frames.filter((frame) => frame.status === "processed").length;
  return `영상 ${Math.ceil(coverage.durationSeconds)}초 · ${coverage.frames.length}개 확인 구간 중 ${processed}개 처리${coverage.status === "partial" ? " · 누락·품질 저하 구간 있음" : ""}${coverage.audio?.status === "partial" ? " · 음성 일부 누락" : ""} · 전체 장면에 대한 관찰을 보장하지 않아요.`;
}
export function validateUpload(file: UploadMetadata) {
  if (!v2UploadReservationRequestSchema.shape.name.safeParse(file.name).success)
    throw workspaceError(
      "VALIDATION_ERROR",
      "파일 이름에 경로나 제어 문자가 포함돼 있어요. 이름을 바꾼 뒤 다시 선택해 주세요.",
    );
  const media =
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    /\.(mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv)$/i.test(file.name);
  const limit = media ? V2_LIMITS.mediaBytes : V2_LIMITS.documentImageBytes;
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit)
    throw workspaceError(
      "VALIDATION_ERROR",
      `파일은 비어 있지 않아야 하며 ${limit / 1_000_000} MB 이하여야 해요.`,
    );
  if (
    !/\.(txt|pdf|doc|docx|hwp|hwpx|xls|xlsx|ppt|pptx|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv)$/i.test(
      file.name,
    )
  )
    throw workspaceError(
      "VALIDATION_ERROR",
      "지원하는 문서·이미지·음성·영상 파일을 선택해 주세요.",
    );
}
export function splitObservationEdits(input: z.infer<typeof v2ObservationEditInputSchema>) {
  const body = v2ObservationEditInputSchema.parse(input);
  const batches: (typeof body.edits)[] = [];
  let batch: typeof body.edits = [];
  for (const edit of body.edits) {
    const candidate = [...batch, edit];
    // Reserve the maximum revision width so later batches stay within the same byte limit.
    if (
      !v2ObservationEditRequestSchema.safeParse({
        expectedRevision: Number.MAX_SAFE_INTEGER,
        edits: candidate,
      }).success &&
      batch.length
    ) {
      batches.push(batch);
      batch = [];
    }
    batch.push(edit);
  }
  batches.push(batch);
  return batches;
}

/** Metadata reads require no upload/download ports. The caller owns credential and signal fencing. */
export function createFileMetadataReader(request: WorkspaceTransport) {
  const { workspaceJson } = createWorkspaceOperations(() => {
    throw new Error("READ_ONLY");
  });
  return (id: string) => readFiles(id, { metadataOnly: true }, request, workspaceJson);
}
async function readFiles(
  id: string,
  options: { metadataOnly?: true },
  request: WorkspaceTransport,
  workspaceJson: ReturnType<typeof createWorkspaceOperations>["workspaceJson"],
  revisions = new Map<string, number>(),
  uploadHashes = new Map<string, string | undefined>(),
): Promise<FileView[]> {
  const base = (value: string) => `/api/v2/cases/${encodeURIComponent(value)}`;
  let cursor: string | undefined;
  const output: FileView[] = [];
  do {
    const raw = await workspaceJson(
      request,
      `${base(id)}/files${cursor ? `?afterId=${encodeURIComponent(cursor)}` : ""}`,
    );
    const views = z.array(fileViewSchema).safeParse(raw);
    if (views.success) {
      for (const file of views.data) uploadHashes.set(`${id}:${file.id}`, file.uploadContentHash);
      // An empty terminal metadata page also matches this legacy view schema.
      return [...output, ...views.data];
    }
    const rows = z.array(metadataSchema).parse(raw);
    for (const row of rows) {
      revisions.set(`${id}:${row.id}`, row.revision);
      uploadHashes.set(`${id}:${row.id}`, row.contentHash);
      if (row.status === "deleting") continue;
      const file: FileView = {
        id: row.id,
        revision: row.revision,
        name: row.name,
        mimeType: row.declaredMediaType,
        sizeBytes: row.byteLength,
        status:
          row.status === "ready"
            ? "ready"
            : row.status === "failed"
              ? "failed"
              : row.status === "reserved" || row.status === "uploading"
                ? "uploading"
                : row.status === "processing" ||
                    (row.status === "queued" &&
                      row.processing &&
                      row.processing.status !== "queued")
                  ? "processing"
                  : "waiting",
        coverage:
          options.metadataOnly && row.status === "ready"
            ? "자료 확인에서 처리 범위를 확인할 수 있어요."
            : "처리 결과는 아직 확인할 수 없어요.",
        extractedText: "",
        canStartProcessing: row.status === "uploaded",
        canRetry: row.canRetry ?? false,
        createdAt: row.createdAt,
        failure: row.failure,
        uploadRejection: row.uploadRejection,
        processing: row.processing,
      };
      if (row.status === "ready" && !options.metadataOnly) {
        const detail = await request(
          `${base(id)}/files/${encodeURIComponent(row.id)}?view=coverage`,
        );
        if (detail.ok) {
          const parsed = z
            .strictObject({
              id: metadataSchema.shape.id,
              revision: metadataSchema.shape.revision,
              status: z.literal("ready"),
              coverage: v2CoverageSchema,
            })
            .parse(await detail.json());
          if (parsed.id !== row.id || parsed.revision !== row.revision)
            throw workspaceError(
              "UNAVAILABLE",
              "자료가 갱신되어 최신 목록을 다시 불러와 주세요.",
              true,
            );
          file.coverage = coverageLabel(parsed.coverage);
        } else await workspaceResponse(detail);
      }
      output.push(file);
    }
    cursor = rows.length === 20 ? rows.at(-1)?.id : undefined;
  } while (cursor && output.length < 1000);
  return output;
}

export function createFilesClient<Source extends UploadMetadata, Download>(dependencies: {
  request: WorkspaceTransport;
  scope: SessionScope;
  /** Only opt in when the adapter controls credential changes through this scope. */
  coalesceWrites?: "credential-scope";
  signal?: AbortSignal;
  newKey: () => string;
  openUpload: (source: Source, signal: AbortSignal) => Promise<UploadReader>;
  download: (response: Response, signal: AbortSignal) => Promise<Download>;
  /** Native HTTP-to-disk must begin before a JS fetch body exists. The port owns authority, bytes and abort retirement. */
  downloadOriginal?: (path: string, signal: AbortSignal) => Promise<Download>;
  recovery?: UploadRecovery;
  onUploadAcknowledged?: (fileId: string) => void;
}) {
  const generation = dependencies.scope.snapshot();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
    : dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw workspaceError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const request: WorkspaceTransport = async (path, init = {}) => {
    ensureCurrent();
    try {
      const headers = new Headers(init.headers);
      if (dependencies.recovery)
        headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(dependencies.recovery.ownerId));
      const response = await dependencies.request(path, {
        ...init,
        ...(dependencies.recovery ? { headers } : {}),
        signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
      });
      ensureCurrent();
      return response;
    } catch (error) {
      ensureCurrent();
      throw error;
    }
  };
  const { workspaceJson, workspaceMutation } = createWorkspaceOperations(dependencies.newKey);
  const recovery = dependencies.recovery
    ? createUploadRecovery({ recovery: dependencies.recovery, ensureCurrent })
    : undefined;

  const revisions = new Map<string, number>();
  const uploadHashes = new Map<string, string | undefined>();
  const reviews = new Map<string, RequestInit>();
  const batchReviews = new Map<
    string,
    {
      index: number;
      revision: number;
      workspaceRevision: number;
      progress: FileReviewProgress | undefined;
    }
  >();
  const pendingRemovals = new Set<string>();
  const uploads = new Map<
    string,
    { expectedRevision: number; key: string; session?: z.infer<typeof v2UploadSessionSchema> }
  >();
  const base = (id: string) => `/api/v2/cases/${encodeURIComponent(id)}`;
  async function workspaceRevision(id: string) {
    const value = z
      .union([
        z.object({ workspaceRevision: z.number() }),
        z.object({ case: z.object({ revision: z.number() }) }),
      ])
      .parse(await workspaceJson(request, `${base(id)}/workspace`));
    return "workspaceRevision" in value ? value.workspaceRevision : value.case.revision;
  }
  const list = (id: string, options: { metadataOnly?: true } = {}) =>
    readFiles(id, options, request, workspaceJson, revisions, uploadHashes);
  const pendingUploads = new WeakMap<Source, Map<string, Promise<FileView>>>();
  async function upload(
    id: string,
    file: Source,
    onProgress?: (value: FileUploadProgress) => void,
    options: FileUploadOptions = {},
  ): Promise<FileView> {
    ensureCurrent();
    validateUpload(file);
    if (dependencies.coalesceWrites !== "credential-scope")
      return uploadOnce(id, file, onProgress, options);
    let pending = pendingUploads.get(file);
    if (!pending) {
      pending = new Map();
      pendingUploads.set(file, pending);
    }
    const identity = JSON.stringify([
      id,
      options.metadataOnly === true,
      options.resolveConflict === true,
    ]);
    const previous = pending.get(identity);
    if (previous) return previous;
    const task = uploadOnce(id, file, onProgress, options);
    pending.set(identity, task);
    try {
      return await task;
    } finally {
      if (pending.get(identity) === task) pending.delete(identity);
    }
  }
  async function uploadOnce(
    id: string,
    file: Source,
    onProgress?: (value: FileUploadProgress) => void,
    options: FileUploadOptions = {},
  ): Promise<FileView> {
    ensureCurrent();
    validateUpload(file);
    const reader = await dependencies.openUpload(file, signal);
    try {
      ensureCurrent();
      const progress = (stage: FileUploadProgress["stage"], completedBytes = 0) => {
        ensureCurrent();
        // Display callbacks must not change an upload's result or idempotent recovery.
        try {
          onProgress?.({ stage, completedBytes, totalBytes: file.size });
        } catch {}
      };
      validateUpload(file);
      const name = file.name.trim();
      progress("hashing");
      const contentHash = await reader.fingerprint();
      if (!v2HashSchema.safeParse(contentHash).success)
        throw workspaceError("UNAVAILABLE", "파일 확인 정보를 준비하지 못했어요.", true);
      ensureCurrent();
      progress("preparing");
      if (recovery) return await uploadRecovering(id, file, reader, contentHash, progress, options);
      const identity = `${id}:${name}:${file.size}:${contentHash}`;
      const current = await list(id, options);
      // Reconcile interrupted uploads before freezing a new reservation's CAS.
      // Background processing can publish while this paginated list is read.
      // An existing ambiguous attempt retains its exact key and revision.
      let attempt = uploads.get(identity);
      if (!attempt) {
        const revision = await workspaceRevision(id);
        attempt = uploads.get(identity) ?? {
          expectedRevision: revision,
          key: dependencies.newKey(),
        };
        uploads.set(identity, attempt);
      }
      const input = {
        name,
        byteLength: file.size,
        mediaType: file.type.split(";")[0]?.trim().toLowerCase() || "application/octet-stream",
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        contentHash,
      };
      if (attempt.session && !current.some((item) => item.id === attempt.session?.fileId)) {
        uploads.delete(identity);
        return await uploadOnce(id, file, onProgress, options);
      }
      let session = attempt.session;
      if (!session) {
        const pending = current.find(
          (item) =>
            item.status === "uploading" &&
            item.name === name &&
            item.sizeBytes === file.size &&
            uploadHashes.get(`${id}:${item.id}`) === contentHash,
        );
        if (pending) {
          session = v2UploadSessionSchema.parse(
            await workspaceJson(
              request,
              `${base(id)}/files/${encodeURIComponent(pending.id)}/upload-session`,
            ),
          );
          attempt.session = session;
        }
      }
      if (!session) {
        try {
          session = v2UploadSessionSchema.parse(
            await workspaceJson(request, `${base(id)}/files`, {
              method: "POST",
              body: JSON.stringify(input),
              headers: {
                "content-type": "application/json",
                "idempotency-key": attempt.key,
                "if-match": String(attempt.expectedRevision),
              },
            }),
          );
          attempt.session = session;
        } catch (cause) {
          if ((cause as { code?: string }).code === "CONFLICT") uploads.delete(identity);
          throw cause;
        }
      }
      const existing = (await list(id, options)).find((item) => item.id === session.fileId);
      if (existing?.uploadRejection)
        throw workspaceError(
          "FILE_REJECTED",
          "파일 형식과 내용을 확인해 주세요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 뒤 다시 추가해 주세요.",
          false,
        );
      if (existing && existing.status !== "uploading") {
        uploads.delete(identity);
        return existing;
      }
      const parts = [];
      progress("uploading");
      for (let start = 0, index = 0; start < file.size; start += session.chunkBytes, index++) {
        const end = Math.min(start + session.chunkBytes, file.size);
        const chunk = await reader.part(start, end);
        ensureCurrent();
        if (chunk.byteLength !== end - start || !v2HashSchema.safeParse(chunk.contentHash).success)
          throw workspaceError(
            "UNAVAILABLE",
            "파일 조각을 확인하지 못했어요. 다시 선택해 주세요.",
            true,
          );
        const part = { index, byteLength: chunk.byteLength, contentHash: chunk.contentHash };
        await workspaceJson(
          request,
          `${base(id)}/files/${encodeURIComponent(session.fileId)}/parts/${index}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/octet-stream",
              "x-upload-session": session.uploadSession,
            },
            body: chunk.body,
          },
        );
        parts.push(part);
        progress("uploading", start + chunk.byteLength);
      }
      const manifest = { byteLength: file.size, contentHash, parts };
      progress("checking", file.size);
      await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(session.fileId)}/complete`,
        workspaceMutation(`${base(id)}/files/${encodeURIComponent(session.fileId)}/complete`, {
          expectedRevision: await workspaceRevision(id),
          uploadSession: session.uploadSession,
          manifest,
        }),
      );
      progress("confirming", file.size);
      const result = (await list(id, options)).find((item) => item.id === session.fileId);
      if (!result)
        throw workspaceError("UNAVAILABLE", "파일 저장 상태를 다시 확인해 주세요.", true);
      uploads.delete(identity);
      return result;
    } finally {
      // Closing a reader must not turn a committed upload into another admission.
      try {
        await reader.close();
      } catch {
        /* Adapter owns orphan/cache cleanup. */
      }
    }
  }
  async function uploadRecovering(
    id: string,
    file: Source,
    reader: UploadReader,
    contentHash: string,
    progress: (stage: FileUploadProgress["stage"], completedBytes?: number) => void,
    options: FileUploadOptions,
  ): Promise<FileView> {
    if (!recovery) throw workspaceError("UNAVAILABLE", "업로드 복구 정보를 확인해 주세요.");
    const path = `${base(id)}/files`;
    const input = v2UploadReservationRequestSchema.parse({
      name: file.name.trim(),
      byteLength: file.size,
      mediaType: file.type.split(";")[0]?.trim().toLowerCase() || "application/octet-stream",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      contentHash,
    });
    const identity = await recovery.identity(path, input);
    return recovery.run(identity, async () => {
      let record: UploadRecoveryRecord | null = await recovery.load(identity);
      if (record?.conflict && options.resolveConflict) {
        // Only an explicit caller decision after a confirmed conflict/expiry/404 may refresh CAS.
        if (record.conflict !== "complete") record = null;
        else {
          delete record.complete;
          delete record.conflict;
        }
      }
      if (!record) {
        record = {
          version: 1,
          reservationKey: dependencies.newKey(),
          expectedRevision: await workspaceRevision(id),
        };
        await recovery.save(identity, record);
      }
      const operation = record;
      let acknowledged = false;
      const acknowledge = () => {
        ensureCurrent();
        if (acknowledged) return;
        acknowledged = true;
        try {
          dependencies.onUploadAcknowledged?.(operation.fileId as string);
        } catch {
          /* Display state cannot undo an accepted upload. */
        }
        ensureCurrent();
      };
      const known = async () => {
        const value = (await list(id, options)).find((row) => row.id === operation.fileId);
        if (!value) {
          // A paginated/temporarily stale list is not proof that an uncertain
          // upload disappeared. Only an explicit 404 for this exact file permits
          // a later, explicit new reservation; auth/role/other failures do not.
          const response = await request(
            `${path}/${encodeURIComponent(operation.fileId as string)}?view=coverage`,
          );
          if (response.status === 404) {
            operation.conflict = "missing";
            await recovery.save(identity, operation);
          }
          await workspaceResponse(response);
          throw workspaceError(
            "UNAVAILABLE",
            "원래 업로드 상태를 확인하지 못했어요. 최신 목록을 확인해 주세요.",
            true,
          );
        }
        if (
          value.name !== input.name ||
          value.sizeBytes !== file.size ||
          (uploadHashes.get(`${id}:${value.id}`) !== undefined &&
            uploadHashes.get(`${id}:${value.id}`) !== contentHash) ||
          (value.status === "uploading" && uploadHashes.get(`${id}:${value.id}`) !== contentHash)
        )
          throw workspaceError(
            "UNAVAILABLE",
            "원래 파일과 일치하는 업로드 자료를 확인하지 못했어요.",
            true,
          );
        if (value.uploadRejection)
          throw workspaceError("FILE_REJECTED", "파일 형식과 내용을 확인한 뒤 다시 선택해 주세요.");
        if (value.status === "uploading") return null;
        // Finalized metadata moves the provisional hash into the private manifest.
        // Reconcile only this operation's persisted server file ID, never a name/size search.
        acknowledge();
        await recovery.complete(identity);
        ensureCurrent();
        return value;
      };
      let session: z.infer<typeof v2UploadSessionSchema>;
      if (operation.fileId) {
        const completed = await known();
        if (completed) return completed;
        const response = await request(
          `${path}/${encodeURIComponent(operation.fileId)}/upload-session`,
        );
        if (response.status === 404) {
          operation.conflict = "reservation";
          await recovery.save(identity, operation);
        }
        session = v2UploadSessionSchema.parse(await (await workspaceResponse(response)).json());
      } else {
        try {
          const response = await request(path, {
            method: "POST",
            body: JSON.stringify(input),
            headers: {
              "content-type": "application/json",
              "idempotency-key": operation.reservationKey,
              "if-match": String(operation.expectedRevision),
            },
          });
          if (response.status === 404) {
            operation.conflict = "reservation";
            await recovery.save(identity, operation);
          }
          session = v2UploadSessionSchema.parse(await (await workspaceResponse(response)).json());
        } catch (error) {
          if ((error as { code?: string }).code === "CONFLICT") {
            operation.conflict = "reservation";
            await recovery.save(identity, operation);
          }
          throw error;
        }
        operation.fileId = session.fileId;
        await recovery.save(identity, operation);
      }
      if (session.fileId !== operation.fileId || session.reservedBytes !== file.size)
        throw workspaceError("UNAVAILABLE", "원래 파일의 업로드 상태를 다시 확인해 주세요.", true);
      const completed = await known();
      if (completed) return completed;
      const parts = [];
      progress("uploading");
      for (let start = 0, index = 0; start < file.size; start += session.chunkBytes, index++) {
        const end = Math.min(start + session.chunkBytes, file.size),
          chunk = await reader.part(start, end);
        ensureCurrent();
        if (chunk.byteLength !== end - start || !v2HashSchema.safeParse(chunk.contentHash).success)
          throw workspaceError(
            "UNAVAILABLE",
            "파일 조각을 확인하지 못했어요. 다시 선택해 주세요.",
            true,
          );
        await workspaceJson(
          request,
          `${path}/${encodeURIComponent(session.fileId)}/parts/${index}`,
          {
            method: "PUT",
            body: chunk.body,
            headers: {
              "content-type": "application/octet-stream",
              "x-upload-session": session.uploadSession,
            },
          },
        );
        parts.push({ index, byteLength: chunk.byteLength, contentHash: chunk.contentHash });
        progress("uploading", end);
      }
      const manifest = { byteLength: file.size, contentHash, parts };
      const requestHash = await recovery.fingerprint(
        JSON.stringify({ uploadSession: session.uploadSession, manifest }),
      );
      if (!operation.complete) {
        operation.complete = {
          key: dependencies.newKey(),
          expectedRevision: await workspaceRevision(id),
          requestHash,
        };
        await recovery.save(identity, operation);
      } else if (operation.complete.requestHash !== requestHash)
        throw workspaceError("UNAVAILABLE", "원래 업로드와 일치하는 파일을 다시 선택해 주세요.");
      const commit = operation.complete;
      progress("checking", file.size);
      try {
        const ack = z
          .object({
            fileId: z.string(),
            revision: z.number().int().positive(),
            status: z.enum(["uploaded", "queued", "processing", "ready", "failed"]),
            processingQueued: z.boolean(),
          })
          .parse(
            await workspaceJson(request, `${path}/${encodeURIComponent(session.fileId)}/complete`, {
              method: "POST",
              body: JSON.stringify({
                expectedRevision: commit.expectedRevision,
                uploadSession: session.uploadSession,
                manifest,
              }),
              headers: { "content-type": "application/json", "idempotency-key": commit.key },
            }),
          );
        if (ack.fileId !== operation.fileId)
          throw workspaceError("UNAVAILABLE", "업로드 접수를 확인하지 못했어요.", true);
      } catch (error) {
        if ((error as { code?: string }).code === "CONFLICT") {
          operation.conflict = "complete";
          await recovery.save(identity, operation);
        }
        throw error;
      }
      acknowledge();
      progress("confirming", file.size);
      const value = await known();
      if (!value) throw workspaceError("UNAVAILABLE", "파일 저장 상태를 다시 확인해 주세요.", true);
      return value;
    });
  }
  async function saveSingleReview(
    id: string,
    fileId: string,
    input: z.infer<typeof v2ObservationEditRequestSchema>,
    workspaceRevision: number,
  ): Promise<FileReviewProgress> {
    const body = v2ObservationEditRequestSchema.parse(input);
    const path = `${base(id)}/files/${encodeURIComponent(fileId)}/observations`;
    const signature = JSON.stringify({ id, fileId, body, workspaceRevision });
    let init = reviews.get(signature);
    if (!init) {
      init = workspaceMutation(path, body, "PATCH");
      init.headers = {
        ...Object.fromEntries(new Headers(init.headers)),
        "if-match": String(workspaceRevision),
      };
      reviews.set(signature, init);
    }
    try {
      const result = reviewProgressSchema.parse(await workspaceJson(request, path, init));
      reviews.delete(signature);
      return result;
    } catch (cause) {
      if ((cause as { code?: string }).code === "CONFLICT") reviews.delete(signature);
      throw cause;
    }
  }
  const client = {
    list,
    upload,
    async review(id: string, fileId: string, afterOrdinal = -1): Promise<FileReviewView> {
      return reviewSchema.parse(
        await workspaceJson(
          request,
          `${base(id)}/files/${encodeURIComponent(fileId)}/review?afterOrdinal=${afterOrdinal}`,
        ),
      );
    },
    async saveReview(
      id: string,
      fileId: string,
      input: z.infer<typeof v2ObservationEditInputSchema>,
      workspaceRevision: number,
    ): Promise<FileReviewProgress> {
      const body = v2ObservationEditInputSchema.parse(input);
      if (v2ObservationEditRequestSchema.safeParse(body).success)
        return saveSingleReview(id, fileId, body, workspaceRevision);
      const signature = JSON.stringify({ id, fileId, body, workspaceRevision });
      const batches = splitObservationEdits(body);
      const state = batchReviews.get(signature) ?? {
        index: 0,
        progress: undefined,
        revision: body.expectedRevision,
        workspaceRevision,
      };
      batchReviews.set(signature, state);
      try {
        while (state.index < batches.length) {
          state.progress ??= await saveSingleReview(
            id,
            fileId,
            { expectedRevision: state.revision, edits: batches[state.index] ?? [] },
            state.workspaceRevision,
          );
          while (state.progress.status === "saving") {
            state.progress = reviewProgressSchema.parse(
              await workspaceJson(
                request,
                `${base(id)}/files/${encodeURIComponent(fileId)}/observations/${encodeURIComponent(state.progress.reviewId)}/continue`,
                { method: "POST" },
              ),
            );
          }
          if (state.progress.status !== "ready")
            throw workspaceError("CONFLICT", "자료가 변경됐어요. 최신 내용을 확인해 주세요.");
          state.revision = state.progress.revision;
          state.workspaceRevision = state.progress.workspaceRevision;
          state.index++;
          if (state.index < batches.length) state.progress = undefined;
        }
        const result = state.progress;
        if (!result)
          throw workspaceError("UNAVAILABLE", "교정 저장 상태를 다시 확인해 주세요.", true);
        batchReviews.delete(signature);
        return result;
      } catch (cause) {
        if (cause && typeof cause === "object")
          Object.assign(cause, {
            batchedReviewPending: true,
            completedReviewEdits: batches
              .slice(0, state.index)
              .reduce((n, batch) => n + batch.length, 0),
          });
        if ((cause as { code?: string }).code === "CONFLICT") batchReviews.delete(signature);
        throw cause;
      }
    },
    async continueReview(
      id: string,
      fileId: string,
      reviewId: string,
    ): Promise<FileReviewProgress> {
      return reviewProgressSchema.parse(
        await workspaceJson(
          request,
          `${base(id)}/files/${encodeURIComponent(fileId)}/observations/${encodeURIComponent(reviewId)}/continue`,
          { method: "POST" },
        ),
      );
    },
    async discardReview(id: string, fileId: string, reviewId: string): Promise<void> {
      await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(fileId)}/observations/${encodeURIComponent(reviewId)}`,
        { method: "DELETE" },
      );
    },
    async retry(
      id: string,
      fileId: string,
      onAccepted?: () => void,
      options: { metadataOnly?: true } = {},
    ) {
      await list(id, options);
      const value = await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(fileId)}/retry`,
        workspaceMutation(`${base(id)}/files/${encodeURIComponent(fileId)}/retry`, {
          expectedRevision: await workspaceRevision(id),
          fileRevision: revisions.get(`${id}:${fileId}`) ?? 1,
        }),
      );
      const mock = fileViewSchema.safeParse(value);
      const accepted = mock.success ? mock.data : metadataSchema.parse(value);
      if (accepted.id !== fileId)
        throw workspaceError("VALIDATION_ERROR", "자료 처리 접수 결과를 확인하지 못했어요.");
      // Only a validated response for this exact file acknowledges the request.
      // A display callback must not turn an accepted write into a retryable error.
      try {
        onAccepted?.();
      } catch {}
      if (mock.success) return mock.data;
      const found = (await list(id, options)).find((file) => file.id === fileId);
      if (!found) throw workspaceError("NOT_FOUND", "자료를 찾을 수 없어요.");
      return found;
    },
    async remove(id: string, fileId: string) {
      const forgetUpload = () => {
        for (const [key, attempt] of uploads)
          if (attempt.session?.fileId === fileId) uploads.delete(key);
      };
      const identity = `${id}:${fileId}`;
      // Listing authorizes the workspace even when a prior DELETE already committed.
      const current = await list(id);
      if (!current.some((file) => file.id === fileId)) {
        if (!pendingRemovals.delete(identity))
          throw workspaceError("NOT_FOUND", "자료를 찾을 수 없어요.");
        forgetUpload();
        return current;
      }
      pendingRemovals.add(identity);
      await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(fileId)}`,
        workspaceMutation(
          `${base(id)}/files/${encodeURIComponent(fileId)}`,
          {
            expectedRevision: await workspaceRevision(id),
            fileRevision: revisions.get(`${id}:${fileId}`) ?? 1,
          },
          "DELETE",
        ),
      );
      forgetUpload();
      const next = await list(id);
      pendingRemovals.delete(identity);
      return next;
    },
    async original(id: string, fileId: string) {
      const path = `${base(id)}/files/${encodeURIComponent(fileId)}/content`;
      if (dependencies.downloadOriginal) {
        ensureCurrent();
        return dependencies.downloadOriginal(path, signal);
      }
      const response = await workspaceResponse(await request(path));
      ensureCurrent();
      return dependencies.download(response, signal);
    },
  };
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        ensureCurrent();
        try {
          const result = await Reflect.apply(value, target, args);
          ensureCurrent();
          return result;
        } catch (error) {
          ensureCurrent();
          throw error;
        }
      };
    },
  });
}
