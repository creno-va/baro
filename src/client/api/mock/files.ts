import {
  V2_LIMITS,
  v2UploadCompleteRequestSchema,
  v2UploadReservationRequestSchema,
} from "../../../contracts/v2";
import { validateUpload } from "../files";
import type { FileView } from "../types";
import { handleFileReviewMock } from "./file-review";
import {
  consumeMockFault,
  ensureMockWorkspace,
  mockFailure,
  mockResponse,
  requireMockCase,
  touchMockCase,
  WorkspaceMockError,
  type WorkspaceMockRuntime,
} from "./workspace";

function binaryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("baro-workspace-originals-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("originals");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new WorkspaceMockError("UNAVAILABLE", "원본을 브라우저에 저장하지 못했어요.", true));
    request.onblocked = () =>
      reject(
        new WorkspaceMockError("UNAVAILABLE", "다른 화면을 닫고 자료를 다시 추가해 주세요.", true),
      );
  });
}
export async function mockOriginalStore(key: string, value?: Blob | null): Promise<Blob | null> {
  const db = await binaryDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction("originals", value === undefined ? "readonly" : "readwrite"),
        store = tx.objectStore("originals");
      const request =
        value === undefined
          ? store.get(key)
          : value === null
            ? store.delete(key)
            : store.put(value, key);
      let result: Blob | null = null;
      request.onsuccess = () => {
        if (request.result instanceof Blob) result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(new WorkspaceMockError("UNAVAILABLE", "원본 저장소를 확인할 수 없어요.", true));
      tx.onabort = () =>
        reject(new WorkspaceMockError("UNAVAILABLE", "원본 저장을 완료하지 못했어요.", true));
    });
  } finally {
    db.close();
  }
}
export async function clearMockOriginals(ownerId: string, caseId?: string) {
  const db = await binaryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("originals", "readwrite"),
        store = tx.objectStore("originals");
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (String(row.key).startsWith(`${ownerId}/${caseId ? `${caseId}/` : ""}`)) row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new WorkspaceMockError("UNAVAILABLE", "원본 정리를 다시 시도해 주세요.", true));
    });
  } finally {
    db.close();
  }
}
async function blobHash(blob: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function createFilesMock(runtime: WorkspaceMockRuntime, originals = mockOriginalStore) {
  return async function handleFilesMock(request: Request): Promise<Response | null> {
    const review = await handleFileReviewMock(runtime, request);
    if (review) return review;
    const match =
      /^\/api\/v2\/cases\/([^/]+)\/files(?:\/([^/]+)(?:\/(content|retry|complete|upload-session|parts\/(\d+)))?)?$/.exec(
        new URL(request.url).pathname,
      );
    if (!match) return null;
    const id = decodeURIComponent(match[1] ?? ""),
      fileId = match[2] ? decodeURIComponent(match[2]) : null,
      kind = match[3];
    try {
      const state = runtime.read();
      requireMockCase(state, id, !["GET", "DELETE"].includes(request.method));
      const owner = state.session.user?.id;
      if (!owner) throw new WorkspaceMockError("UNAUTHENTICATED", "로그인이 필요해요.");
      if (request.method === "GET" && !fileId) {
        consumeMockFault(runtime, "files.list");
        return runtime.update((value) => mockResponse(ensureMockWorkspace(value, id).files));
      }
      const record = state.files?.[id]?.find((file) => file.id === fileId);
      if (request.method === "GET" && fileId && kind === "content") {
        if (!record) throw new WorkspaceMockError("NOT_FOUND", "자료를 찾을 수 없어요.");
        const blob = await originals(`${owner}/${id}/${fileId}`);
        requireMockCase(runtime.read(), id);
        if (!runtime.read().files[id]?.some((file) => file.id === fileId))
          throw new WorkspaceMockError("NOT_FOUND", "자료가 삭제됐어요.");
        if (!blob)
          throw new WorkspaceMockError(
            "NOT_FOUND",
            "보존한 원본을 찾을 수 없어요. 파일을 다시 선택해 주세요.",
          );
        return new Response(blob, {
          headers: {
            "content-type": blob.type || "application/octet-stream",
            "x-baro-mock": "true",
          },
        });
      }
      if (request.method === "POST" && !fileId) {
        const input = v2UploadReservationRequestSchema.parse(await request.json());
        try {
          validateUpload({ name: input.name, size: input.byteLength, type: input.mediaType });
        } catch (cause) {
          throw new WorkspaceMockError(
            "VALIDATION_ERROR",
            cause instanceof Error ? cause.message : "파일을 확인해 주세요.",
          );
        }
        const requestKey = `${owner}/${id}/${request.headers.get("idempotency-key") ?? ""}`;
        const fingerprint = JSON.stringify({ input, revision: request.headers.get("if-match") });
        const replay = state.fileUploadReceipts?.[requestKey];
        if (replay) {
          const upload = state.fileUploads?.[replay.fileId];
          if (!upload || replay.fingerprint !== fingerprint)
            throw new WorkspaceMockError("CONFLICT", "업로드 요청을 다시 확인해 주세요.");
          return mockResponse(upload.session, 201);
        }
        const fault = consumeMockFault(runtime, "files.upload");
        return runtime.update((value) => {
          const item = requireMockCase(value, id, true);
          if (String(item.revision) !== request.headers.get("if-match"))
            throw new WorkspaceMockError("CONFLICT", "최신 상태를 확인해 주세요.");
          ensureMockWorkspace(value, id);
          const newId = crypto.randomUUID();
          const session = {
            schemaVersion: "2" as const,
            fileId: newId,
            uploadSession: crypto.randomUUID(),
            chunkBytes: V2_LIMITS.chunkBytes,
            reservedBytes: input.byteLength,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          };
          const file: FileView = {
            id: newId,
            name: input.name,
            mimeType: input.mediaType,
            sizeBytes: input.byteLength,
            status: "uploading",
            coverage: "원본 업로드 중 · API 예시 응답",
            extractedText: "",
            uploadContentHash: input.contentHash,
          };
          value.files[id]?.push(file);
          value.fileUploads ??= {};
          value.fileUploads[newId] = {
            session,
            caseId: id,
            ownerId: owner,
            parts: {},
            failedProcessing: fault === "file_failed",
          };
          value.fileUploadReceipts ??= {};
          value.fileUploadReceipts[requestKey] = { fileId: newId, fingerprint };
          touchMockCase(value, id);
          return mockResponse(session, 201);
        });
      }
      if (!record || !fileId) throw new WorkspaceMockError("NOT_FOUND", "자료를 찾을 수 없어요.");
      const upload = state.fileUploads?.[fileId];
      if (request.method === "GET" && kind === "upload-session") {
        requireMockCase(state, id, true);
        if (
          !upload ||
          upload.ownerId !== owner ||
          upload.caseId !== id ||
          record.status !== "uploading" ||
          Date.parse(upload.session.expiresAt) <= Date.now()
        )
          throw new WorkspaceMockError("NOT_FOUND", "업로드가 만료되거나 삭제됐어요.");
        return mockResponse(upload.session);
      }
      if (request.method === "PUT" && kind?.startsWith("parts/")) {
        const index = Number(match[4]);
        if (
          !upload ||
          upload.caseId !== id ||
          upload.ownerId !== owner ||
          upload.session.uploadSession !== request.headers.get("x-upload-session") ||
          record.status !== "uploading" ||
          Date.parse(upload.session.expiresAt) <= Date.now() ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= 120 ||
          request.headers.get("content-type") !== "application/octet-stream"
        )
          throw new WorkspaceMockError("CONFLICT", "업로드 세션을 확인해 주세요.");
        consumeMockFault(runtime, "files.uploadPart");
        const bytes = await request.blob();
        if (
          !bytes.size ||
          bytes.size > V2_LIMITS.chunkBytes ||
          index * V2_LIMITS.chunkBytes + bytes.size > record.sizeBytes
        )
          throw new WorkspaceMockError("VALIDATION_ERROR", "업로드 크기를 확인해 주세요.");
        const contentHash = await blobHash(bytes),
          partKey = `${owner}/${id}/${fileId}/part-${index}`;
        if (upload.parts[index] && upload.parts[index]?.contentHash !== contentHash)
          throw new WorkspaceMockError("CONFLICT", "업로드 내용이 달라졌어요.");
        await originals(partKey, bytes);
        try {
          return runtime.update((value) => {
            requireMockCase(value, id, true);
            const current = value.fileUploads?.[fileId];
            if (
              value.session.user?.id !== owner ||
              !current ||
              !value.files[id]?.some((file) => file.id === fileId)
            )
              throw new WorkspaceMockError("NOT_FOUND", "자료가 삭제됐어요.");
            current.parts[index] = { index, byteLength: bytes.size, contentHash };
            return mockResponse({ index, byteLength: bytes.size, contentHash });
          });
        } catch (cause) {
          await originals(partKey, null);
          throw cause;
        }
      }
      if (request.method === "POST" && kind === "complete") {
        const input = v2UploadCompleteRequestSchema.parse(await request.json());
        if (
          !upload ||
          upload.ownerId !== owner ||
          upload.caseId !== id ||
          upload.session.uploadSession !== input.uploadSession ||
          input.manifest.byteLength !== record.sizeBytes
        )
          throw new WorkspaceMockError("CONFLICT", "업로드 요청을 확인해 주세요.");
        if (record.status !== "uploading")
          return mockResponse({
            fileId,
            revision: 1,
            status: record.status,
            processingQueued: record.status === "processing",
          });
        if (input.expectedRevision !== state.cases[id]?.revision)
          throw new WorkspaceMockError("CONFLICT", "최신 상태를 확인해 주세요.");
        consumeMockFault(runtime, "files.complete");
        const parts: Blob[] = [];
        for (const part of input.manifest.parts) {
          if (JSON.stringify(upload.parts[part.index]) !== JSON.stringify(part))
            throw new WorkspaceMockError("CONFLICT", "업로드 조각을 다시 확인해 주세요.");
          const bytes = await originals(`${owner}/${id}/${fileId}/part-${part.index}`);
          if (!bytes)
            throw new WorkspaceMockError("UNAVAILABLE", "업로드 조각을 다시 보내 주세요.", true);
          parts.push(bytes);
        }
        const original = new Blob(parts, { type: record.mimeType });
        if (
          (await blobHash(original)) !== input.manifest.contentHash ||
          original.size !== record.sizeBytes
        )
          throw new WorkspaceMockError("VALIDATION_ERROR", "원본 내용을 확인해 주세요.");
        await originals(`${owner}/${id}/${fileId}`, original);
        const extracted =
          record.mimeType === "text/plain" || /\.txt$/i.test(record.name)
            ? (await original.text()).slice(0, 20000)
            : "이 자료의 실제 추출은 수행되지 않았어요. 원본 확인으로 파일을 검토해 주세요.";
        let result: Response;
        try {
          result = runtime.update((value) => {
            const latest = requireMockCase(value, id, true);
            const file = value.files[id]?.find((item) => item.id === fileId);
            if (!file || value.session.user?.id !== owner)
              throw new WorkspaceMockError("NOT_FOUND", "자료가 삭제됐어요.");
            if (file.status !== "uploading" || latest.revision !== input.expectedRevision)
              throw new WorkspaceMockError("CONFLICT", "최신 자료 상태를 확인해 주세요.");
            file.status = "processing";
            file.canRetry = false;
            file.coverage = "API 예시 처리 중 · 실제 OCR·ASR·영상 처리는 수행되지 않아요.";
            value.fileExtractions ??= {};
            value.fileExtractions[fileId] = extracted;
            value.fileProcessing ??= {};
            value.fileProcessing[fileId] = {
              at: Date.now() + 1500,
              failed: upload.failedProcessing,
            };
            touchMockCase(value, id);
            return mockResponse({
              fileId,
              revision: 1,
              status: "uploaded",
              processingQueued: true,
            });
          });
        } catch (cause) {
          await originals(`${owner}/${id}/${fileId}`, null);
          throw cause;
        }
        for (const part of input.manifest.parts)
          await originals(`${owner}/${id}/${fileId}/part-${part.index}`, null);
        return result;
      }
      if (request.method === "POST" && kind === "retry") {
        consumeMockFault(runtime, "files.retry");
        return runtime.update((value) => {
          requireMockCase(value, id, true);
          const file = ensureMockWorkspace(value, id).files.find((item) => item.id === fileId);
          if (
            !file ||
            (file.status !== "failed" && !(file.status === "waiting" && file.canStartProcessing))
          )
            throw new WorkspaceMockError("CONFLICT", "다시 처리가 가능한 자료인지 확인해 주세요.");
          file.canStartProcessing = false;
          file.status = "processing";
          file.canRetry = false;
          file.coverage = "API 예시 재처리 중";
          value.fileProcessing ??= {};
          value.fileProcessing[fileId] = { at: Date.now() + 1000, failed: false };
          touchMockCase(value, id);
          return mockResponse(file);
        });
      }
      if (request.method === "DELETE" && !kind) {
        consumeMockFault(runtime, "files.remove");
        const archives = Object.entries(runtime.read().reportZips ?? {}).filter(
          ([, archive]) =>
            archive.ownerId === owner && archive.caseId === id && archive.fileIds.includes(fileId),
        );
        for (const [archiveId] of archives)
          await originals(`${owner}/${id}/report-zip/${archiveId}`, null);
        await originals(`${owner}/${id}/${fileId}`, null);
        for (const part of Object.values(upload?.parts ?? {}))
          await originals(`${owner}/${id}/${fileId}/part-${part.index}`, null);
        return runtime.update((value) => {
          requireMockCase(value, id);
          value.files[id] = value.files[id]?.filter((file) => file.id !== fileId) ?? [];
          for (const [archiveId, archive] of archives) {
            delete value.reportZips?.[archiveId];
            const historical = value.reportHistory?.[archive.reportId];
            if (historical?.savedZip?.id === archiveId) delete historical.savedZip;
            const report = value.reports?.[id];
            if (report?.savedZip?.id === archiveId) delete report.savedZip;
          }
          delete value.fileProcessing?.[fileId];
          delete value.fileUploads?.[fileId];
          delete value.fileExtractions?.[fileId];
          delete (value.fileReviews as Record<string, unknown> | undefined)?.[fileId ?? ""];
          value.fileReviewReceipts = {};
          for (const [key, replay] of Object.entries(value.fileUploadReceipts ?? {}))
            if (replay.fileId === fileId) delete value.fileUploadReceipts?.[key];
          if (value.reports?.[id])
            value.reports[id].excludedFileIds = value.reports[id].excludedFileIds.filter(
              (item) => item !== fileId,
            );
          touchMockCase(value, id);
          return mockResponse({ deleted: true }, 202);
        });
      }
      return mockResponse({ error: { code: "NOT_FOUND", retryable: false } }, 404);
    } catch (cause) {
      return mockFailure(cause);
    }
  };
}
