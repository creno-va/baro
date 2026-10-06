import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import {
  V2_LIMITS,
  type V2PublicLawyer,
  v2PortfolioAssetSchema,
  v2PublicLawyerSchema,
} from "../../../contracts/v2";
import { actorSchema, hashSchema, type V2Core } from "../../db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { createV2StorageRepository } from "../../db/v2-storage";
import { hex } from "../files/binary";
import type { PrivateBucket } from "../files/service";
import { boundedReader } from "./asset-binary";
import type { OpenSanitizedAsset } from "./sanitized";
import { LawyerError } from "./service";

export type PublicationDependencies = {
  publicBucket?: PrivateBucket;
  clock?: () => string;
  storageAdmission?: (input: {
    ownerId: string;
    profileId: string;
    assetId: string;
    approvedRevision: number;
    byteLength: number;
  }) => Promise<boolean>;
  /** Trusted #59 decoder; this callback never comes from a browser request. */
  openSanitized?: OpenSanitizedAsset;
  fixedLengthStream?: (length: number) => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
};
type Source = {
  assetId: string;
  assetRevision: number;
  blobId: string;
  byteLength: number;
  contentHash: string;
  kind: "image" | "pdf";
  format: "jpeg" | "png" | "webp" | "pdf";
  assetPayload: string;
  sourcePayload: string;
};

/** Internal outbox consumer only. Each copy is a bounded invocation; finalize
 * atomically publishes only after every immutable approved asset has a receipt. */
export function createLawyerPublicationService(core: V2Core, deps: PublicationDependencies) {
  const repository = createV2LawyersRepository(core);
  const storage = createV2StorageRepository(core);
  const deletion = createV2DeletionRepository(core);
  const now = () =>
    new Date(
      timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const actor = (ownerId: string) => actorSchema.parse({ ownerId, now: now() });
  const bucket = () => {
    if (!deps.publicBucket) throw new LawyerError("PROCESSING_UNAVAILABLE");
    return deps.publicBucket;
  };
  const snapshot = async (ownerId: string, profileId: string, revision: number) => {
    opaqueIdSchema.parse(profileId);
    revisionSchema.parse(revision);
    const target = await core
      .statement(
        "SELECT r.id,r.application_id FROM v2_profile_revisions r JOIN v2_profiles p ON p.id=r.profile_id WHERE p.id=? AND p.owner_id=? AND r.revision=? AND r.status='approved' AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=r.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id))",
        [profileId, ownerId, revision],
      )
      .first<{ id: string; application_id: string }>();
    if (!target) throw new LawyerError("REVIEW_REQUIRED");
    const profile = await repository.readProfileRevision(actor(ownerId), profileId, revision);
    const application = await repository.readApplication(actor(ownerId), target.application_id);
    if (
      profile?.status !== "approved" ||
      profile.id !== target.id ||
      application?.status !== "approved"
    )
      throw new LawyerError("REVIEW_REQUIRED");
    const ids = [
      ...new Set([
        profile.content.photoAssetId,
        ...profile.content.portfolio.flatMap((p) => (p.kind === "text" ? [] : [p.assetId])),
      ]),
    ];
    const sources: Source[] = [];
    for (const id of ids) {
      const row = await core
        .statement(
          "SELECT a.revision,a.encrypted_payload AS asset_payload,a.sanitized_blob_id,b.encrypted_payload AS source_payload,b.logical_bytes FROM v2_profile_revision_assets link JOIN v2_assets a ON a.id=link.asset_id AND a.revision=link.asset_revision JOIN v2_blobs b ON b.id=a.sanitized_blob_id WHERE link.revision_id=? AND a.id=? AND a.owner_id=? AND a.profile_id=? AND a.state='ready' AND b.state='stored' AND b.visibility='staging' AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized')) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=a.id)",
          [target.id, id, ownerId, profileId],
        )
        .first<{
          revision: number;
          asset_payload: string;
          sanitized_blob_id: string;
          source_payload: string;
          logical_bytes: number;
        }>();
      if (!row) throw new LawyerError("ASSET_NOT_READY");
      const asset = await core.decrypt(
        "v2_assets",
        id,
        ownerId,
        row.revision,
        row.asset_payload,
        v2PortfolioAssetSchema,
      );
      const hash = await core.decrypt(
        "v2_blobs",
        row.sanitized_blob_id,
        ownerId,
        1,
        row.source_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      if (
        asset.status !== "ready" ||
        !asset.sanitizedDerivative ||
        asset.sanitizedDerivative.id !== row.sanitized_blob_id ||
        asset.sanitizedDerivative.contentHash !== hash.contentHash ||
        asset.sanitizedDerivative.byteLength !== row.logical_bytes
      )
        throw new LawyerError("ASSET_NOT_READY");
      sources.push({
        assetId: id,
        assetRevision: row.revision,
        blobId: row.sanitized_blob_id,
        byteLength: row.logical_bytes,
        contentHash: hash.contentHash,
        kind: asset.kind,
        format: asset.sanitizedDerivative.format,
        assetPayload: row.asset_payload,
        sourcePayload: row.source_payload,
      });
    }
    return { target, profile, application, sources };
  };
  const authorized = async (
    ownerId: string,
    profileId: string,
    revisionId: string,
    source: Source,
  ) =>
    !!(await core
      .statement(
        "SELECT a.id FROM v2_profile_revision_assets link JOIN v2_assets a ON a.id=link.asset_id JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_profile_revisions r ON r.id=link.revision_id JOIN v2_blobs b ON b.id=a.sanitized_blob_id WHERE p.id=? AND p.owner_id=? AND r.id=? AND r.status='approved' AND a.id=? AND a.revision=? AND link.asset_revision=a.revision AND a.state='ready' AND a.encrypted_payload=? AND b.id=? AND b.state='stored' AND b.visibility='staging' AND b.encrypted_payload=? AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=p.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=r.application_id AND owner_id=p.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=p.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))",
        [
          profileId,
          ownerId,
          revisionId,
          source.assetId,
          source.assetRevision,
          source.assetPayload,
          source.blobId,
          source.sourcePayload,
        ],
      )
      .first());
  const storedCopy = async (ownerId: string, revisionId: string, source: Source) =>
    core
      .statement(
        "SELECT b.id,b.object_key,b.cipher_bytes,b.encrypted_payload FROM v2_blobs b JOIN v2_billing_principals principal ON principal.id=b.principal_id JOIN v2_storage_reservations reservation ON reservation.id=b.reservation_id WHERE principal.owner_id=? AND reservation.kind='lawyer_asset' AND reservation.entity_id=? AND reservation.state='stored' AND b.kind='public_copy' AND b.visibility='public' AND b.state='stored' AND b.approved_revision_id=? AND b.source_blob_id=? AND b.source_asset_revision=? AND b.logical_bytes=? AND b.cipher_bytes=? AND b.cipher_hash=? ORDER BY b.id LIMIT 1",
        [
          ownerId,
          source.assetId,
          revisionId,
          source.blobId,
          source.assetRevision,
          source.byteLength,
          source.byteLength,
          source.contentHash,
        ],
      )
      .first<{ id: string; object_key: string; cipher_bytes: number; encrypted_payload: string }>();
  return {
    /** Only identifiers leave the trusted service; profile content stays in D1. */
    async approvedAssetIds(ownerId: string, profileId: string, approvedRevision: number) {
      const current = await snapshot(ownerId, profileId, approvedRevision);
      return current.sources.map((source) => source.assetId);
    },
    async recoverInterruptedPublicCopies(limit = 8) {
      z.number().int().min(1).max(20).parse(limit);
      const cutoff = new Date(Date.parse(now()) - 300000).toISOString();
      const rows = (
        await core
          .statement(
            "SELECT b.id,p.owner_id FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.state='pending' AND b.kind='public_copy' AND b.visibility='public' AND b.created_at<=? ORDER BY b.created_at,b.id LIMIT ?",
            [cutoff, limit],
          )
          .all<{ id: string; owner_id: string | null }>()
      ).results;
      let recovered = 0;
      for (const row of rows)
        if (row.owner_id && (await storage.abandonApprovedPublicCopy(actor(row.owner_id), row.id)))
          recovered++;
      return recovered;
    },
    /** Actual public R2 deletion receipt, never a browser confirmation. */
    async cleanup(lease: CleanupLease) {
      const targets = await deletion.targets(lease, now(), 8);
      let confirmed = 0;
      for (const target of targets) {
        if (target.kind !== "blob") break;
        const blob = await core
          .statement(
            "SELECT object_key,cipher_hash FROM v2_blobs WHERE id=? AND kind='public_copy' AND visibility='public' AND state='deleting'",
            [target.target_id],
          )
          .first<{ object_key: string; cipher_hash: string | null }>();
        if (
          !blob ||
          blob.object_key !== target.object_key ||
          !/^public\/[A-Za-z0-9_-]{1,128}$/.test(blob.object_key)
        )
          return false;
        await bucket().delete(blob.object_key);
        if (await bucket().head(blob.object_key)) return false;
        if (
          !(await storage.confirmBlobDeleted(target.target_id, now(), {
            lease,
            receiptId: crypto.randomUUID(),
            objectKey: blob.object_key,
            cipherHash: blob.cipher_hash,
          }))
        )
          return false;
        confirmed++;
      }
      return confirmed > 0;
    },
    async copyApprovedAsset(
      ownerId: string,
      profileId: string,
      approvedRevision: number,
      assetId: string,
    ) {
      opaqueIdSchema.parse(assetId);
      const current = await snapshot(ownerId, profileId, approvedRevision);
      const source = current.sources.find((s) => s.assetId === assetId);
      if (!source) throw new LawyerError("NOT_FOUND");
      const prior = await storedCopy(ownerId, current.target.id, source);
      if (prior) {
        const object = await bucket().head(prior.object_key);
        if (
          !object ||
          object.key !== prior.object_key ||
          object.size !== source.byteLength ||
          !(await authorized(ownerId, profileId, current.target.id, source))
        )
          throw new LawyerError("ASSET_NOT_READY");
        return { assetId, blobId: prior.id };
      }
      if (
        !deps.openSanitized ||
        !(await deps.storageAdmission?.({
          ownerId,
          profileId,
          assetId,
          approvedRevision,
          byteLength: source.byteLength,
        }))
      )
        throw new LawyerError("PROCESSING_UNAVAILABLE");
      const blobId = crypto.randomUUID();
      const reservationId = crypto.randomUUID();
      if (
        !(await storage.prepareApprovedPublicCopy(actor(ownerId), {
          assetId,
          assetRevision: source.assetRevision,
          approvedRevisionId: current.target.id,
          sourceBlobId: source.blobId,
          blobId,
          reservationId,
        }))
      )
        throw new LawyerError("STALE_REVISION");
      const captured = await storage.captureApprovedPublicCopyIntent(actor(ownerId), blobId);
      if (!captured) {
        await storage.abandonApprovedPublicCopy(actor(ownerId), blobId).catch(() => false);
        throw new LawyerError("STALE_REVISION");
      }
      let putStarted = false;
      try {
        const decoded = await deps.openSanitized({
          ownerId,
          profileId,
          assetId,
          assetRevision: source.assetRevision,
          sourceBlobId: source.blobId,
        });
        if (
          decoded.byteLength !== source.byteLength ||
          decoded.contentHash !== source.contentHash
        ) {
          await decoded.body.cancel().catch(() => {});
          throw new LawyerError("ASSET_NOT_READY");
        }
        const pipe =
          deps.fixedLengthStream?.(source.byteLength) ?? new FixedLengthStream(source.byteLength);
        const writer = pipe.writable.getWriter();
        const reader = boundedReader(decoded.body);
        const hash = sha256.create();
        const copied = (async () => {
          try {
            let remaining = source.byteLength;
            while (remaining) {
              if (!(await authorized(ownerId, profileId, current.target.id, source)))
                throw new LawyerError("STALE_REVISION");
              const chunk = await reader.exact(Math.min(V2_LIMITS.chunkBytes, remaining));
              hash.update(chunk);
              await writer.write(chunk);
              remaining -= chunk.length;
            }
            await reader.end();
            if (
              hex(hash.digest()) !== source.contentHash ||
              !(await authorized(ownerId, profileId, current.target.id, source))
            )
              throw new LawyerError("ASSET_NOT_READY");
            await writer.close();
          } catch (error) {
            await reader.cancel();
            await writer.abort().catch(() => {});
            throw error;
          }
        })();
        putStarted = true;
        const saved = bucket()
          .put(`public/${blobId}`, pipe.readable, {
            sha256: source.contentHash,
            httpMetadata: {
              contentType: source.format === "pdf" ? "application/pdf" : `image/${source.format}`,
              contentDisposition:
                source.kind === "pdf" ? "attachment; filename=portfolio.pdf" : "inline",
            },
          })
          .catch((error) => {
            void writer.abort().catch(() => {});
            throw error;
          });
        let receipt: R2Object | null;
        try {
          [receipt] = await Promise.all([saved, copied]);
        } catch (error) {
          await pipe.readable.cancel().catch(() => {});
          await Promise.allSettled([saved, copied]);
          throw error;
        }
        if (!receipt || receipt.key !== `public/${blobId}` || receipt.size !== source.byteLength)
          throw new LawyerError("ASSET_NOT_READY");
        if (
          !(await storage.registerApprovedPublicCopy(
            actor(ownerId),
            {
              id: blobId,
              reservationId,
              kind: "public_copy",
              visibility: "public",
              logicalBytes: source.byteLength,
              cipherBytes: source.byteLength,
              cipherHash: source.contentHash,
              contentHash: source.contentHash,
              keyVersion: null,
            },
            {
              assetId,
              assetRevision: source.assetRevision,
              approvedRevisionId: current.target.id,
              sourceBlobId: source.blobId,
            },
          ))
        )
          throw new LawyerError("STALE_REVISION");
        return { assetId, blobId };
      } catch (error) {
        await storage.abandonApprovedPublicCopy(actor(ownerId), blobId).catch(() => false);
        if (putStarted) {
          const actual = await bucket()
            .head(`public/${blobId}`)
            .catch(() => null);
          if (actual?.key === `public/${blobId}`)
            await storage
              .requeueApprovedPublicCopyCleanup(actor(ownerId), captured)
              .catch(() => null);
        }
        throw error;
      }
    },
    async finalize(ownerId: string, profileId: string, approvedRevision: number) {
      const current = await snapshot(ownerId, profileId, approvedRevision);
      const published = await repository.publicProfile(profileId);
      if (
        published?.approvedRevision === approvedRevision &&
        JSON.stringify(published.content) === JSON.stringify(current.profile.content)
      )
        return published;
      const publicBlobIds: Record<string, string> = {};
      for (const source of current.sources) {
        const copy = await storedCopy(ownerId, current.target.id, source);
        if (!copy) throw new LawyerError("ASSET_NOT_READY");
        const hash = await core.decrypt(
          "v2_blobs",
          copy.id,
          ownerId,
          1,
          copy.encrypted_payload,
          z.strictObject({ contentHash: hashSchema }),
        );
        if (hash.contentHash !== source.contentHash) throw new LawyerError("ASSET_NOT_READY");
        publicBlobIds[source.assetId] = copy.id;
      }
      const value: V2PublicLawyer = v2PublicLawyerSchema.parse({
        schemaVersion: "2",
        id: profileId,
        approvedRevision,
        publishedAt: now(),
        content: current.profile.content,
        verification: {
          status: "manually_verified",
          identityChecked: true,
          licenseChecked: true,
          officeChecked: true,
          verifiedAt: current.application.reviewedAt,
        },
        assets: current.sources.map((s) => ({
          id: s.assetId,
          kind: s.kind,
          contentHash: s.contentHash,
          byteLength: s.byteLength,
          sanitization: "verified",
          approvedRevision,
        })),
      });
      if (!(await repository.publishApproved(actor(ownerId), value, publicBlobIds)))
        throw new LawyerError("STALE_REVISION");
      return value;
    },
  };
}
