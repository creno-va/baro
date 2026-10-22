import { expect, test } from "bun:test";
import {
  createFilesClient,
  type UploadMetadata,
  type UploadRecoveryRecord,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { V2_LIMITS } from "@baro/contracts/v2";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";

const hash = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
const source: UploadMetadata = { name: "합성 원본.txt", size: 3, type: "text/plain" },
  contentHash = "b".repeat(64);
type Failure =
  | ""
  | "reserve-body"
  | "part-body"
  | "complete-before"
  | "complete-body"
  | "projection"
  | "initial-write"
  | "file-write"
  | "complete-write"
  | "cleanup";
function fixture() {
  const disk = new Map<string, string>();
  let failure: Failure = "",
    revision = 1,
    fileId = "",
    state = "uploading",
    opened = 0,
    closed = 0,
    physicalOwner = "a";
  let conflict: "" | "reservation" | "complete" = "";
  const writes: { path: string; headers: Headers; body: string }[] = [],
    receipts: string[] = [];
  const reservations = new Map<string, { body: string; revision: string }>();
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_uploads",
    fingerprint: hash,
    storage: {
      get: async (key) => disk.get(key) ?? null,
      set: async (key, value) => {
        const record = JSON.parse(value) as UploadRecoveryRecord;
        if (
          failure === "initial-write" ||
          (failure === "file-write" && record.fileId) ||
          (failure === "complete-write" && record.complete)
        )
          throw new Error("SYNTHETIC_PRIVATE_STORAGE");
        disk.set(key, value);
      },
      remove: async (key) => {
        if (failure !== "cleanup") disk.delete(key);
      },
    },
  });
  const lose = (value: Failure) => {
    if (failure !== value) return;
    failure = "";
    throw new Error("SYNTHETIC_RESPONSE_LOST");
  };
  const transport: WorkspaceTransport = async (path, init = {}) => {
    const headers = new Headers(init.headers),
      method = init.method ?? "GET";
    if (headers.get(EXPECTED_OWNER_HEADER) !== physicalOwner)
      return Response.json({ error: { code: "STALE_OWNER" } }, { status: 409 });
    if (method !== "GET") writes.push({ path, headers, body: String(init.body) });
    if (path.endsWith("/workspace")) return Response.json({ workspaceRevision: revision });
    if (path.endsWith("/files") && method === "GET") {
      lose("projection");
      return Response.json(
        fileId
          ? [
              {
                id: fileId,
                revision: 1,
                name: source.name,
                declaredMediaType: source.type,
                byteLength: 3,
                status: state === "uploading" ? "reserved" : "uploaded",
                contentHash,
              },
            ]
          : [],
      );
    }
    if (path.endsWith("/files") && method === "POST") {
      if (conflict === "reservation")
        return Response.json({ error: { code: "INVALID_STATE" } }, { status: 409 });
      const key = headers.get("idempotency-key") ?? "",
        value = { body: String(init.body), revision: headers.get("if-match") ?? "" },
        previous = reservations.get(key);
      if (previous) expect(value).toEqual(previous);
      else {
        reservations.set(key, value);
        fileId = "opaque_file";
        revision++;
      }
      lose("reserve-body");
      return Response.json({
        schemaVersion: "2",
        fileId,
        uploadSession: "DO_NOT_PERSIST_UPLOAD_TOKEN",
        chunkBytes: V2_LIMITS.chunkBytes,
        reservedBytes: 3,
        expiresAt: "2026-10-24T00:00:00Z",
      });
    }
    if (path.endsWith("/upload-session"))
      return Response.json({
        schemaVersion: "2",
        fileId,
        uploadSession: "DO_NOT_PERSIST_UPLOAD_TOKEN",
        chunkBytes: V2_LIMITS.chunkBytes,
        reservedBytes: 3,
        expiresAt: "2026-10-24T00:00:00Z",
      });
    if (path.includes("/parts/")) {
      lose("part-body");
      return Response.json({ accepted: true });
    }
    if (path.endsWith("/complete")) {
      lose("complete-before");
      if (conflict === "complete")
        return Response.json({ error: { code: "INVALID_STATE" } }, { status: 409 });
      state = "waiting";
      revision++;
      lose("complete-body");
      if (failure === "projection") {
        /* Fail the read after this accepted ACK. */
      }
      return Response.json({ fileId, revision: 2, status: "uploaded", processingQueued: false });
    }
    throw new Error("UNEXPECTED_SYNTHETIC_ROUTE");
  };
  const client = (scope = createSessionScope(), ownerId = "a", request = transport) =>
    createFilesClient<UploadMetadata, string>({
      request,
      scope,
      newKey: () => crypto.randomUUID(),
      recovery: { ownerId, storage, fingerprint: hash },
      onUploadAcknowledged: (id) => receipts.push(id),
      openUpload: async () => {
        opened++;
        return {
          fingerprint: async () => contentHash,
          part: async () => ({ body: new Uint8Array([1, 2, 3]), byteLength: 3, contentHash }),
          close: () => {
            closed++;
          },
        };
      },
      download: async () => {
        throw new Error("UPLOAD_MUST_NOT_DOWNLOAD");
      },
    });
  return {
    client,
    transport,
    disk,
    writes,
    receipts,
    storage,
    reservations,
    setFailure: (value: Failure) => {
      failure = value;
    },
    setConflict: (value: typeof conflict) => {
      conflict = value;
    },
    setOwner: (value: string) => {
      physicalOwner = value;
    },
    revision: (value: number) => {
      revision = value;
    },
    stats: () => ({ opened, closed }),
    records: () => [...disk.values()].map((value) => JSON.parse(value) as UploadRecoveryRecord),
  };
}
for (const failure of [
  "reserve-body",
  "part-body",
  "complete-before",
  "file-write",
  "complete-write",
] as const)
  test(`a recreated client retains reservation/file/complete identity after ${failure}`, async () => {
    const f = fixture();
    f.setFailure(failure);
    await expect(
      f.client().upload("case_a", source, undefined, { metadataOnly: true }),
    ).rejects.toBeDefined();
    const original = f.records()[0];
    expect(original).toBeDefined();
    f.setFailure("");
    f.revision(77);
    const value = await f
      .client()
      .upload("case_a", { ...source }, undefined, { metadataOnly: true });
    expect(value.id).toBe("opaque_file");
    expect(f.reservations.size).toBe(1);
    for (const write of f.writes.filter((write) => write.path.endsWith("/files"))) {
      expect(write.headers.get("idempotency-key")).toBe(original?.reservationKey ?? null);
      expect(write.headers.get("if-match")).toBe(String(original?.expectedRevision));
    }
    if (failure === "complete-before") {
      const commits = f.writes.filter((write) => write.path.endsWith("/complete"));
      expect(commits).toHaveLength(2);
      expect(commits[0]?.body).toBe(commits[1]?.body);
      expect(commits[0]?.headers.get("idempotency-key")).toBe(
        commits[1]?.headers.get("idempotency-key"),
      );
    }
    expect(f.disk.size).toBe(0);
    expect(f.stats().opened).toBe(f.stats().closed);
  });
test("a consumed completion with a lost body is reconciled by its exact persisted file, not another reservation/part/commit", async () => {
  const f = fixture();
  f.setFailure("complete-body");
  await expect(
    f.client().upload("case_a", source, undefined, { metadataOnly: true }),
  ).rejects.toBeDefined();
  const writes = f.writes.length;
  expect(
    (await f.client().upload("case_a", source, undefined, { metadataOnly: true })).status,
  ).toBe("waiting");
  expect(f.writes.length).toBe(writes);
  expect(f.receipts).toHaveLength(1);
});
test("required writes precede admission; opaque native metadata never contains upload token, name, URI or manifest", async () => {
  const f = fixture();
  f.setFailure("initial-write");
  await expect(f.client().upload("case_a", source)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.writes).toHaveLength(0);
  f.setFailure("part-body");
  await expect(f.client().upload("case_a", source)).rejects.toBeDefined();
  const persisted = [...f.disk.values()].join("");
  for (const privateValue of [
    "DO_NOT_PERSIST_UPLOAD_TOKEN",
    source.name,
    "file:",
    "manifest",
    "contentHash",
  ])
    expect(persisted.includes(privateValue)).toBe(false);
});
test("failed cleanup remains an accepted upload and a later client recovers without new admission", async () => {
  const f = fixture();
  f.setFailure("cleanup");
  expect((await f.client().upload("case_a", source, undefined, { metadataOnly: true })).id).toBe(
    "opaque_file",
  );
  expect(f.receipts).toHaveLength(1);
  expect(f.disk.size).toBe(1);
  const writes = f.writes.length;
  f.setFailure("");
  await f.client().upload("case_a", source, undefined, { metadataOnly: true });
  expect(f.writes.length).toBe(writes);
  expect(f.disk.size).toBe(0);
});
for (const phase of ["reservation", "complete"] as const)
  test(`a confirmed ${phase} conflict changes its original CAS only after an explicit resolve decision`, async () => {
    const f = fixture();
    f.setConflict(phase);
    await expect(f.client().upload("case_a", source)).rejects.toMatchObject({ code: "CONFLICT" });
    const previous = f.records()[0];
    expect(previous?.conflict).toBe(phase);
    f.revision(90);
    await expect(f.client().upload("case_a", source)).rejects.toMatchObject({ code: "CONFLICT" });
    const same = f.records()[0];
    expect(same?.reservationKey).toBe(previous?.reservationKey);
    expect(same?.complete?.expectedRevision).toBe(previous?.complete?.expectedRevision);
    f.setConflict("");
    expect(
      (await f.client().upload("case_a", source, undefined, { resolveConflict: true })).id,
    ).toBe("opaque_file");
  });
test("concurrent distinct sources and client instances share one in-flight durable operation", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.client().upload("case_a", { ...source }),
    f.client().upload("case_a", { ...source }),
  ]);
  expect(a.id).toBe(b.id);
  expect(f.reservations.size).toBe(1);
  expect(f.writes.filter((write) => write.path.endsWith("/complete"))).toHaveLength(1);
  expect(f.stats().opened).toBe(f.stats().closed);
});
test("a late owner transition cannot publish the previous upload or clear its unresolved receipt", async () => {
  const f = fixture(),
    scope = createSessionScope();
  const request: WorkspaceTransport = async (path, init) => {
    const result = await f.transport(path, init);
    if (path.endsWith("/complete")) scope.invalidate();
    return result;
  };
  await expect(f.client(scope, "a", request).upload("case_a", source)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(f.receipts).toHaveLength(0);
  expect(f.disk.size).toBe(1);
  f.setOwner("b");
  await expect(f.client(createSessionScope(), "b").upload("case_a", source)).resolves.toBeDefined();
  // The old owner's unresolved metadata is not erased by the new owner's operation.
  expect(f.disk.size).toBe(1);
});
