import {
  createLawyersClient,
  createLawyerAssetsClient as createSharedLawyerAssetsClient,
  type DomainRequest,
  type LawyerAssetView,
  type LawyerView,
  validateLawyerUpload,
} from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import type { DirectoryPage } from "../../contracts/v2";
import { browserSessionScope } from "./context";
import { apiMode, apiRequest, responseError, request as sharedRequest } from "./core";

export type { LawyerAssetView, LawyerView } from "@baro/api-client";
export { fromVerified, lawyerErrorMessage, rotateLawyers } from "@baro/api-client";
export { ApiError as LawyerApiError } from "./core";
export type LawyerFilters = { region?: string; practiceArea?: string; query?: string };
async function checkedAssetRequest(path: string, init: RequestInit = {}) {
  const response = await apiRequest(path, init);
  if (!response.ok) throw await responseError(response);
  return response;
}
function jsonRequest(send: typeof checkedAssetRequest): DomainRequest {
  return async <T>(path: string, init = {}) => {
    const options: import("@baro/api-client").DomainRequestInit = init;
    const response = await send(path, {
      cache: "no-store",
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
}
const real = createSessionBoundClient(browserSessionScope, () =>
  createLawyersClient({
    scope: browserSessionScope,
    request: jsonRequest(checkedAssetRequest),
  }),
);
async function adapter() {
  if (apiMode === "mock") {
    if (import.meta.env.PUBLIC_API_MODE === "mock") await import("./mock/lawyers");
    return mockTransport;
  }
  return real;
}
const mockTransport = {
  listPage: (filters: LawyerFilters = {}, cursor?: string, signal?: AbortSignal) =>
    sharedRequest<DirectoryPage>(
      "lawyers.listPage",
      { filters, cursor },
      { ...(signal ? { signal } : {}) },
    ),
  list: (filters: LawyerFilters = {}, signal?: AbortSignal) =>
    sharedRequest<LawyerView[]>("lawyers.list", filters, { ...(signal ? { signal } : {}) }),
  get: (id: string) => sharedRequest<LawyerView>("lawyers.get", { id }),
  getMine: () => sharedRequest<LawyerView>("lawyers.getMine"),
  saveMine: (profile: LawyerView) => sharedRequest<LawyerView>("lawyers.saveMine", profile),
  async publishMine(published: boolean, current?: Pick<LawyerView, "id" | "revision">) {
    const mine = current ?? (await sharedRequest<LawyerView>("lawyers.getMine"));
    return sharedRequest<LawyerView>("lawyers.publishMine", {
      published,
      profileId: mine.id,
      expectedRevision: mine.revision,
    });
  },
};
export const lawyers = {
  async listPage(filters: LawyerFilters = {}, cursor?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const page = await (await adapter()).listPage(filters, cursor, signal);
    signal?.throwIfAborted();
    return page;
  },
  async list(filters: LawyerFilters = {}, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const result = await (await adapter()).list(filters, signal);
    signal?.throwIfAborted();
    return result;
  },
  async get(id: string) {
    return (await adapter()).get(id);
  },
  async getMine() {
    return (await adapter()).getMine();
  },
  async saveMine(profile: LawyerView) {
    return (await adapter()).saveMine(profile);
  },
  async publishMine(published: boolean, current?: Pick<LawyerView, "id" | "revision">) {
    return (await adapter()).publishMine(published, current);
  },
};
async function hashBytes(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function assetClient(send = checkedAssetRequest) {
  return createSharedLawyerAssetsClient<File, Blob>({
    scope: browserSessionScope,
    request: jsonRequest(send),
    newKey: () => crypto.randomUUID(),
    fingerprintText: (text) => hashBytes(new TextEncoder().encode(text)),
    open: async (file) => ({
      fingerprint: async () => hashBytes(new Uint8Array(await file.arrayBuffer())),
      body: async () => ({ body: file, byteLength: file.size }),
      close: () => {},
    }),
    uploadContent: async (path, input) =>
      (
        await send(path, {
          method: "PUT",
          signal: input.signal,
          headers: {
            "content-type": "application/octet-stream",
            "if-match": String(input.revision),
          },
          body: input.body,
        })
      ).json(),
    download: async (path, init) => ({
      value: await (await send(path, { ...(init.signal ? { signal: init.signal } : {}) })).blob(),
      discard: () => {},
    }),
    storage: {
      getItem: (key, legacy) =>
        sessionStorage.getItem(key) ?? (legacy ? sessionStorage.getItem(legacy) : null),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key, legacy) => {
        sessionStorage.removeItem(key);
        if (legacy) sessionStorage.removeItem(legacy);
      },
    },
  });
}
/** Existing File/Blob/sessionStorage facade. Common protocol receives platform ports only. */
export function createLawyerUploadClient(send = checkedAssetRequest) {
  const client = createSessionBoundClient(browserSessionScope, () => assetClient(send));
  return {
    async upload(
      profileId: string,
      file: File,
      purpose: "profile_photo" | "portfolio",
    ): Promise<LawyerAssetView> {
      validateLawyerUpload(file, purpose);
      if (apiMode === "mock") {
        if (import.meta.env.PUBLIC_API_MODE === "mock") await import("./mock/lawyers");
        return sharedRequest("lawyers.uploadAsset", { profileId, file, purpose });
      }
      return client.upload(profileId, file, purpose);
    },
  };
}
const assets = createSessionBoundClient(browserSessionScope, () => assetClient());
export const lawyerAssets = {
  async list(): Promise<LawyerAssetView[]> {
    if (apiMode === "mock") {
      if (import.meta.env.PUBLIC_API_MODE === "mock") await import("./mock/lawyers");
      return sharedRequest("lawyers.assets");
    }
    return assets.list();
  },
  upload: createLawyerUploadClient().upload,
  async remove(assetId: string, revision: number): Promise<void> {
    if (apiMode === "mock") {
      if (import.meta.env.PUBLIC_API_MODE === "mock") await import("./mock/lawyers");
      await sharedRequest("lawyers.removeAsset", { assetId, revision });
      return;
    }
    return assets.remove(assetId, revision);
  },
  async blob(profileId: string, assetId: string, privateRead = false): Promise<Blob> {
    if (apiMode === "mock") {
      if (import.meta.env.PUBLIC_API_MODE === "mock") await import("./mock/lawyers");
      const data = await sharedRequest<{ data: string; type: string }>("lawyers.assetBlob", {
        profileId,
        assetId,
        privateRead,
      });
      return new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], {
        type: data.type,
      });
    }
    return assets.blob(profileId, assetId, privateRead);
  },
};
export const api = { lawyers };
