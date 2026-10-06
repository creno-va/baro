import { z } from "zod";
import {
  idempotencyKeySchema,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../../../contracts";
import { v2LawyerAssetUploadRequestSchema } from "../../../contracts/v2";
import { createV2AccountingRepository } from "../../db/v2-accounting";
import { actorSchema, hashSchema, type V2Core } from "../../db/v2-core";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { type BlobRegistration, createV2StorageRepository } from "../../db/v2-storage";
import { digest } from "../files/binary";
import type { PrivateBucket } from "../files/service";
import { decryptAssetBinary, prepareAssetBinary } from "./asset-binary";
import { LawyerError } from "./service";

export type LawyerAssetDependencies = {
  environment: "preview" | "production";
  bucket?: PrivateBucket;
  clock?: () => string;
  /** Trusted budget/funding sink. A client cannot provide an approval or price. */
  storageAdmission?: (input: {
    ownerId: string;
    profileId: string;
    assetId: string;
    operationId: string;
    byteLength: number;
    kind: "reserve" | "upload";
  }) => Promise<boolean>;
  /** #59 processor owns format validation/sanitization + fenced ready publication. */
  enqueueProcessing?: (input: {
    ownerId: string;
    profileId: string;
    assetId: string;
    assetRevision: number;
    operationId: string;
  }) => Promise<boolean>;
  /** Only test adapters replace the Workers known-length stream constructor. */
  fixedLengthStream?: (length: number) => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
};
type AssetRow = {
  id: string;
  profile_id: string;
  revision: number;
  state: string;
  purpose: string;
  original_blob_id: string | null;
  encrypted_payload: string;
  reservation_id: string;
  operation_id: string;
  byte_length: number;
};
type BlobRow = {
  id: string;
  object_key: string;
  cipher_bytes: number;
  cipher_hash: string;
  encrypted_payload: string;
  logical_bytes: number;
  key_version: string;
};

export function createLawyerAssetsService(core: V2Core, deps: LawyerAssetDependencies) {
  const repository = createV2LawyersRepository(core);
  const storage = createV2StorageRepository(core);
  const accounting = createV2AccountingRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = (ownerId: string) => actorSchema.parse({ ownerId, now: now() });
  const bucket = () => {
    if (!deps.bucket) throw new LawyerError("PROCESSING_UNAVAILABLE");
    return deps.bucket;
  };
  const assetRow = async (ownerId: string, id: string) => {
    opaqueIdSchema.parse(id);
    const row = await core
      .statement(
        "SELECT a.*,r.id AS reservation_id,r.operation_id,r.byte_length FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_storage_reservations r ON r.entity_id=a.id AND r.kind='lawyer_asset' AND r.id=CASE WHEN a.original_blob_id IS NOT NULL THEN (SELECT reservation_id FROM v2_blobs WHERE id=a.original_blob_id) ELSE (SELECT id FROM v2_storage_reservations WHERE entity_id=a.id AND kind='lawyer_asset' ORDER BY created_at,id LIMIT 1) END JOIN v2_billing_principals principal ON principal.id=r.principal_id WHERE a.id=? AND a.owner_id=? AND principal.owner_id=a.owner_id AND r.state!='released' AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))",
        [id, ownerId],
      )
      .first<AssetRow>();
    if (!row) throw new LawyerError("NOT_FOUND");
    return row;
  };
  const allow = async (
    ownerId: string,
    row: Pick<AssetRow, "id" | "profile_id" | "operation_id" | "byte_length">,
    kind: "reserve" | "upload",
  ) => {
    if (
      !(await deps.storageAdmission?.({
        ownerId,
        profileId: row.profile_id,
        assetId: row.id,
        operationId: row.operation_id,
        byteLength: row.byte_length,
        kind,
      }))
    )
      throw new LawyerError("PROCESSING_UNAVAILABLE");
  };
  const blob = async (row: AssetRow, ownerId: string) => {
    const value = await core
      .statement(
        "SELECT b.* FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals principal ON principal.id=b.principal_id WHERE b.id=? AND b.state='stored' AND b.visibility='private' AND b.key_version='asset_binary_v1' AND b.kind IN ('verification','portfolio_original','profile_photo_original') AND r.id=? AND r.entity_id=? AND principal.owner_id=?",
        [row.original_blob_id, row.reservation_id, row.id, ownerId],
      )
      .first<BlobRow>();
    if (!value || value.logical_bytes !== row.byte_length) throw new LawyerError("NOT_FOUND");
    return value;
  };
  const open = async (
    ownerId: string,
    id: string,
    additionalAuth: () => Promise<boolean> = async () => true,
  ) => {
    if (!(await additionalAuth())) throw new LawyerError("NOT_FOUND");
    const row = await assetRow(ownerId, id);
    const original = await blob(row, ownerId);
    const receipt = await core.decrypt(
      "v2_blobs",
      original.id,
      ownerId,
      1,
      original.encrypted_payload,
      z.strictObject({ contentHash: hashSchema }),
    );
    const object = await bucket().get(original.object_key);
    if (!object || object.key !== original.object_key || object.size !== original.cipher_bytes) {
      await object?.body.cancel().catch(() => {});
      throw new LawyerError("NOT_FOUND");
    }
    const authorized = async () => {
      if (!(await additionalAuth())) return false;
      try {
        const current = await assetRow(ownerId, id);
        const currentBlob = await blob(current, ownerId);
        return (
          current.original_blob_id === original.id &&
          currentBlob.cipher_hash === original.cipher_hash &&
          currentBlob.encrypted_payload === original.encrypted_payload
        );
      } catch {
        return false;
      }
    };
    if (!(await authorized())) {
      await object.body.cancel().catch(() => {});
      throw new LawyerError("NOT_FOUND");
    }
    return {
      byteLength: original.logical_bytes,
      body: decryptAssetBinary(
        core.cipher,
        {
          environment: deps.environment,
          ownerId,
          assetId: id,
          assetRevision: 1,
          blobId: original.id,
          byteLength: original.logical_bytes,
        },
        object.body,
        { cipherHash: original.cipher_hash, contentHash: receipt.contentHash },
        authorized,
      ),
    };
  };
  return {
    async list(ownerId: string, group: "verification" | "portfolio", after?: string, limit = 20) {
      z.number().int().min(1).max(20).parse(limit);
      if (after) opaqueIdSchema.parse(after);
      const rows = (
        await core
          .statement(
            "SELECT a.id,a.revision,a.state FROM v2_assets a WHERE a.owner_id=? AND a.id>? AND ((?='verification' AND a.purpose IN ('identity','lawyer_license','office')) OR (?='portfolio' AND a.purpose IN ('profile_photo','portfolio'))) AND NOT EXISTS(SELECT 1 FROM v2_tombstones t WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=a.profile_id) OR (target_kind='asset' AND target_id=a.id)) ORDER BY a.id LIMIT ?",
            [ownerId, after ?? "", group, group, limit],
          )
          .all<{ id: string; revision: number; state: string }>()
      ).results;
      const items = [];
      for (const row of rows) {
        const value = await repository.readAsset(actor(ownerId), row.id);
        if (value) items.push({ assetId: row.id, revision: row.revision, value });
      }
      return { items, nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null };
    },
    async reserve(
      ownerId: string,
      expectedProfileRevision: number,
      key: string,
      input: unknown,
      group: "verification" | "portfolio",
    ) {
      const request = v2LawyerAssetUploadRequestSchema.parse(input);
      revisionSchema.parse(expectedProfileRevision);
      idempotencyKeySchema.parse(key);
      if (
        (group === "verification") !==
        ["identity", "lawyer_license", "office"].includes(request.purpose)
      )
        throw new LawyerError("ASSET_NOT_READY");
      const p = await core
        .statement(
          "SELECT id,revision FROM v2_profiles WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=owner_id) OR (target_kind='profile' AND target_id=v2_profiles.id))",
          [ownerId],
        )
        .first<{ id: string; revision: number }>();
      if (!p || p.revision !== expectedProfileRevision) throw new LawyerError("STALE_REVISION");
      const requestHash = await digest(
        new TextEncoder().encode(JSON.stringify({ expectedProfileRevision, request })),
      );
      const existing = await accounting.findOperation(
        actor(ownerId),
        `/api/v2/lawyers/${p.id}/assets`,
        key,
        requestHash,
      );
      if (existing?.kind === "conflict") throw new LawyerError("STALE_REVISION");
      if (existing?.kind === "replay") {
        const found = await core
          .statement(
            "SELECT entity_id FROM v2_storage_reservations WHERE operation_id=? AND kind='lawyer_asset' AND state!='released'",
            [existing.operation.id],
          )
          .first<string>("entity_id");
        if (!found) throw new LawyerError("STALE_REVISION");
        const row = await assetRow(ownerId, found);
        return {
          assetId: found,
          revision: row.revision,
          value: await repository.readAsset(actor(ownerId), found),
        };
      }
      const assetId = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      await allow(
        ownerId,
        {
          id: assetId,
          profile_id: p.id,
          operation_id: operationId,
          byte_length: request.byteLength,
        },
        "reserve",
      );
      let accepted: boolean;
      try {
        accepted = await repository.reserveAsset(
          actor(ownerId),
          p.id,
          p.revision,
          assetId,
          request,
          crypto.randomUUID(),
          { operationId, key, requestHash },
        );
      } catch (error) {
        // A racing identical request can commit between lookup and the guarded
        // reservation batch. Resolve only its exact committed operation.
        const winner = await accounting.findOperation(
          actor(ownerId),
          `/api/v2/lawyers/${p.id}/assets`,
          key,
          requestHash,
        );
        if (winner?.kind !== "replay") throw error;
        const found = await core
          .statement(
            "SELECT entity_id FROM v2_storage_reservations WHERE operation_id=? AND kind='lawyer_asset' AND state!='released'",
            [winner.operation.id],
          )
          .first<string>("entity_id");
        if (!found) throw new LawyerError("STALE_REVISION");
        const row = await assetRow(ownerId, found);
        return {
          assetId: found,
          revision: row.revision,
          value: await repository.readAsset(actor(ownerId), found),
        };
      }
      if (!accepted) throw new LawyerError("STALE_REVISION");
      return { assetId, revision: 1, value: { request } };
    },
    async upload(
      ownerId: string,
      assetId: string,
      expectedRevision: number,
      byteLength: number,
      body: ReadableStream<Uint8Array> | null,
    ) {
      revisionSchema.parse(expectedRevision);
      const row = await assetRow(ownerId, assetId);
      if (row.revision !== expectedRevision || row.state !== "reserved" || row.original_blob_id)
        throw new LawyerError("STALE_REVISION");
      if (!body || byteLength !== row.byte_length) throw new LawyerError("ASSET_NOT_READY");
      await allow(ownerId, row, "upload");
      const targetBucket = bucket();
      const blobId = crypto.randomUUID();
      const reserved = await repository.readAsset(actor(ownerId), assetId);
      if (!reserved || !("request" in reserved)) throw new LawyerError("STALE_REVISION");
      if (
        !(await storage.prepareAssetUpload(actor(ownerId), {
          assetId,
          assetRevision: expectedRevision,
          blobId,
          reservationId: row.reservation_id,
          keyVersion: "asset_binary_v1",
        }))
      )
        throw new LawyerError("STALE_REVISION");
      try {
        const binary = await prepareAssetBinary(
          core.cipher,
          {
            environment: deps.environment,
            ownerId,
            assetId,
            assetRevision: expectedRevision,
            blobId,
            byteLength,
          },
          { name: reserved.request.name, mediaType: reserved.request.mediaType },
        );
        const pipe =
          deps.fixedLengthStream?.(binary.cipherBytes) ?? new FixedLengthStream(binary.cipherBytes);
        const writer = pipe.writable.getWriter();
        const upload = targetBucket.put(`private/${blobId}`, pipe.readable, {
          httpMetadata: { contentType: "application/octet-stream" },
        });
        const encoded = binary.write(body, writer);
        // Both consumers settle; an R2 failure aborts the writer and source.
        const saved = upload.catch((error) => {
          void writer.abort().catch(() => {});
          throw error;
        });
        let receipt: R2Object | null;
        let hashes: { contentHash: string; cipherHash: string };
        try {
          [receipt, hashes] = await Promise.all([saved, encoded]);
        } catch (error) {
          await pipe.readable.cancel().catch(() => {});
          await Promise.allSettled([saved, encoded]);
          throw error;
        }
        if (!receipt || receipt.key !== `private/${blobId}` || receipt.size !== binary.cipherBytes)
          throw new LawyerError("ASSET_NOT_READY");
        const registration: BlobRegistration = {
          id: blobId,
          reservationId: row.reservation_id,
          kind:
            row.purpose === "portfolio"
              ? "portfolio_original"
              : row.purpose === "profile_photo"
                ? "profile_photo_original"
                : "verification",
          visibility: "private",
          logicalBytes: byteLength,
          cipherBytes: binary.cipherBytes,
          ...hashes,
          keyVersion: "asset_binary_v1",
        };
        if (
          !(await storage.commitAssetUpload(actor(ownerId), {
            assetId,
            assetRevision: expectedRevision,
            blob: registration,
          }))
        )
          throw new LawyerError("STALE_REVISION");
        let processingQueued = false;
        if (deps.enqueueProcessing)
          processingQueued = await deps
            .enqueueProcessing({
              ownerId,
              profileId: row.profile_id,
              assetId,
              assetRevision: expectedRevision + 1,
              operationId: row.operation_id,
            })
            .catch(() => false);
        return {
          assetId,
          revision: expectedRevision + 1,
          value: await repository.readAsset(actor(ownerId), assetId),
          processingQueued,
        };
      } catch (error) {
        await storage.abandonAssetUpload(actor(ownerId), blobId).catch(() => false);
        throw error;
      }
    },
    open,
    /** Internal scheduler only; bounded stale unknown intents retain live asset reservations. */
    async recoverInterruptedAssetUploads(limit = 8) {
      z.number().int().min(1).max(20).parse(limit);
      const cutoff = new Date(Date.parse(now()) - 300000).toISOString();
      const rows = (
        await core
          .statement(
            "SELECT b.id,p.owner_id FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.state='pending' AND b.kind IN ('verification','portfolio_original','profile_photo_original') AND b.visibility='private' AND b.key_version='asset_binary_v1' AND b.created_at<=? ORDER BY b.created_at,b.id LIMIT ?",
            [cutoff, limit],
          )
          .all<{ id: string; owner_id: string | null }>()
      ).results;
      let recovered = 0;
      for (const row of rows)
        if (row.owner_id && (await storage.abandonAssetUpload(actor(row.owner_id), row.id)))
          recovered++;
      return recovered;
    },
    async moderatorOpen(
      reviewerId: string,
      sessionId: string,
      applicationId: string,
      assetId: string,
    ) {
      const permitted = async () =>
        !!(await repository.readSubmittedVerification(
          actor(reviewerId),
          sessionId,
          applicationId,
          assetId,
        ));
      if (!(await permitted())) throw new LawyerError("NOT_FOUND");
      const owner = await core
        .statement("SELECT owner_id FROM v2_applications WHERE id=? AND status='submitted'", [
          applicationId,
        ])
        .first<string>("owner_id");
      if (!owner) throw new LawyerError("NOT_FOUND");
      return open(owner, assetId, permitted);
    },
  };
}
