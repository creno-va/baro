import { sha256 } from "@noble/hashes/sha2.js";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, timestampSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import {
  V2_LIMITS,
  v2FileProbeSchema,
  v2OriginalManifestSchema,
  v2UploadCompleteRequestSchema,
  v2UploadReservationRequestSchema,
} from "../../../contracts/v2";
import * as schema from "../../db/schema";
import { createV2AccountingRepository } from "../../db/v2-accounting";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  hashSchema,
  parse,
  readSnapshot,
  type V2Core,
  type WorkspaceGuard,
} from "../../db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2FilesRepository } from "../../db/v2-files";
import { type BlobRegistration, createV2StorageRepository } from "../../db/v2-storage";
import { hasCurrentConsent } from "../consent/service";
import {
  decryptPart,
  digest,
  encryptPart,
  FileError,
  hex,
  type PartIdentity,
  readBounded,
  readHeader,
} from "./binary";

export type PrivateBucket = Pick<R2Bucket, "get" | "put" | "head" | "delete">;
export type FileServiceDependencies = {
  environment: "preview" | "production";
  bucket?: PrivateBucket;
  clock?: () => string;
  /** Trusted sink reserves real R2/storage exposure; missing evidence denies new writes. */
  storageAdmission?: (input: {
    ownerId: string;
    workspaceId: string;
    fileId: string;
    operationId: string;
    byteLength: number;
    kind: "upload" | "part" | "probe";
  }) => Promise<boolean>;
  /** Server processor verifies actual magic, pages/duration, not a client-provided probe. */
  probe?: (input: {
    ownerId: string;
    workspaceId: string;
    fileId: string;
    uploadSession: string;
    uploadRevision: number;
    byteLength: number;
    contentHash: string;
    open: () => ReadableStream<Uint8Array>;
  }) => Promise<unknown>;
  enqueueProcessing?: (input: {
    ownerId: string;
    workspaceId: string;
    fileId: string;
    fileRevision: number;
    operationId: string;
  }) => Promise<boolean>;
};
type Session = {
  id: string;
  file_id: string;
  revision: number;
  state: string;
  reserved_bytes: number;
  expires_at: string;
  reservation_id: string;
  operation_id: string;
  workspace_revision: number;
};
type Part = {
  ordinal: number;
  byte_length: number;
  blob_id: string;
  cipher_hash: string;
  encrypted_payload: string;
};
const partReceiptSchema = z.strictObject({
  blobId: opaqueIdSchema,
  keyVersion: z.string(),
  contentHash: hashSchema,
  index: z.number().int(),
  byteLength: z.number().int(),
});

export function createFilesService(core: V2Core, deps: FileServiceDependencies) {
  const files = createV2FilesRepository(core);
  const storage = createV2StorageRepository(core);
  const deletion = createV2DeletionRepository(core);
  const accounting = createV2AccountingRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = (ownerId: string): Actor => parse(actorSchema, { ownerId, now: now() });
  const consent = async (ownerId: string) => {
    if (!(await hasCurrentConsent(drizzle(core.binding, { schema }), ownerId)))
      throw new FileError("PROCESSING_UNAVAILABLE");
  };
  const bucket = () => {
    if (!deps.bucket) throw new FileError("STORAGE_UNAVAILABLE");
    return deps.bucket;
  };
  const workspace = async (ownerId: string, workspaceId: string) => {
    parse(opaqueIdSchema, workspaceId);
    const row = await core
      .statement(
        `SELECT w.revision,w.status FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
        [workspaceId, ownerId],
      )
      .first<{ revision: number; status: string }>();
    if (!row) throw new FileError("NOT_FOUND");
    return row;
  };
  const session = async (
    ownerId: string,
    workspaceId: string,
    fileId: string,
    uploadId?: string,
    writing = false,
  ) => {
    for (const id of [ownerId, workspaceId, fileId, ...(uploadId ? [uploadId] : [])])
      parse(opaqueIdSchema, id);
    const row = await core
      .statement(
        `SELECT u.*,r.id AS reservation_id,f.operation_id,w.revision AS workspace_revision FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_storage_reservations r ON r.entity_id=f.id AND r.kind='case_original' WHERE w.owner_id=? AND w.id=? AND f.id=? AND (? IS NULL OR u.id=?) AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ${writing ? "AND u.state='open' AND u.expires_at>? AND w.status!='archived' AND r.state!='released' AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=f.id AND owner_id=w.owner_id AND kind='auto_processing' AND version=?)" : ""}`,
        [
          ownerId,
          workspaceId,
          fileId,
          uploadId ?? null,
          uploadId ?? null,
          ...(writing ? [now(), CURRENT_POLICY_VERSIONS.aiNoticeVersion] : []),
        ],
      )
      .first<Session>();
    if (!row) throw new FileError("NOT_FOUND");
    return row;
  };
  const part = (u: Session, index: number) =>
    core
      .statement(
        "SELECT ordinal,byte_length,blob_id,cipher_hash,encrypted_payload FROM v2_upload_parts WHERE upload_id=? AND ordinal=?",
        [u.id, index],
      )
      .first<Part>();
  const identity = (
    ownerId: string,
    u: Session,
    index: number,
    byteLength: number,
  ): PartIdentity => ({
    environment: deps.environment,
    ownerId,
    fileId: u.file_id,
    uploadId: u.id,
    revision: u.revision,
    index,
    byteLength,
  });
  // One bounded ownership/provenance read before IO and one after IO. With 120
  // chunks and two complete passes this stays below D1's 1000-query paid limit.
  const authorizedBlob = (ownerId: string, workspaceId: string, u: Session, p: Part) =>
    core
      .statement(
        `SELECT b.id,b.object_key,b.kind,b.visibility,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.key_version FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_upload_parts part ON part.upload_id=u.id JOIN v2_blobs b ON b.id=part.blob_id JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE u.id=? AND u.revision=? AND f.id=? AND w.id=? AND w.owner_id=? AND principal.owner_id=w.owner_id AND r.principal_id=b.principal_id AND r.entity_id=f.id AND r.kind='case_original' AND r.state!='released' AND part.ordinal=? AND part.blob_id=? AND part.cipher_hash=? AND part.encrypted_payload=? AND b.state='stored' AND b.kind='original' AND b.visibility='private' AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [
          u.id,
          u.revision,
          u.file_id,
          workspaceId,
          ownerId,
          p.ordinal,
          p.blob_id,
          p.cipher_hash,
          p.encrypted_payload,
        ],
      )
      .first<{
        id: string;
        object_key: string;
        kind: string;
        visibility: string;
        logical_bytes: number;
        cipher_bytes: number;
        cipher_hash: string;
        key_version: string | null;
      }>();
  const loadPart = async (
    ownerId: string,
    workspaceId: string,
    u: Session,
    p: Part,
    wrappedKey?: string,
  ) => {
    const blob = await authorizedBlob(ownerId, workspaceId, u, p);
    if (
      blob?.visibility !== "private" ||
      blob.kind !== "original" ||
      blob.cipher_hash !== p.cipher_hash ||
      blob.logical_bytes !== p.byte_length
    )
      throw new FileError("NOT_FOUND");
    const object = await bucket().get(blob.object_key);
    if (!object || !("body" in object) || object.size !== blob.cipher_bytes)
      throw new FileError("INVALID_FILE");
    const bytes = await readBounded(object.body, blob.cipher_bytes);
    if ((await digest(bytes)) !== blob.cipher_hash) throw new FileError("INVALID_FILE");
    const receipt = await core.decrypt(
      "v2_upload_parts",
      `${u.id}-${p.ordinal}`,
      ownerId,
      u.revision,
      p.encrypted_payload,
      partReceiptSchema,
    );
    if (
      receipt.blobId !== p.blob_id ||
      receipt.index !== p.ordinal ||
      receipt.byteLength !== p.byte_length ||
      receipt.keyVersion !== blob.key_version
    )
      throw new FileError("INVALID_FILE");
    const value = await decryptPart(
      core.cipher,
      identity(ownerId, u, p.ordinal, p.byte_length),
      bytes,
      wrappedKey,
    );
    if ((await digest(value)) !== receipt.contentHash) throw new FileError("INVALID_FILE");
    const current = await authorizedBlob(ownerId, workspaceId, u, p);
    if (
      !current ||
      current.cipher_hash !== blob.cipher_hash ||
      current.key_version !== blob.key_version ||
      current.object_key !== blob.object_key ||
      current.logical_bytes !== blob.logical_bytes ||
      current.cipher_bytes !== blob.cipher_bytes
    )
      throw new FileError("NOT_FOUND");
    return {
      value,
      wrappedKey: (
        await readHeader(core.cipher, identity(ownerId, u, p.ordinal, p.byte_length), bytes)
      ).header.wrappedKey,
      contentHash: receipt.contentHash,
    };
  };
  const stream = (
    ownerId: string,
    workspaceId: string,
    u: Session,
    manifest: z.infer<typeof v2OriginalManifestSchema>,
  ) => {
    let index = 0;
    let wrappedKey: string | undefined;
    const hash = sha256.create();
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            if (index === manifest.parts.length) {
              await session(ownerId, workspaceId, u.file_id, u.id);
              if (hex(hash.digest()) !== manifest.contentHash) throw new FileError("INVALID_FILE");
              controller.close();
              return;
            }
            const p = await part(u, index);
            if (!p) throw new FileError("INVALID_FILE");
            const result = await loadPart(ownerId, workspaceId, u, p, wrappedKey);
            const expected = manifest.parts[index];
            if (
              !expected ||
              result.contentHash !== expected.contentHash ||
              result.value.byteLength !== expected.byteLength
            )
              throw new FileError("INVALID_FILE");
            wrappedKey = result.wrappedKey;
            hash.update(result.value);
            index++;
            controller.enqueue(result.value);
          } catch {
            hash.destroy();
            controller.error(new FileError("INVALID_FILE"));
          }
        },
        cancel() {
          hash.destroy();
        },
      },
      { highWaterMark: 0 },
    );
  };
  const allowStorage = async (
    ownerId: string,
    workspaceId: string,
    u: { file_id: string; operation_id: string },
    byteLength: number,
    kind: "upload" | "part" | "probe",
  ) => {
    if (
      !deps.storageAdmission ||
      !(await deps.storageAdmission({
        ownerId,
        workspaceId,
        fileId: u.file_id,
        operationId: u.operation_id,
        byteLength,
        kind,
      }))
    )
      throw new FileError("PROCESSING_UNAVAILABLE");
  };
  return {
    async list(ownerId: string, workspaceId: string, afterId?: string) {
      await workspace(ownerId, workspaceId);
      if (afterId) parse(opaqueIdSchema, afterId);
      const result = await files.listMetadata(actor(ownerId), workspaceId, 20, afterId);
      await workspace(ownerId, workspaceId);
      return result;
    },
    async reserve(
      ownerId: string,
      workspaceId: string,
      expectedRevision: number,
      key: string,
      input: unknown,
    ) {
      const request = v2UploadReservationRequestSchema.parse(input);
      if (!request.name.isWellFormed()) throw new FileError("INVALID_FILE");
      parse(idempotencyKeySchema, key);
      const g = parse(guardSchema, { ...actor(ownerId), workspaceId, expectedRevision });
      await workspace(ownerId, workspaceId);
      await consent(ownerId);
      bucket();
      if (request.autoProcessConsentVersion !== CURRENT_POLICY_VERSIONS.aiNoticeVersion)
        throw new FileError("PROCESSING_UNAVAILABLE");
      const requestHash = await digest(
        new TextEncoder().encode(JSON.stringify({ expectedRevision, ...request })),
      );
      const route = `/api/v2/cases/${workspaceId}/files`;
      const existing = await accounting.findOperation(g, route, key, requestHash);
      if (existing?.kind === "conflict") throw new FileError("CONFLICT");
      if (existing?.kind === "replay") {
        const row = await core
          .statement(
            "SELECT u.id,u.file_id FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id WHERE f.operation_id=?",
            [existing.operation.id],
          )
          .first<{ id: string; file_id: string }>();
        if (!row) throw new FileError("CONFLICT");
        const u = await session(ownerId, workspaceId, row.file_id, row.id, true);
        return {
          schemaVersion: "2" as const,
          fileId: u.file_id,
          uploadSession: u.id,
          chunkBytes: V2_LIMITS.chunkBytes,
          reservedBytes: u.reserved_bytes,
          expiresAt: u.expires_at,
        };
      }
      const fileId = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      await allowStorage(
        ownerId,
        workspaceId,
        { file_id: fileId, operation_id: operationId },
        request.byteLength,
        "upload",
      );
      const result = await files.reserve({ ...g, now: now() }, request, {
        fileId,
        uploadId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        consentId: crypto.randomUUID(),
        expiresAt: new Date(Date.parse(now()) + 3600000).toISOString(),
        admission: { operationId, key, requestHash },
      });
      if (!result) throw new FileError("CONFLICT");
      return result;
    },
    async putPart(
      ownerId: string,
      workspaceId: string,
      fileId: string,
      uploadId: string,
      index: number,
      body: ReadableStream<Uint8Array> | null,
    ) {
      await consent(ownerId);
      const u = await session(ownerId, workspaceId, fileId, uploadId, true);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= Math.ceil(u.reserved_bytes / V2_LIMITS.chunkBytes)
      )
        throw new FileError("INVALID_FILE");
      const byteLength = Math.min(
        V2_LIMITS.chunkBytes,
        u.reserved_bytes - index * V2_LIMITS.chunkBytes,
      );
      const prior = await part(u, index);
      if (!prior) await allowStorage(ownerId, workspaceId, u, byteLength, "part");
      let wrappedKey: string | undefined;
      if (index !== 0) {
        const first = await part(u, 0);
        if (!first) throw new FileError("CONFLICT");
        wrappedKey = (await loadPart(ownerId, workspaceId, u, first)).wrappedKey;
      }
      const data = await readBounded(body, byteLength);
      const contentHash = await digest(data);
      if (prior) {
        const accepted = await loadPart(ownerId, workspaceId, u, prior, wrappedKey);
        if (accepted.contentHash !== contentHash) throw new FileError("CONFLICT");
        return { index, byteLength, contentHash };
      }
      const bytes = await encryptPart(
        core.cipher,
        identity(ownerId, u, index, byteLength),
        data,
        wrappedKey,
      );
      const blob: BlobRegistration = {
        id: crypto.randomUUID(),
        reservationId: u.reservation_id,
        kind: "original",
        visibility: "private",
        logicalBytes: byteLength,
        cipherBytes: bytes.byteLength,
        cipherHash: await digest(bytes),
        contentHash,
        keyVersion: "binary_v1",
      };
      const objectKey = `private/${blob.id}`;
      let written = false;
      if (
        !(await files.prepareOriginalPart(actor(ownerId), {
          uploadId: u.id,
          uploadRevision: u.revision,
          ordinal: index,
          blob,
        }))
      )
        throw new FileError("CONFLICT");
      try {
        await consent(ownerId);
        await session(ownerId, workspaceId, fileId, uploadId, true);
        const stored = await bucket().put(objectKey, bytes, {
          httpMetadata: {
            contentType: "application/octet-stream",
            cacheControl: "private, no-store",
          },
        });
        if (!stored || stored.key !== objectKey || stored.size !== bytes.byteLength)
          throw new FileError("STORAGE_UNAVAILABLE");
        written = true;
        await consent(ownerId);
        if (
          !(await files.registerOriginalPart(actor(ownerId), {
            uploadId: u.id,
            uploadRevision: u.revision,
            ordinal: index,
            blob,
          }))
        )
          throw new FileError("CONFLICT");
        return { index, byteLength, contentHash };
      } catch (error) {
        // The pending intent already survives termination. Only terminal IO can be
        // abandoned here; no logical storage refund happens before actual cleanup.
        const retained = await files.abandonOriginalPart(actor(ownerId), blob.id);
        if (!retained) {
          await bucket().delete(objectKey);
          if (await bucket().head(objectKey)) throw new FileError("STORAGE_UNAVAILABLE");
        }
        if (written) {
          const winner = await part(u, index);
          if (winner) {
            const accepted = await loadPart(ownerId, workspaceId, u, winner, wrappedKey);
            if (accepted.contentHash === contentHash) return { index, byteLength, contentHash };
          }
        }
        throw error;
      }
    },
    async complete(ownerId: string, workspaceId: string, fileId: string, input: unknown) {
      const request = v2UploadCompleteRequestSchema.parse(input);
      await consent(ownerId);
      const existing = await session(ownerId, workspaceId, fileId, request.uploadSession);
      if (existing.state === "finalized") {
        const metadata = await files.metadata(actor(ownerId), fileId);
        if (!metadata?.manifestSnapshotId) throw new FileError("CONFLICT");
        const revision = await core
          .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
            metadata.manifestSnapshotId,
          ])
          .first<number>("revision");
        const manifest = revision
          ? await readSnapshot(
              core,
              actor(ownerId),
              metadata.manifestSnapshotId,
              "file_manifest",
              fileId,
              revision,
              v2OriginalManifestSchema,
            )
          : null;
        if (!manifest || JSON.stringify(manifest) !== JSON.stringify(request.manifest))
          throw new FileError("CONFLICT");
        return {
          fileId,
          revision: metadata.revision,
          status: metadata.status,
          processingQueued: metadata.currentJobId !== null,
        };
      }
      const u = await session(ownerId, workspaceId, fileId, request.uploadSession, true);
      if (u.workspace_revision !== request.expectedRevision) throw new FileError("CONFLICT");
      if (!deps.probe) throw new FileError("PROCESSING_UNAVAILABLE");
      await allowStorage(ownerId, workspaceId, u, u.reserved_bytes, "probe");
      const manifest = v2OriginalManifestSchema.parse(request.manifest);
      if (manifest.byteLength !== u.reserved_bytes) throw new FileError("INVALID_FILE");
      const reader = stream(ownerId, workspaceId, u, manifest).getReader();
      try {
        while (!(await reader.read()).done) {
          /* bounded validation; no retained plaintext */
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const probe = v2FileProbeSchema.parse(
        await deps.probe({
          ownerId,
          workspaceId,
          fileId,
          uploadSession: u.id,
          uploadRevision: u.revision,
          byteLength: u.reserved_bytes,
          contentHash: manifest.contentHash,
          open: () => stream(ownerId, workspaceId, u, manifest),
        }),
      );
      if (probe.byteLength !== u.reserved_bytes) throw new FileError("INVALID_FILE");
      await consent(ownerId);
      await session(ownerId, workspaceId, fileId, u.id, true);
      const metadata = await files.metadata(actor(ownerId), fileId);
      if (!metadata) throw new FileError("NOT_FOUND");
      const recorded = await files.recordOriginalDigest(
        actor(ownerId),
        u.id,
        u.revision,
        manifest.contentHash,
      );
      if (!recorded) {
        const row = await core
          .statement("SELECT encrypted_payload FROM v2_upload_sessions WHERE id=?", [u.id])
          .first<{ encrypted_payload: string | null }>();
        if (
          !row?.encrypted_payload ||
          (
            await core.decrypt(
              "v2_upload_sessions",
              u.id,
              ownerId,
              u.revision,
              row.encrypted_payload,
              z.strictObject({ contentHash: hashSchema }),
            )
          ).contentHash !== manifest.contentHash
        )
          throw new FileError("CONFLICT");
      }
      await storage.commitReservation(actor(ownerId), u.reservation_id);
      const success = await files.finishUpload(
        { ...actor(ownerId), workspaceId, expectedRevision: request.expectedRevision },
        {
          schemaVersion: "2",
          id: fileId,
          revision: metadata.revision + 1,
          name: metadata.name,
          declaredMediaType: metadata.declaredMediaType,
          byteLength: u.reserved_bytes,
          status: "uploaded",
          probe,
          manifest,
          coverage: null,
          observations: [],
          derivatives: [],
          currentJobId: null,
          operationId: u.operation_id,
          failure: null,
          createdAt: metadata.createdAt,
        },
      );
      if (!success) throw new FileError("CONFLICT");
      const processingQueued = deps.enqueueProcessing
        ? await deps.enqueueProcessing({
            ownerId,
            workspaceId,
            fileId,
            fileRevision: metadata.revision + 1,
            operationId: u.operation_id,
          })
        : false;
      return {
        fileId,
        revision: metadata.revision + 1,
        status: "uploaded" as const,
        processingQueued,
      };
    },
    async content(ownerId: string, workspaceId: string, fileId: string) {
      const u = await session(ownerId, workspaceId, fileId);
      const metadata = await files.metadata(actor(ownerId), fileId);
      if (!metadata?.manifestSnapshotId) throw new FileError("NOT_FOUND");
      const revision = await core
        .statement("SELECT revision FROM v2_private_snapshots WHERE id=?", [
          metadata.manifestSnapshotId,
        ])
        .first<number>("revision");
      if (!revision) throw new FileError("NOT_FOUND");
      const manifest = await readSnapshot(
        core,
        actor(ownerId),
        metadata.manifestSnapshotId,
        "file_manifest",
        fileId,
        revision,
        v2OriginalManifestSchema,
      );
      if (!manifest) throw new FileError("NOT_FOUND");
      await session(ownerId, workspaceId, fileId);
      return {
        name: metadata.name,
        byteLength: manifest.byteLength,
        body: stream(ownerId, workspaceId, u, manifest),
      };
    },
    async remove(
      ownerId: string,
      workspaceId: string,
      fileId: string,
      expectedRevision: number,
      fileRevision: number,
    ) {
      const g: WorkspaceGuard = parse(guardSchema, {
        ...actor(ownerId),
        workspaceId,
        expectedRevision,
      });
      if (!(await deletion.file(g, fileId, fileRevision))) throw new FileError("CONFLICT");
      return { fileId, status: "deleting" as const };
    },
    /** Internal cleanup worker only; callers supply a real journal lease, never browser receipts. */
    async cleanup(lease: CleanupLease) {
      const targets = await deletion.targets(lease, now(), 8);
      let confirmed = 0;
      for (const target of targets) {
        if (target.kind !== "blob") break; // jobs must stop first; reservation inventory is owned by cleanup orchestration.
        const row = await core
          .statement(
            "SELECT object_key,cipher_hash FROM v2_blobs WHERE id=? AND state='deleting'",
            [target.target_id],
          )
          .first<{ object_key: string; cipher_hash: string }>();
        if (
          !row ||
          row.object_key !== target.object_key ||
          !/^private\/[A-Za-z0-9_-]{1,128}$/.test(row.object_key)
        )
          return false;
        await bucket().delete(row.object_key);
        if (await bucket().head(row.object_key)) return false;
        if (
          !(await storage.confirmBlobDeleted(target.target_id, now(), {
            lease,
            receiptId: crypto.randomUUID(),
            objectKey: row.object_key,
            cipherHash: row.cipher_hash,
          }))
        )
          return false;
        confirmed++;
      }
      return confirmed > 0;
    },
    /** Internal scheduler: replay bounded stale intents and expired open uploads. */
    async recoverInterruptedUploads(limit = 8) {
      parse(z.number().int().min(1).max(20), limit);
      const cutoff = new Date(Date.parse(now()) - 300000).toISOString();
      const stale = await core
        .statement(
          "SELECT b.id,p.owner_id FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.state='pending' AND b.kind='original' AND b.created_at<=? ORDER BY b.created_at,b.id LIMIT ?",
          [cutoff, limit],
        )
        .all<{ id: string; owner_id: string | null }>();
      let recovered = 0;
      for (const row of stale.results)
        if (row.owner_id && (await files.abandonOriginalPart(actor(row.owner_id), row.id)))
          recovered++;
      const expired = await core
        .statement(
          `SELECT f.id,f.revision,w.id AS workspace_id,w.revision AS workspace_revision,w.owner_id FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id WHERE u.state='open' AND u.expires_at<=? AND f.state IN ('reserved','uploading') AND ${aliveWorkspace} ORDER BY u.expires_at,u.id LIMIT ?`,
          [now(), limit],
        )
        .all<{
          id: string;
          revision: number;
          workspace_id: string;
          workspace_revision: number;
          owner_id: string;
        }>();
      for (const row of expired.results)
        if (
          await deletion.file(
            {
              ...actor(row.owner_id),
              workspaceId: row.workspace_id,
              expectedRevision: row.workspace_revision,
            },
            row.id,
            row.revision,
          )
        )
          recovered++;
      return recovered;
    },
  };
}
export type FilesService = ReturnType<typeof createFilesService>;
