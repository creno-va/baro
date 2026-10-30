import { expect } from "bun:test";
import { createFilesClient, type UploadMetadata, type WorkspaceTransport } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import type { FILE_TARGET_UPLOAD_CONSISTENCY } from "@baro/contracts/v2";
import { Hono } from "hono";
import type { PrivateDownload } from "../../apps/mobile/src/platform/files/download";
import { createNativeUploadReader } from "../../apps/mobile/src/platform/files/upload-reader";
import { createCaseOperationStorage } from "../../apps/mobile/src/platform/storage/case-operations";
import type { ApiEnvironment } from "../../src/server/api/errors";
import { createFilesApi } from "../../src/server/api/v2/files";
import { createWorkspacesApi } from "../../src/server/api/v2/workspaces";
import { createFilesService, type PrivateBucket } from "../../src/server/modules/files/service";
import { customerWorkspaceFixture } from "./customer-workspace";

const fingerprint = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
export async function uploadRecoveryHttpFixture(
  options: { onProbe?: () => void | Promise<void>; bytes?: Uint8Array<ArrayBuffer> } = {},
) {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  const bytes = options.bytes ?? new TextEncoder().encode("합성 비공개 원본 byte fixture"),
    objects = new Map<string, Uint8Array<ArrayBuffer>>();
  let now = f.now;
  const source: UploadMetadata = { name: "합성.txt", size: bytes.byteLength, type: "text/plain" };
  const bucket = {
    async put(key: string, value: Uint8Array<ArrayBuffer>) {
      objects.set(key, value.slice());
      return { key, size: value.byteLength };
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as PrivateBucket;
  const deps = {
    bucket,
    clock: () => now,
    testOnlyUnmeteredStorage: true as const,
    probe: async (input: { byteLength: number; open(): ReadableStream<Uint8Array> }) => {
      const body = new Uint8Array(await new Response(input.open()).arrayBuffer());
      expect(body).toEqual(bytes);
      await options.onProbe?.();
      return {
        category: "document" as const,
        format: "txt" as const,
        byteLength: input.byteLength,
        pageCount: 1,
      };
    },
  };
  const env: Env = {
    ...f.owner.env,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
  };
  const app = new Hono<ApiEnvironment>()
    .route("/api/v2/cases", createWorkspacesApi())
    .route(
      "/api/v2/cases",
      createFilesApi({ testOnlyMissingD1Meta: true, dependencies: async () => deps }),
    );
  let cookie = f.owner.cookie;
  const transport: WorkspaceTransport = async (path, init = {}) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          cookie,
          origin: env.BETTER_AUTH_URL,
        },
      },
      env,
    );
  const records = new Map<string, string>();
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_upload_operations",
    fingerprint,
    storage: {
      get: async (key) => records.get(key) ?? null,
      set: async (key, value) => {
        records.set(key, value);
      },
      remove: async (key) => {
        records.delete(key);
      },
    },
  });
  const receipts: string[] = [];
  const client = (
    request = transport,
    recover = true,
    download: (response: Response, signal: AbortSignal) => Promise<PrivateDownload> = async () => {
      throw new Error("UPLOAD_MUST_NOT_DOWNLOAD");
    },
    options: {
      signal?: AbortSignal;
      ownerId?: string;
      onAcknowledged?: (id: string) => void;
      completionConsistency?: typeof FILE_TARGET_UPLOAD_CONSISTENCY;
      uploadConcurrency?: 1 | 2 | 3;
    } = {},
  ) =>
    createFilesClient<UploadMetadata, PrivateDownload>({
      scope: createSessionScope(),
      request,
      uploadConcurrency: options.uploadConcurrency ?? 1,
      ...(options.completionConsistency
        ? { completionConsistency: options.completionConsistency }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(recover
        ? { recovery: { ownerId: options.ownerId ?? f.owner.userId, storage, fingerprint } }
        : {}),
      newKey: () => crypto.randomUUID(),
      onUploadAcknowledged: (id) => {
        receipts.push(id);
        options.onAcknowledged?.(id);
      },
      openUpload: async (_file, signal) =>
        createNativeUploadReader(
          {
            size: bytes.byteLength,
            open: () => {
              let offset = 0;
              return {
                size: bytes.byteLength,
                get offset() {
                  return offset;
                },
                set offset(value) {
                  offset = value ?? 0;
                },
                async readBytes(count) {
                  const value = bytes.slice(offset, offset + count);
                  offset += value.byteLength;
                  return value;
                },
                close() {},
              };
            },
          },
          signal,
        ),
      download,
    });
  return {
    ...f,
    bytes,
    source,
    records,
    receipts,
    client,
    transport,
    cookie: (value: string) => {
      cookie = value;
    },
    fileService: createFilesService(f.core, { ...deps, environment: "preview" }),
    setNow: (value: string) => {
      now = value;
    },
  };
}
