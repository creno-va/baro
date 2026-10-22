import { expect, test } from "bun:test";
import {
  createFilesClient,
  type UploadMetadata,
  type UploadReader,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { V2_LIMITS } from "@baro/contracts/v2/common";

const source = { name: "합성.txt", type: "text/plain", size: 3, uri: "synthetic://opaque" };
const hash = "b".repeat(64);
function fixture(
  options: {
    fingerprint?: () => Promise<string>;
    part?: UploadReader["part"];
    close?: () => void;
    request?: WorkspaceTransport;
  } = {},
) {
  const scope = createSessionScope();
  let reserved = false,
    ready = false,
    opened = 0,
    closed = 0;
  const requests: { path: string; init: RequestInit | undefined }[] = [];
  const fileView = () => ({
    id: "synthetic_file",
    name: source.name,
    mimeType: source.type,
    sizeBytes: source.size,
    status: ready ? "ready" : "uploading",
    coverage: "합성",
    extractedText: "",
    uploadContentHash: hash,
  });
  const request: WorkspaceTransport = async (path, init) => {
    requests.push({ path, init });
    if (options.request) return options.request(path, init);
    if (path.endsWith("/workspace")) return Response.json({ workspaceRevision: 1 });
    if (path.endsWith("/files") && init?.method === "POST") {
      reserved = true;
      return Response.json({
        schemaVersion: "2",
        fileId: "synthetic_file",
        uploadSession: "synthetic_upload",
        chunkBytes: V2_LIMITS.chunkBytes,
        reservedBytes: source.size,
        expiresAt: "2026-10-23T00:00:00Z",
      });
    }
    if (path.endsWith("/files")) return Response.json(reserved ? [fileView()] : []);
    if (path.includes("/parts/")) return Response.json({ accepted: true });
    if (path.endsWith("/complete")) {
      ready = true;
      return Response.json({ accepted: true });
    }
    throw new Error("UNEXPECTED_SYNTHETIC_PATH");
  };
  const client = createFilesClient<UploadMetadata & { uri: string }, string>({
    request,
    scope,
    newKey: () => crypto.randomUUID(),
    openUpload: async () => {
      opened++;
      return {
        fingerprint: options.fingerprint ?? (async () => hash),
        part:
          options.part ??
          (async (start, end) => ({
            body: new Uint8Array([1, 2, 3]).subarray(start, end),
            byteLength: end - start,
            contentHash: hash,
          })),
        close: () => {
          closed++;
          options.close?.();
        },
      };
    },
    download: async () => "synthetic-private-cache-uri",
  });
  return { client, scope, requests, opened: () => opened, closed: () => closed };
}

test("a non-DOM byte adapter uploads one bounded part and closes after verified readback", async () => {
  const f = fixture({
    close: () => {
      throw new Error("SYNTHETIC_CLEANUP_FAILURE");
    },
  });
  const result = await f.client.upload("synthetic_case", source);
  expect(result.status).toBe("ready");
  const part = f.requests.find(({ path }) => path.includes("/parts/"));
  expect(part?.init?.body).toEqual(new Uint8Array([1, 2, 3]));
  const complete = f.requests.find(({ path }) => path.endsWith("/complete"));
  expect(JSON.parse(String(complete?.init?.body)).manifest).toEqual({
    byteLength: 3,
    contentHash: hash,
    parts: [{ index: 0, byteLength: 3, contentHash: hash }],
  });
  expect(f.opened()).toBe(1);
  expect(f.closed()).toBe(1);
});

test("parallel uploads of the same source share one reader and admission", async () => {
  let release!: (hash: string) => void;
  const fingerprint = new Promise<string>((done) => {
    release = done;
  });
  const f = fixture({ fingerprint: () => fingerprint });
  const first = f.client.upload("synthetic_case", source);
  const second = f.client.upload("synthetic_case", source);
  release(hash);
  expect((await Promise.all([first, second]))[0]?.status).toBe("ready");
  expect(f.opened()).toBe(1);
  expect(f.requests.filter(({ init }) => init?.method === "POST")).toHaveLength(2);
  expect(f.closed()).toBe(1);
});

test("an owner change during hashing closes the reader without reserving or publishing progress", async () => {
  let release!: (hash: string) => void;
  const fingerprint = new Promise<string>((done) => {
    release = done;
  });
  const f = fixture({ fingerprint: () => fingerprint });
  const stages: string[] = [];
  const result = f.client.upload("synthetic_case", source, ({ stage }) => stages.push(stage));
  await Promise.resolve();
  f.scope.invalidate();
  release(hash);
  await expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.requests).toHaveLength(0);
  expect(stages).toEqual(["hashing"]);
  expect(f.closed()).toBe(1);
});

for (const invalidPart of ["length", "digest"] as const)
  test(`an invalid ${invalidPart} adapter result cannot upload bytes or complete the manifest`, async () => {
    const f = fixture({
      part: async () => ({
        body: new Uint8Array([1, 2, 3]),
        byteLength: invalidPart === "length" ? 4 : 3,
        contentHash: invalidPart === "digest" ? "unsafe-input" : hash,
      }),
    });
    await expect(f.client.upload("synthetic_case", source)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.requests.some(({ path }) => /\/(?:parts|complete)/.test(path))).toBe(false);
    expect(f.closed()).toBe(1);
  });

test("invalid source sizes never open a platform file reader", async () => {
  const f = fixture();
  await expect(f.client.upload("synthetic_case", { ...source, size: 0.5 })).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(f.opened()).toBe(0);
  expect(f.requests).toHaveLength(0);
});

test("late original downloads cannot cross an account boundary", async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((done) => {
    release = done;
  });
  const f = fixture({ request: () => response });
  const pending = f.client.original("synthetic_case", "synthetic_file");
  f.scope.invalidate();
  release(new Response("synthetic original"));
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
