import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import {
  V2_LIMITS,
  type V2Coverage,
  v2FileSchema,
  v2UploadSessionSchema,
} from "../../contracts/v2";
import type { FileView } from "./types";
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
});
const metadataSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  name: z.string(),
  declaredMediaType: z.string(),
  byteLength: z.number(),
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
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateUpload(file: File) {
  const media =
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    /\.(mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv)$/i.test(file.name);
  const limit = media ? V2_LIMITS.mediaBytes : V2_LIMITS.documentImageBytes;
  if (!file.size || file.size > limit)
    throw workspaceError(
      "VALIDATION_ERROR",
      `파일은 비어 있지 않아야 하며 ${media ? 300 : 50} MB 이하여야 해요.`,
    );
  if (
    !/\.(txt|pdf|doc|docx|hwp|hwpx|xls|xlsx|ppt|pptx|jpg|jpeg|png|webp|gif|bmp|tiff|heic|mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|avi|mkv)$/i.test(
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
      if (views.success) return views.data;
      const rows = z.array(metadataSchema).parse(raw);
      for (const row of rows) {
        revisions.set(`${id}:${row.id}`, row.revision);
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
    const probe = await request(`${base(id)}/files`, { method: "OPTIONS" });
    // Shared mock transport advertises multipart support; real upload uses the existing chunk contract.
    if (probe.headers.get("x-baro-mock") === "true") {
      const form = new FormData();
      form.set("file", file);
      return fileViewSchema.parse(
        await workspaceJson(request, `${base(id)}/files`, {
          method: "POST",
          body: form,
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
      );
    }
    const expectedRevision = await workspaceRevision(id);
    const input = {
      name: file.name,
      byteLength: file.size,
      mediaType: file.type || "application/octet-stream",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    };
    const session = v2UploadSessionSchema.parse(
      await workspaceJson(request, `${base(id)}/files`, {
        ...workspaceMutation(`${base(id)}/files`, input),
        headers: {
          ...workspaceMutation(`${base(id)}/files`, input).headers,
          "if-match": String(expectedRevision),
        },
      }),
    );
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
    const manifest = { byteLength: file.size, contentHash: await hash(file), parts };
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
    return result;
  }
  return {
    list,
    upload,
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
      await list(id);
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
      return list(id);
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
