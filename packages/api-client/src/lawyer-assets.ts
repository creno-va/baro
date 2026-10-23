import type { SessionScope } from "@baro/client-core";
import { opaqueIdSchema } from "@baro/contracts/common";
import {
  v2HashSchema,
  v2LawyerAssetUploadRequestSchema,
  v2PortfolioAssetSchema,
} from "@baro/contracts/v2";
import { EXPECTED_PROFILE_HEADER } from "@baro/contracts/v2/self-profile";
import { z } from "zod";
import { decode } from "./decode";
import { ApiError } from "./errors";
import type { UploadMetadata } from "./files";
import type { DomainRequest, DomainRequestInit, ReportArtifact } from "./reports";

export type LawyerAssetView = {
  id: string;
  revision: number;
  status: string;
  purpose?: string;
  kind: "image" | "pdf";
};
export interface LawyerUploadReader {
  fingerprint(): Promise<string>;
  body(): Promise<{ body: BodyInit; byteLength: number }>;
  close(): Promise<void> | void;
}
/** legacyKey is read/remove compatibility for the browser's existing uncertain records only. */
export interface LawyerUploadStorage {
  getItem(key: string, legacyKey?: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string, legacyKey?: string): Promise<void> | void;
}
/** Opaque client recovery facts only; native storage can validate without a second schema. */
export const lawyerUploadAttemptSchema = z.strictObject({
  key: z.uuid(),
  expectedRevision: z.number().int().positive(),
  assetId: opaqueIdSchema.optional(),
  assetRevision: z.number().int().positive().optional(),
});
export type LawyerUploadAttempt = z.infer<typeof lawyerUploadAttemptSchema>;
type Attempt = LawyerUploadAttempt;
const states = new WeakMap<SessionScope, { records: Map<string, Attempt>; io: Promise<unknown> }>();
const envelope = z.object({
  assetId: opaqueIdSchema,
  revision: z.number(),
  value: z.union([
    v2PortfolioAssetSchema,
    z.object({ request: z.object({ mediaType: z.string() }) }),
  ]),
});
function assetView(raw: unknown): LawyerAssetView {
  const row = decode(envelope, raw);
  return {
    id: row.assetId,
    revision: row.revision,
    status: "status" in row.value ? row.value.status : "reserved",
    kind:
      "kind" in row.value
        ? row.value.kind
        : row.value.request.mediaType === "application/pdf"
          ? "pdf"
          : "image",
  };
}
export function validateLawyerUpload(file: UploadMetadata, purpose: "profile_photo" | "portfolio") {
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 100_000_000 ||
    (purpose === "profile_photo" && file.type === "application/pdf") ||
    !v2LawyerAssetUploadRequestSchema.safeParse({
      name: file.name.trim(),
      mediaType: file.type,
      byteLength: file.size,
      purpose,
    }).success
  )
    throw new ApiError(
      "VALIDATION_ERROR",
      "사진은 JPEG·PNG·WebP, 자료는 이미지·PDF 100MB 이하로 선택해 주세요.",
    );
}
type Persistence =
  | { persistence: "required"; storage: LawyerUploadStorage }
  | { persistence?: "optional"; storage?: LawyerUploadStorage };
export function createLawyerAssetsClient<Source extends UploadMetadata, Download>(
  dependencies: {
    scope: SessionScope;
    signal?: AbortSignal;
    request: DomainRequest;
    open: (source: Source, signal: AbortSignal) => Promise<LawyerUploadReader>;
    uploadContent: (
      path: string,
      input: { body: BodyInit; byteLength: number; revision: number; signal: AbortSignal },
    ) => Promise<unknown>;
    /** Optional native HTTP port, called before reader.body(). No JS whole-file body or fallback.
     * The adapter must enforce immutable source size/hash, owner/epoch and descriptor cleanup. */
    uploadContentFromSource?: (
      path: string,
      input: {
        source: Source;
        byteLength: number;
        contentHash: string;
        revision: number;
        signal: AbortSignal;
      },
    ) => Promise<unknown>;
    download: (
      path: string,
      init: DomainRequestInit,
    ) => Promise<Pick<ReportArtifact<Download>, "value" | "discard">>;
    fingerprintText: (text: string) => Promise<string>;
    newKey: () => string;
  } & Persistence,
) {
  const generation = dependencies.scope.snapshot(),
    signal = dependencies.signal
      ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
      : dependencies.scope.signal();
  const ensure = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const unavailable = () =>
    new ApiError(
      "UNAVAILABLE",
      "업로드 복구 정보를 기기에 보관하지 못했어요. 다시 시도해 주세요.",
      true,
    );
  const request: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    ensure();
    try {
      const result = await dependencies.request<T>(path, { ...init, signal });
      ensure();
      return result;
    } catch (error) {
      ensure();
      throw error;
    }
  };
  let stored = states.get(dependencies.scope);
  if (!stored) {
    stored = { records: new Map(), io: Promise.resolve() };
    states.set(dependencies.scope, stored);
  }
  const memory = stored;
  // Stable across generation changes. Old in-flight storage IO finishes before a new generation reads/writes.
  const io = async <T>(task: () => Promise<T>): Promise<T> => {
    const result = memory.io
      .catch(() => {})
      .then(() => {
        ensure();
        return task();
      });
    memory.io = result;
    const value = await result;
    ensure();
    return value;
  };
  const remember = (key: string, legacy: string, attempt: Attempt | null) =>
    io(async () => {
      if (attempt) memory.records.set(key, { ...attempt });
      else memory.records.delete(key);
      try {
        if (attempt) {
          const value = JSON.stringify(attempt);
          await dependencies.storage?.setItem(key, value);
          if (
            dependencies.persistence === "required" &&
            (await dependencies.storage.getItem(key)) !== value
          )
            throw unavailable();
        } else {
          await dependencies.storage?.removeItem(key, legacy);
          if (
            dependencies.persistence === "required" &&
            (await dependencies.storage.getItem(key)) !== null
          )
            throw unavailable();
        }
      } catch {
        if (dependencies.persistence === "required") throw unavailable();
      }
    });
  const recalled = (key: string, legacy: string) =>
    io(async () => {
      let result = memory.records.get(key);
      try {
        const raw = await dependencies.storage?.getItem(key, legacy);
        if (raw) {
          const parsed = lawyerUploadAttemptSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) throw unavailable();
          result = parsed.data;
        }
      } catch {
        if (dependencies.persistence === "required") throw unavailable();
      }
      return result ? { ...result } : undefined;
    });
  const active = new Map<string, Promise<LawyerAssetView>>();
  return {
    async upload(
      profileId: string,
      source: Source,
      purpose: "profile_photo" | "portfolio",
    ): Promise<LawyerAssetView> {
      ensure();
      validateLawyerUpload(source, purpose);
      const metadata = { name: source.name.trim(), size: source.size, type: source.type };
      let reader: LawyerUploadReader | undefined;
      try {
        reader = await dependencies.open(source, signal);
        ensure();
        const hash = decode(v2HashSchema, await reader.fingerprint());
        ensure();
        const identity = JSON.stringify([
          profileId,
          purpose,
          metadata.name,
          metadata.type,
          metadata.size,
          hash,
        ]);
        const key = `baro-lawyer-upload-v2:${decode(v2HashSchema, await dependencies.fingerprintText(identity))}`;
        const legacy = `baro-lawyer-upload-v1:${identity}`;
        ensure();
        // Every caller checks current ownership before joining an existing upload, including ambient cookies.
        const mine = decode(
          z.object({ profileId: z.string(), revision: z.number().int().positive() }),
          await request("/api/v2/me/lawyer/profile"),
        );
        if (mine.profileId !== profileId)
          throw new ApiError("NOT_FOUND", "본인 프로필만 변경할 수 있어요.");
        const pending = active.get(key);
        if (pending) return await pending;
        const currentReader = reader;
        const run = async () => {
          const attempt = (await recalled(key, legacy)) ?? {
            key: dependencies.newKey(),
            expectedRevision: mine.revision,
          };
          if (!lawyerUploadAttemptSchema.safeParse(attempt).success) throw unavailable();
          await remember(key, legacy, attempt);
          let reserved: LawyerAssetView | undefined;
          if (attempt.assetId) {
            try {
              const value = decode(
                envelope.shape.value,
                await request(
                  `/api/v2/me/lawyer/portfolio-assets/${encodeURIComponent(attempt.assetId)}`,
                ),
              );
              reserved = assetView({
                assetId: attempt.assetId,
                revision: "revision" in value ? value.revision : attempt.assetRevision,
                value,
              });
            } catch (error) {
              if (error instanceof ApiError && error.code === "NOT_FOUND")
                await remember(key, legacy, null);
              throw error;
            }
          }
          if (!reserved) {
            try {
              reserved = assetView(
                await request("/api/v2/me/lawyer/portfolio-assets", {
                  method: "POST",
                  headers: {
                    "if-match": String(attempt.expectedRevision),
                    "idempotency-key": attempt.key,
                    [EXPECTED_PROFILE_HEADER]: encodeURIComponent(profileId),
                  },
                  body: {
                    purpose,
                    name: metadata.name,
                    byteLength: metadata.size,
                    mediaType: metadata.type,
                  },
                }),
              );
            } catch (error) {
              if (error instanceof ApiError && error.code === "CONFLICT")
                await remember(key, legacy, null);
              throw error;
            }
          }
          if (reserved.status === "deleting")
            throw new ApiError("NOT_FOUND", "자료가 삭제 중이에요. 자료 상태를 확인해 주세요.");
          attempt.assetId = reserved.id;
          attempt.assetRevision = reserved.revision;
          await remember(key, legacy, attempt);
          if (reserved.status !== "reserved") {
            await remember(key, legacy, null);
            return { ...reserved, purpose };
          }
          const path = `/api/v2/me/lawyer/assets/${encodeURIComponent(reserved.id)}/content`;
          let raw: unknown;
          if (dependencies.uploadContentFromSource) {
            raw = await dependencies.uploadContentFromSource(path, {
              source,
              byteLength: metadata.size,
              contentHash: hash,
              revision: reserved.revision,
              signal,
            });
          } else {
            const body = await currentReader.body();
            ensure();
            if (body.byteLength !== metadata.size)
              throw new ApiError(
                "VALIDATION_ERROR",
                "선택한 파일이 변경됐어요. 다시 선택해 주세요.",
              );
            raw = await dependencies.uploadContent(path, {
              ...body,
              revision: reserved.revision,
              signal,
            });
          }
          ensure();
          const result = { ...assetView(raw), purpose };
          await remember(key, legacy, null);
          return result;
        };
        const task = run().finally(() => {
          if (active.get(key) === task) active.delete(key);
        });
        active.set(key, task);
        return await task;
      } catch (error) {
        ensure();
        throw error;
      } finally {
        // Cleanup cannot turn an acknowledged upload into a retry/duplicate.
        try {
          await reader?.close();
        } catch {
          /* The platform owns cleanup diagnostics. */
        }
        ensure();
      }
    },
    async list(): Promise<LawyerAssetView[]> {
      const items: LawyerAssetView[] = [],
        seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const page = decode(
          z.object({
            items: z.array(
              z.object({
                id: z.string(),
                revision: z.number(),
                status: z.string(),
                purpose: z.string(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
          await request(`/api/v2/me/lawyer/self-profile/assets${query}`),
        );
        items.push(...page.items.map((item) => ({ ...item, kind: "image" as const })));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new ApiError("UNAVAILABLE", "자료 목록을 다시 불러와 주세요.", true);
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
    async remove(assetId: string, revision: number): Promise<void> {
      await request(`/api/v2/me/lawyer/portfolio-assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        body: { expectedRevision: revision },
      });
    },
    async blob(profileId: string, assetId: string, privateRead = false): Promise<Download> {
      if (privateRead) ensure();
      const path = privateRead
        ? `/api/v2/me/lawyer/self-profile/assets/${encodeURIComponent(assetId)}/content`
        : `/api/v2/lawyers/self-service/${encodeURIComponent(profileId)}/assets/${encodeURIComponent(assetId)}`;
      let artifact: Pick<ReportArtifact<Download>, "value" | "discard"> | undefined;
      try {
        artifact = await dependencies.download(path, privateRead ? { signal } : {});
        if (privateRead) ensure();
        return artifact.value;
      } catch (error) {
        try {
          await artifact?.discard();
        } catch {
          /* Never expose an obsolete private handle. */
        }
        if (privateRead) ensure();
        throw error;
      }
    },
  };
}
