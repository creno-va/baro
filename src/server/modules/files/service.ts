import { sha256 } from "@noble/hashes/sha2.js";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema, timestampSchema } from "../../../contracts";
import {
  COMPATIBLE_FILE_AI_NOTICE_VERSION,
  CURRENT_POLICY_VERSIONS,
} from "../../../contracts/consent";
import {
  FILE_TARGET_UPLOAD_CONSISTENCY,
  V2_LIMITS,
  v2FileProbeSchema,
  v2OriginalManifestSchema,
  v2UploadCompleteRequestSchema,
  v2UploadReservationRequestSchema,
  v2UploadSessionSchema,
} from "../../../contracts/v2";
import { AUTH_RETENTION_MS } from "../../auth/policy";
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
  V2RepositoryError,
  type WorkspaceGuard,
} from "../../db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2FilesRepository } from "../../db/v2-files";
import { originalPartReceiptSchema, stopUnsentOriginalWrite } from "../../db/v2-original-parts";
import { type BlobRegistration, createV2StorageRepository } from "../../db/v2-storage";
import { createV2StorageCapacityRepository, type WritePermit } from "../../db/v2-storage-capacity";
import { isPreparedStoragePaidHold } from "../../db/v2-storage-paid-runtime";
import type {
  StorageAdmission,
  StorageCostInput,
  StorageCosts,
  StoragePermit,
} from "../budget/storage-ledger";
import { authorizeBlobCleanup, createStorageMaintenance } from "../budget/storage-maintenance";
import { hasCurrentConsent } from "../consent/service";
import { DefinitiveFileRejection } from "../file-processing/protocol";
import {
  decryptPartWithKey,
  digest,
  encryptPartWithKey,
  FileError,
  hex,
  type PartIdentity,
  readBounded,
} from "./binary";
import { hasFileStorageMeter, notifyFileStorageFailure, withFileStorageCleanup } from "./limits";

export type PrivateBucket = Pick<R2Bucket, "get" | "put" | "head" | "delete">;
export type FileStorageInput = StorageCostInput;
export type FileStorageAdmission = StorageAdmission;
export type FileStoragePermit = StoragePermit;
export type FileStorageCosts = StorageCosts;
export type FileServiceDependencies = {
  environment: "preview" | "production";
  /** Explicit versioned protocol; absence preserves the installed clients' strict CAS. */
  completionConsistency?: typeof FILE_TARGET_UPLOAD_CONSISTENCY;
  bucket?: PrivateBucket;
  clock?: () => string;
  /** Exact signed HTTP session for original downloads; internal jobs use their own leases. */
  sessionId?: string;
  /** Trusted #93 producer; no pricing, role, time or receipt comes from a client. */
  paidStorage?: FileStorageCosts;
  /** Explicit offline adapter, preview only. Never mounted by production composition. */
  testOnlyUnmeteredStorage?: true;
  /** Server processor verifies actual magic, pages/duration, not a client-provided probe. */
  probe?: (input: {
    ownerId: string;
    workspaceId: string;
    fileId: string;
    uploadSession: string;
    uploadRevision: number;
    byteLength: number;
    contentHash: string;
    requestSessionId?: string;
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
  workspace_status: string;
  workspace_job_id: string | null;
  workspace_intake_revision: number;
  workspace_summary_revision: number | null;
  file_revision: number;
  operation_revision: number;
  request_hash: string;
};
type Part = {
  ordinal: number;
  byte_length: number;
  blob_id: string;
  cipher_hash: string;
  encrypted_payload: string;
};

export function createFilesService(core: V2Core, deps: FileServiceDependencies) {
  const files = createV2FilesRepository(core);
  const storage = createV2StorageRepository(core);
  const capacity = createV2StorageCapacityRepository(core, deps.environment);
  const deletion = createV2DeletionRepository(core);
  const accounting = createV2AccountingRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const maintenance = createStorageMaintenance(core, deps.environment, now);
  const actor = (ownerId: string): Actor => parse(actorSchema, { ownerId, now: now() });
  const requestSessionFence = () => {
    const at = Date.now();
    return deps.sessionId
      ? {
          sql: "AND EXISTS(SELECT 1 FROM session request_session WHERE request_session.id=? AND request_session.user_id=w.owner_id AND request_session.expires_at>? AND request_session.created_at>?)",
          values: [deps.sessionId, at, at - AUTH_RETENTION_MS],
        }
      : { sql: "", values: [] };
  };
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
    const requestSession = requestSessionFence();
    const row = await core
      .statement(
        `SELECT u.*,r.id AS reservation_id,f.operation_id,f.revision AS file_revision,o.revision AS operation_revision,(SELECT request_hash FROM v2_idempotency WHERE operation_id=o.id LIMIT 1) AS request_hash,w.revision AS workspace_revision,w.status AS workspace_status,w.current_job_id AS workspace_job_id,w.intake_revision AS workspace_intake_revision,w.confirmed_summary_revision AS workspace_summary_revision FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_operations o ON o.id=f.operation_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_storage_reservations r ON r.entity_id=f.id AND r.kind='case_original' WHERE w.owner_id=? AND w.id=? AND f.id=? AND (? IS NULL OR u.id=?) AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ${writing ? `AND u.state='open' AND u.expires_at>? AND w.status!='archived' AND r.state!='released' AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=f.id AND owner_id=w.owner_id AND kind='auto_processing' AND version IN (?, '${COMPATIBLE_FILE_AI_NOTICE_VERSION}'))` : ""} ${requestSession.sql}`,
        [
          ownerId,
          workspaceId,
          fileId,
          uploadId ?? null,
          uploadId ?? null,
          ...(writing ? [now(), CURRENT_POLICY_VERSIONS.aiNoticeVersion] : []),
          ...requestSession.values,
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
  // Combine consent and provenance in one read. Completion validates bytes in
  // the processor's single pass, keeping 120 metered chunks within D1 limits.
  const authorizedBlob = (
    ownerId: string,
    workspaceId: string,
    u: Session,
    p: Part | number,
    requireConsent = true,
  ) => {
    const requestSession = requestSessionFence();
    const pinned = typeof p === "number" ? undefined : p;
    return core
      .statement(
        `SELECT b.id,b.object_key,b.kind,b.visibility,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.key_version,part.ordinal,part.byte_length,part.blob_id,part.cipher_hash AS part_cipher_hash,part.encrypted_payload FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_upload_parts part ON part.upload_id=u.id JOIN v2_blobs b ON b.id=part.blob_id JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE u.id=? AND u.revision=? AND f.id=? AND w.id=? AND w.owner_id=? AND principal.owner_id=w.owner_id AND r.principal_id=b.principal_id AND r.entity_id=f.id AND r.kind='case_original' AND r.state!='released' AND part.ordinal=? ${pinned ? "AND part.blob_id=? AND part.cipher_hash=? AND part.encrypted_payload=?" : ""} AND b.state='stored' AND b.kind='original' AND b.visibility='private' AND (?=0 OR EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=w.owner_id AND c.terms_version=? AND c.privacy_version=? AND c.ai_notice_version=? AND c.over_14_confirmed=1)) AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer') IN ('customer','lawyer') AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) ${requestSession.sql}`,
        [
          u.id,
          u.revision,
          u.file_id,
          workspaceId,
          ownerId,
          typeof p === "number" ? p : p.ordinal,
          ...(pinned ? [pinned.blob_id, pinned.cipher_hash, pinned.encrypted_payload] : []),
          requireConsent ? 1 : 0,
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          ...requestSession.values,
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
        ordinal: number;
        byte_length: number;
        blob_id: string;
        part_cipher_hash: string;
        encrypted_payload: string;
      }>();
  };
  const blobPart = (blob: NonNullable<Awaited<ReturnType<typeof authorizedBlob>>>): Part => ({
    ordinal: blob.ordinal,
    byte_length: blob.byte_length,
    blob_id: blob.blob_id,
    cipher_hash: blob.part_cipher_hash,
    encrypted_payload: blob.encrypted_payload,
  });
  const loadPart = async (
    ownerId: string,
    workspaceId: string,
    u: Session,
    source: Part | number,
    wrappedKey?: string,
    requireConsent = true,
  ) => {
    const blob = await authorizedBlob(ownerId, workspaceId, u, source, requireConsent);
    if (!blob) throw new FileError("NOT_FOUND");
    const p = typeof source === "number" ? blobPart(blob) : source;
    if (
      blob?.visibility !== "private" ||
      blob.kind !== "original" ||
      blob.cipher_hash !== p.cipher_hash ||
      blob.logical_bytes !== p.byte_length
    )
      throw new FileError("NOT_FOUND");
    const currentAccess = async () => {
      try {
        const current = await authorizedBlob(ownerId, workspaceId, u, p, requireConsent);
        return (
          current?.id === blob.id &&
          current.object_key === blob.object_key &&
          current.cipher_hash === blob.cipher_hash
        );
      } catch {
        return false;
      }
    };
    if (
      !(unmeteredTest
        ? await currentAccess()
        : await maintenance.admit(blob.id, blob.object_key, "get", currentAccess))
    )
      throw new FileError("PROCESSING_UNAVAILABLE");
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
      originalPartReceiptSchema,
    );
    if (
      receipt.blobId !== p.blob_id ||
      receipt.index !== p.ordinal ||
      receipt.byteLength !== p.byte_length ||
      receipt.keyVersion !== blob.key_version
    )
      throw new FileError("INVALID_FILE");
    const { value, wrappedKey: actualWrappedKey } = await decryptPartWithKey(
      core.cipher,
      identity(ownerId, u, p.ordinal, p.byte_length),
      bytes,
      wrappedKey,
    );
    if ((await digest(value)) !== receipt.contentHash) throw new FileError("INVALID_FILE");
    if (receipt.wrappedKey !== undefined && receipt.wrappedKey !== actualWrappedKey)
      throw new FileError("INVALID_FILE");
    // Finish asynchronous decryption before the last access fence: the caller
    // must not receive even one plaintext chunk after a revoked request session.
    const current = await authorizedBlob(ownerId, workspaceId, u, p, requireConsent);
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
      wrappedKey: actualWrappedKey,
      contentHash: receipt.contentHash,
    };
  };
  const stream = (
    ownerId: string,
    workspaceId: string,
    u: Session,
    manifest: z.infer<typeof v2OriginalManifestSchema>,
    validated?: () => void,
    requireConsent = true,
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
              validated?.();
              controller.close();
              return;
            }
            const result = await loadPart(
              ownerId,
              workspaceId,
              u,
              index,
              wrappedKey,
              requireConsent,
            );
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
  const unmeteredTest = deps.environment === "preview" && deps.testOnlyUnmeteredStorage === true;
  const requireStorage = () => {
    if (!deps.paidStorage && !unmeteredTest) throw new FileError("PROCESSING_UNAVAILABLE");
  };
  return {
    async resumeUpload(ownerId: string, workspaceId: string, fileId: string) {
      await consent(ownerId);
      const u = await session(ownerId, workspaceId, fileId, undefined, true);
      if ((await files.metadata(actor(ownerId), fileId))?.uploadRejection)
        throw new DefinitiveFileRejection();
      return v2UploadSessionSchema.parse({
        schemaVersion: "2",
        fileId: u.file_id,
        uploadSession: u.id,
        chunkBytes: V2_LIMITS.chunkBytes,
        reservedBytes: u.reserved_bytes,
        expiresAt: u.expires_at,
      });
    },
    async list(ownerId: string, workspaceId: string, afterId?: string) {
      await workspace(ownerId, workspaceId);
      if (afterId) parse(opaqueIdSchema, afterId);
      const result = await files
        .listMetadata(actor(ownerId), workspaceId, 20, afterId, { requireStablePage: true })
        .catch((error) => {
          if (error instanceof V2RepositoryError && error.code === "SNAPSHOT_INVALID")
            throw new FileError("STORAGE_UNAVAILABLE");
          throw error;
        });
      for (const file of result) {
        if (file.status !== "failed") continue;
        const eligible = await core
          .statement(
            "SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.target_kind='file' AND j.target_id=? AND j.target_revision=? AND j.kind='file_processing' AND j.status='failed' AND j.retryable=1 AND j.attempts<10 AND o.owner_id=? LIMIT 1",
            [file.id, file.revision, ownerId],
          )
          .first();
        Object.assign(file, { canRetry: !!eligible && !!file.manifestSnapshotId });
      }
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
        // A lost reservation ACK can be retried after another signed client has
        // finalized the same file. Recover its admitted identity through this
        // exact owner/key/request hash, without re-opening or extending a lease.
        const previous = await session(ownerId, workspaceId, row.file_id, row.id);
        const u =
          previous.state === "finalized"
            ? previous
            : await session(ownerId, workspaceId, row.file_id, row.id, true);
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
      requireStorage();
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
      // Independent pre-body authority reads can overlap; neither result is
      // cached and the body is not acquired until both have succeeded.
      const [, u] = await Promise.all([
        consent(ownerId),
        session(ownerId, workspaceId, fileId, uploadId, true),
      ]);
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
      if (!prior) requireStorage();
      let wrappedKey: string | undefined;
      if (index !== 0) {
        const blob = await authorizedBlob(ownerId, workspaceId, u, 0);
        if (!blob) throw new FileError("CONFLICT");
        const first = blobPart(blob);
        if (blob.logical_bytes !== first.byte_length || blob.cipher_hash !== first.cipher_hash)
          throw new FileError("NOT_FOUND");
        const receipt = await core.decrypt(
          "v2_upload_parts",
          `${u.id}-0`,
          ownerId,
          u.revision,
          first.encrypted_payload,
          originalPartReceiptSchema,
        );
        if (
          receipt.blobId !== first.blob_id ||
          receipt.index !== 0 ||
          receipt.byteLength !== first.byte_length ||
          receipt.keyVersion !== blob.key_version
        )
          throw new FileError("INVALID_FILE");
        // New receipts retain the server-generated envelope under the same
        // owner/upload/ordinal AEAD context. Legacy receipts still verify R2.
        wrappedKey =
          receipt.wrappedKey ?? (await loadPart(ownerId, workspaceId, u, first)).wrappedKey;
        // Receipt decryption also crosses an async boundary. Keep the original
        // pre-body access fence even when no R2 read is necessary.
        const current = await authorizedBlob(ownerId, workspaceId, u, first);
        if (
          !current ||
          current.object_key !== blob.object_key ||
          current.key_version !== blob.key_version ||
          current.logical_bytes !== blob.logical_bytes ||
          current.cipher_bytes !== blob.cipher_bytes ||
          current.cipher_hash !== blob.cipher_hash
        )
          throw new FileError("NOT_FOUND");
      }
      const data = await readBounded(body, byteLength);
      const contentHash = await digest(data);
      if (prior) {
        const accepted = await loadPart(ownerId, workspaceId, u, prior, wrappedKey);
        if (accepted.contentHash !== contentHash) throw new FileError("CONFLICT");
        return { index, byteLength, contentHash };
      }
      const { bytes, wrappedKey: storedWrappedKey } = await encryptPartWithKey(
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
      const admission = deps.paidStorage
        ? await deps.paidStorage.prepare({
            runId: blob.id,
            attemptOrdinal: 1,
            maximumAttempts: 1,
            deadlineAt: new Date(Date.parse(now()) + 300000).toISOString(),
            action: "r2_put",
            service: "requests",
            operationId: u.operation_id,
            operationRevision: u.operation_revision,
            requestHash: u.request_hash,
            targetKind: "file",
            targetId: fileId,
            targetRevision: u.file_revision,
            reservationId: blob.reservationId,
            blobId: blob.id,
            pending: {
              logicalBytes: blob.logicalBytes,
              cipherBytes: blob.cipherBytes,
              cipherHash: blob.cipherHash,
              keyVersion: blob.keyVersion,
            },
            intent: {
              kind: "case_original",
              uploadId: u.id,
              uploadRevision: u.revision,
              ordinal: index,
            },
          })
        : null;
      if (
        deps.paidStorage &&
        (!admission ||
          !isPreparedStoragePaidHold(admission.paid) ||
          admission.actor.ownerId !== ownerId)
      )
        throw new FileError("PROCESSING_UNAVAILABLE");
      const admissionActor = admission?.actor ?? actor(ownerId);
      const physical = unmeteredTest
        ? undefined
        : capacity.prepareCapacity(admissionActor, {
            blobId: blob.id,
            ownerId,
            objectKey,
            maximumCipherBytes: bytes.byteLength,
          });
      let written = false;
      if (
        !(await files.prepareOriginalPart(
          admissionActor,
          {
            uploadId: u.id,
            uploadRevision: u.revision,
            ordinal: index,
            blob,
          },
          admission?.paid,
          physical,
        ))
      )
        throw new FileError("CONFLICT");
      const pendingPayload = await core
        .statement("SELECT encrypted_payload FROM v2_blobs WHERE id=? AND state='pending'", [
          blob.id,
        ])
        .first<string>("encrypted_payload");
      let permit: FileStoragePermit | null = null;
      let writer: WritePermit | null = null;
      let writerStopped = false;
      let storageResponse: { objectKey: string; byteLength: number } | null = null;
      let dispatched = false;
      let recorded = false;
      const authorize = async () => {
        try {
          const [, current, pending] = await Promise.all([
            consent(ownerId),
            session(ownerId, workspaceId, fileId, uploadId, true),
            pendingPayload &&
              core
                .statement(
                  "SELECT id FROM v2_blobs WHERE id=? AND state='pending' AND reservation_id=? AND encrypted_payload=? AND logical_bytes=? AND cipher_bytes=? AND cipher_hash=? AND key_version=?",
                  [
                    blob.id,
                    blob.reservationId,
                    pendingPayload,
                    blob.logicalBytes,
                    blob.cipherBytes,
                    blob.cipherHash,
                    blob.keyVersion,
                  ],
                )
                .first(),
          ]);
          return (
            !!pending &&
            current.revision === u.revision &&
            current.file_revision === u.file_revision &&
            current.operation_revision === u.operation_revision &&
            current.operation_id === u.operation_id &&
            (!admission || now() < admission.paid.request.plan.deadlineAt)
          );
        } catch {
          return false;
        }
      };
      try {
        if (physical) {
          writer = capacity.prepareWrite({
            blobId: blob.id,
            objectKey,
            byteLength: bytes.byteLength,
          });
          if (!(await capacity.beginPreparedWrite(writer, now())))
            throw new FileError("PROCESSING_UNAVAILABLE");
        }
        if (admission && deps.paidStorage) {
          permit = await deps.paidStorage.beforeDispatch(admission, authorize);
          if (!permit) throw new FileError("PROCESSING_UNAVAILABLE");
        }
        // Recheck a fresh clock and source after the awaited dispatch CAS.
        if (!(await authorize())) throw new FileError("CONFLICT");
        const r2 = bucket();
        dispatched = true;
        const stored = await r2.put(objectKey, bytes, {
          httpMetadata: {
            contentType: "application/octet-stream",
            cacheControl: "private, no-store",
          },
        });
        if (!stored || stored.key !== objectKey || stored.size !== bytes.byteLength)
          throw new FileError("STORAGE_UNAVAILABLE");
        storageResponse = { objectKey, byteLength: bytes.byteLength };
        if (
          writer &&
          !(await capacity.confirmWriterStopped(
            writer,
            {
              transport: "response",
              objectKey,
              byteLength: bytes.byteLength,
            },
            now(),
          ))
        )
          throw new FileError("STORAGE_UNAVAILABLE");
        writerStopped = true;
        if (permit && deps.paidStorage) {
          recorded = true;
          await deps.paidStorage.after(permit, {
            transport: "response",
            definitiveNoCharge: false,
            observedAt: now(),
          });
        }
        written = true;
        await consent(ownerId);
        if (
          !(await files.registerOriginalPart(actor(ownerId), {
            uploadId: u.id,
            uploadRevision: u.revision,
            ordinal: index,
            blob,
            ...(index === 0 ? { wrappedKey: storedWrappedKey } : {}),
          }))
        )
          throw new FileError("CONFLICT");
        return { index, byteLength, contentHash };
      } catch (error) {
        let failure = error;
        // Stop and journal have independent, pre-reserved statement slots. A
        // committed stop with a lost/invalid receipt must not skip the journal.
        await withFileStorageCleanup(core, async () => {
          if (writer && !writerStopped) {
            try {
              const stopped =
                !dispatched && admission && pendingPayload
                  ? await stopUnsentOriginalWrite(core, {
                      uploadId: u.id,
                      uploadRevision: u.revision,
                      ordinal: index,
                      blob,
                      writer,
                      paid: admission.paid,
                      pendingPayload,
                    })
                  : storageResponse
                    ? await capacity.confirmWriterStopped(
                        writer,
                        { transport: "response", ...storageResponse },
                        now(),
                      )
                    : false;
              if (!stopped) failure = new FileError("STORAGE_UNAVAILABLE");
            } catch {
              failure = new FileError("STORAGE_UNAVAILABLE");
            }
          }
          try {
            // A concurrent deletion already owns its own durable journal.
            if (!(await files.abandonOriginalPart(actor(ownerId), blob.id)))
              failure = new FileError("STORAGE_UNAVAILABLE");
          } catch {
            failure = new FileError("STORAGE_UNAVAILABLE");
          }
        });
        if (permit && !recorded && deps.paidStorage) {
          try {
            await notifyFileStorageFailure(core, deps.paidStorage, permit, {
              transport: dispatched ? "unknown" : "not_sent",
              definitiveNoCharge: !dispatched,
              observedAt: now(),
            });
          } catch {
            failure = new FileError("PROCESSING_UNAVAILABLE");
          }
        }
        if (written && !hasFileStorageMeter(core)) {
          const winner = await part(u, index);
          if (winner) {
            const accepted = await loadPart(ownerId, workspaceId, u, winner, wrappedKey);
            if (accepted.contentHash === contentHash) return { index, byteLength, contentHash };
          }
        }
        throw failure;
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
      const assertSameTarget = (current: Session) => {
        if (
          current.revision !== u.revision ||
          current.file_revision !== u.file_revision ||
          current.operation_id !== u.operation_id ||
          current.reservation_id !== u.reservation_id ||
          current.reserved_bytes !== u.reserved_bytes ||
          current.workspace_status !== u.workspace_status ||
          current.workspace_job_id !== u.workspace_job_id ||
          current.workspace_intake_revision !== u.workspace_intake_revision ||
          current.workspace_summary_revision !== u.workspace_summary_revision
        )
          throw new FileError("CONFLICT");
      };
      if (!deps.probe) throw new FileError("PROCESSING_UNAVAILABLE");
      const manifest = v2OriginalManifestSchema.parse(request.manifest);
      const reserved = await files.metadata(actor(ownerId), fileId);
      if (reserved?.uploadRejection) throw new DefinitiveFileRejection();
      if (
        manifest.byteLength !== u.reserved_bytes ||
        (reserved?.contentHash && reserved.contentHash !== manifest.contentHash)
      )
        throw new FileError("INVALID_FILE");
      let opened = false,
        validated = false;
      const probe = v2FileProbeSchema.parse(
        await deps.probe({
          ownerId,
          workspaceId,
          fileId,
          uploadSession: u.id,
          uploadRevision: u.revision,
          byteLength: u.reserved_bytes,
          contentHash: manifest.contentHash,
          ...(deps.sessionId ? { requestSessionId: deps.sessionId } : {}),
          open: () => {
            if (opened) throw new FileError("INVALID_FILE");
            opened = true;
            return stream(ownerId, workspaceId, u, manifest, () => {
              validated = true;
            });
          },
        }),
      );
      if (!validated || probe.byteLength !== u.reserved_bytes) throw new FileError("INVALID_FILE");
      await consent(ownerId);
      assertSameTarget(await session(ownerId, workspaceId, fileId, u.id, true));
      const metadata = await files.metadata(actor(ownerId), fileId);
      if (!metadata) throw new FileError("NOT_FOUND");
      if (metadata.revision !== u.file_revision) throw new FileError("CONFLICT");
      if (metadata.uploadRejection) throw new DefinitiveFileRejection();
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
      // Probing and storage confirmation can outlive another file's publication.
      // The request's entry CAS already passed; revalidate this immutable upload
      // target before taking the final atomic workspace/file commit snapshot.
      await consent(ownerId);
      const commitUpload = await session(ownerId, workspaceId, fileId, u.id, true);
      assertSameTarget(commitUpload);
      const success = await files.finishUpload(
        {
          ...actor(ownerId),
          workspaceId,
          expectedRevision:
            deps.completionConsistency === FILE_TARGET_UPLOAD_CONSISTENCY
              ? commitUpload.workspace_revision
              : request.expectedRevision,
        },
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
        body: stream(ownerId, workspaceId, u, manifest, undefined, false),
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
        const access = () =>
          authorizeBlobCleanup(core, lease, target.target_id, row.object_key, now());
        if (
          !(await access()) ||
          !(unmeteredTest
            ? true
            : await maintenance.admit(target.target_id, row.object_key, "delete", access))
        )
          return false;
        await bucket().delete(row.object_key);
        if (
          !(await access()) ||
          !(unmeteredTest
            ? true
            : await maintenance.admit(target.target_id, row.object_key, "head", access))
        )
          return false;
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
