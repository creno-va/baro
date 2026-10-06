import { validateUpload } from "../files";
import type { FileView } from "../types";
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
export function createFilesMock(runtime: WorkspaceMockRuntime) {
  return async function handleFilesMock(request: Request): Promise<Response | null> {
    const match = /^\/api\/v2\/cases\/([^/]+)\/files(?:\/([^/]+)(?:\/(content|retry))?)?$/.exec(
      new URL(request.url).pathname,
    );
    if (!match) return null;
    const id = decodeURIComponent(match[1] ?? ""),
      fileId = match[2] ? decodeURIComponent(match[2]) : null,
      kind = match[3];
    try {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: { "x-baro-mock": "true" } });
      const state = runtime.read();
      requireMockCase(state, id, request.method !== "GET");
      const owner = state.session.user?.id;
      if (!owner) throw new WorkspaceMockError("UNAUTHENTICATED", "로그인이 필요해요.");
      if (request.method === "GET" && !fileId) {
        consumeMockFault(runtime, "files.list");
        return runtime.update((value) => {
          return mockResponse(ensureMockWorkspace(value, id).files);
        });
      }
      const record = state.files?.[id]?.find((file) => file.id === fileId);
      if (request.method === "GET" && fileId && kind === "content") {
        if (!record) throw new WorkspaceMockError("NOT_FOUND", "자료를 찾을 수 없어요.");
        const blob = await mockOriginalStore(`${owner}/${id}/${fileId}`);
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
        const form = await request.formData(),
          file = form.get("file");
        if (!(file instanceof File))
          throw new WorkspaceMockError("VALIDATION_ERROR", "파일을 선택해 주세요.");
        try {
          validateUpload(file);
        } catch (cause) {
          throw new WorkspaceMockError(
            "VALIDATION_ERROR",
            cause instanceof Error ? cause.message : "파일을 확인해 주세요.",
          );
        }
        const fault = consumeMockFault(runtime, "files.upload");
        const newId = crypto.randomUUID();
        const key = `${owner}/${id}/${newId}`;
        await mockOriginalStore(key, file);
        const extracted =
          file.type === "text/plain" || /\.txt$/i.test(file.name)
            ? (await file.text()).slice(0, 20000)
            : "이 자료의 실제 추출은 수행되지 않았어요. 원본 확인으로 파일을 검토해 주세요.";
        try {
          return runtime.update((value) => {
            requireMockCase(value, id, true);
            ensureMockWorkspace(value, id);
            const record: FileView = {
              id: newId,
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
              status: "processing",
              coverage: "API 예시 처리 중 · 실제 OCR·ASR·영상 처리는 수행되지 않아요.",
              extractedText: extracted,
            };
            value.files[id]?.push(record);
            value.fileProcessing ??= {};
            value.fileProcessing[newId] = {
              at: Date.now() + 1500,
              failed: fault === "file_failed",
            };
            touchMockCase(value, id);
            return mockResponse(record, 201);
          });
        } catch (cause) {
          await mockOriginalStore(key, null);
          throw cause;
        }
      }
      if (!record) throw new WorkspaceMockError("NOT_FOUND", "자료를 찾을 수 없어요.");
      if (request.method === "POST" && kind === "retry") {
        consumeMockFault(runtime, "files.retry");
        return runtime.update((value) => {
          requireMockCase(value, id, true);
          const file = ensureMockWorkspace(value, id).files.find((item) => item.id === fileId);
          if (file?.status !== "failed")
            throw new WorkspaceMockError("CONFLICT", "실패한 자료만 다시 처리할 수 있어요.");
          file.status = "processing";
          file.coverage = "API 예시 재처리 중";
          value.fileProcessing ??= {};
          value.fileProcessing[file.id] = { at: Date.now() + 1000, failed: false };
          touchMockCase(value, id);
          return mockResponse(file);
        });
      }
      if (request.method === "DELETE" && !kind) {
        consumeMockFault(runtime, "files.remove");
        await mockOriginalStore(`${owner}/${id}/${fileId}`, null);
        return runtime.update((value) => {
          requireMockCase(value, id, true);
          value.files[id] = value.files[id]?.filter((file) => file.id !== fileId) ?? [];
          if (fileId) delete value.fileProcessing?.[fileId];
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
