import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import {
  V2_LIMITS,
  type V2Coverage,
  v2CoverageSchema,
  v2FileObservationSchema,
  v2FileSchema,
  v2ObservationEditRequestSchema,
  v2UploadSessionSchema,
} from "../../contracts/v2";
import type { FileReviewProgress, FileReviewView, FileView } from "./types";
import {
  type WorkspaceTransport,
  workspaceError,
  workspaceJson,
  workspaceMutation,
  workspaceResponse,
} from "./workspace";

export const fileViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  status: z.enum(["uploading", "processing", "ready", "failed", "waiting"]),
  coverage: z.string(),
  extractedText: z.string(),
  canStartProcessing: z.boolean().optional(),
  canRetry: z.boolean().optional(),
  uploadContentHash: z.string().optional(),
});
const metadataSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  name: z.string(),
  declaredMediaType: z.string(),
  byteLength: z.number(),
  contentHash: z.string().optional(),
  canRetry: z.boolean().optional(),
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
async function hash(blob: Blob) {
  const hash = sha256.create(),
    reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
  } finally {
    reader.releaseLock();
  }
}
export function validateUpload(file: Pick<File, "name" | "size" | "type">) {
  if (
    !file.name.trim() ||
    file.name.length > 255 ||
    file.name.includes("/") ||
    file.name.includes("\\") ||
    [...file.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw workspaceError(
      "VALIDATION_ERROR",
      "파일 이름에 경로나 제어 문자가 포함돼 있어요. 이름을 바꾼 뒤 다시 선택해 주세요.",
    );
  const media =
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    /\.(mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv)$/i.test(file.name);
  const limit = media ? V2_LIMITS.mediaBytes : V2_LIMITS.documentImageBytes;
  if (!file.size || file.size > limit)
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
export function createFilesApi(request: WorkspaceTransport) {
  const revisions = new Map<string, number>();
  const uploadHashes = new Map<string, string | undefined>();
  const reviews = new Map<string, RequestInit>();
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
  async function list(id: string): Promise<FileView[]> {
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
        return views.data;
      }
      const rows = z.array(metadataSchema).parse(raw);
      for (const row of rows) {
        revisions.set(`${id}:${row.id}`, row.revision);
        uploadHashes.set(`${id}:${row.id}`, row.contentHash);
        if (row.status === "deleting") continue;
        const file: FileView = {
          id: row.id,
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
                  : row.status === "processing"
                    ? "processing"
                    : "waiting",
          coverage: "처리 결과는 아직 확인할 수 없어요.",
          extractedText: "",
          canStartProcessing: row.status === "uploaded",
          canRetry: row.canRetry ?? false,
        };
        if (row.status === "ready") {
          const detail = await request(`${base(id)}/files/${encodeURIComponent(row.id)}`);
          if (detail.ok) {
            const parsed = v2FileSchema.parse(await detail.json());
            file.coverage = coverageLabel(parsed.coverage);
            file.extractedText = parsed.observations
              .filter((item) => item.included)
              .map((item) => `${item.certainty === "uncertain" ? "[확인 필요] " : ""}${item.text}`)
              .join("\n\n");
          } else if (detail.status !== 404) await workspaceResponse(detail);
        }
        output.push(file);
      }
      cursor = rows.length === 20 ? rows.at(-1)?.id : undefined;
    } while (cursor && output.length < 1000);
    return output;
  }
  async function upload(id: string, file: File): Promise<FileView> {
    validateUpload(file);
    const contentHash = await hash(file);
    const identity = `${id}:${file.name}:${file.size}:${contentHash}`;
    const attempt = uploads.get(identity) ?? {
      expectedRevision: await workspaceRevision(id),
      key: crypto.randomUUID(),
    };
    uploads.set(identity, attempt);
    const input = {
      name: file.name,
      byteLength: file.size,
      mediaType: file.type.split(";")[0]?.trim().toLowerCase() || "application/octet-stream",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      contentHash,
    };
    const current = await list(id);
    if (attempt.session && !current.some((item) => item.id === attempt.session?.fileId)) {
      uploads.delete(identity);
      return upload(id, file);
    }
    let session = attempt.session;
    if (!session) {
      const pending = current.find(
        (item) =>
          item.status === "uploading" &&
          item.name === file.name &&
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
    const existing = (await list(id)).find((item) => item.id === session.fileId);
    if (existing && existing.status !== "uploading") {
      uploads.delete(identity);
      return existing;
    }
    const parts = [];
    for (let start = 0, index = 0; start < file.size; start += session.chunkBytes, index++) {
      const chunk = file.slice(start, start + session.chunkBytes);
      const part = { index, byteLength: chunk.size, contentHash: await hash(chunk) };
      await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(session.fileId)}/parts/${index}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "x-upload-session": session.uploadSession,
          },
          body: chunk,
        },
      );
      parts.push(part);
    }
    const manifest = { byteLength: file.size, contentHash, parts };
    await workspaceJson(
      request,
      `${base(id)}/files/${encodeURIComponent(session.fileId)}/complete`,
      workspaceMutation(`${base(id)}/files/${encodeURIComponent(session.fileId)}/complete`, {
        expectedRevision: await workspaceRevision(id),
        uploadSession: session.uploadSession,
        manifest,
      }),
    );
    const result = (await list(id)).find((item) => item.id === session.fileId);
    if (!result) throw workspaceError("UNAVAILABLE", "파일 저장 상태를 다시 확인해 주세요.", true);
    uploads.delete(identity);
    return result;
  }
  return {
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
    async retry(id: string, fileId: string) {
      await list(id);
      const value = await workspaceJson(
        request,
        `${base(id)}/files/${encodeURIComponent(fileId)}/retry`,
        workspaceMutation(`${base(id)}/files/${encodeURIComponent(fileId)}/retry`, {
          expectedRevision: await workspaceRevision(id),
          fileRevision: revisions.get(`${id}:${fileId}`) ?? 1,
        }),
      );
      const mock = fileViewSchema.safeParse(value);
      if (mock.success) return mock.data;
      const found = (await list(id)).find((file) => file.id === fileId);
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
      return (
        await workspaceResponse(
          await request(`${base(id)}/files/${encodeURIComponent(fileId)}/content`),
        )
      ).blob();
    },
  };
}
