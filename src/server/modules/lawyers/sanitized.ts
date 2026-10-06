import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import { V2_LIMITS, v2PortfolioAssetSchema } from "../../../contracts/v2";
import { actorSchema, hashSchema, type V2Core } from "../../db/v2-core";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { hex } from "../files/binary";
import { boundedReader } from "./asset-binary";
import { LawyerError } from "./service";

/** Server-only #59 asset decoder. Neither input nor receipt comes from a client. */
export type OpenSanitizedAsset = (input: {
  ownerId: string;
  profileId: string;
  assetId: string;
  assetRevision: number;
  sourceBlobId: string;
}) => Promise<{ byteLength: number; contentHash: string; body: ReadableStream<Uint8Array> }>;

export function createSubmittedAssetReview(
  core: V2Core,
  deps: { clock?: () => string; openSanitized?: OpenSanitizedAsset },
) {
  const repository = createV2LawyersRepository(core);
  const actor = (ownerId: string) =>
    actorSchema.parse({
      ownerId,
      now: new Date(
        timestampSchema.parse((deps.clock ?? (() => new Date().toISOString()))()),
      ).toISOString(),
    });
  return {
    async open(reviewerId: string, sessionId: string, revisionId: string, assetId: string) {
      opaqueIdSchema.parse(revisionId);
      opaqueIdSchema.parse(assetId);
      const profile = await repository.readSubmittedProfileById(
        actor(reviewerId),
        sessionId,
        revisionId,
      );
      if (profile?.status !== "submitted") throw new LawyerError("NOT_FOUND");
      const ids = [
        profile.content.photoAssetId,
        ...profile.content.portfolio.flatMap((p) => (p.kind === "text" ? [] : [p.assetId])),
      ];
      if (!ids.includes(assetId)) throw new LawyerError("NOT_FOUND");
      const row = await core
        .statement(
          "SELECT a.owner_id,a.revision,a.encrypted_payload AS asset_payload,a.sanitized_blob_id,b.encrypted_payload AS blob_payload,b.logical_bytes FROM v2_profile_revision_assets link JOIN v2_assets a ON a.id=link.asset_id AND a.revision=link.asset_revision JOIN v2_profiles p ON p.id=a.profile_id AND p.owner_id=a.owner_id JOIN v2_blobs b ON b.id=a.sanitized_blob_id JOIN v2_billing_principals principal ON principal.id=b.principal_id AND principal.owner_id=a.owner_id WHERE link.revision_id=? AND a.id=? AND a.profile_id=? AND a.state='ready' AND b.state='stored' AND b.visibility='staging' AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized')) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=a.id)",
          [revisionId, assetId, profile.profileId],
        )
        .first<{
          owner_id: string;
          revision: number;
          asset_payload: string;
          sanitized_blob_id: string;
          blob_payload: string;
          logical_bytes: number;
        }>();
      if (!row) throw new LawyerError("NOT_FOUND");
      const authorized = async () => {
        const current = await repository.readSubmittedProfileById(
          actor(reviewerId),
          sessionId,
          revisionId,
        );
        if (
          !current ||
          current.revision !== profile.revision ||
          current.profileId !== profile.profileId ||
          JSON.stringify(current.content) !== JSON.stringify(profile.content)
        )
          return false;
        return !!(await core
          .statement(
            "SELECT a.id FROM v2_profile_revision_assets link JOIN v2_assets a ON a.id=link.asset_id AND a.revision=link.asset_revision JOIN v2_profiles p ON p.id=a.profile_id AND p.owner_id=a.owner_id JOIN v2_blobs b ON b.id=a.sanitized_blob_id JOIN v2_billing_principals principal ON principal.id=b.principal_id AND principal.owner_id=a.owner_id WHERE link.revision_id=? AND a.id=? AND a.owner_id=? AND a.profile_id=? AND a.revision=? AND a.state='ready' AND a.encrypted_payload=? AND b.id=? AND b.encrypted_payload=? AND b.state='stored' AND b.visibility='staging' AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized')) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='asset' AND target_id=a.id)",
            [
              revisionId,
              assetId,
              row.owner_id,
              profile.profileId,
              row.revision,
              row.asset_payload,
              row.sanitized_blob_id,
              row.blob_payload,
            ],
          )
          .first());
      };
      if (!(await authorized())) throw new LawyerError("NOT_FOUND");
      const asset = await core.decrypt(
        "v2_assets",
        assetId,
        row.owner_id,
        row.revision,
        row.asset_payload,
        v2PortfolioAssetSchema,
      );
      const receipt = await core.decrypt(
        "v2_blobs",
        row.sanitized_blob_id,
        row.owner_id,
        1,
        row.blob_payload,
        z.strictObject({ contentHash: hashSchema }),
      );
      if (
        asset.status !== "ready" ||
        !asset.sanitizedDerivative ||
        asset.sanitizedDerivative.byteLength !== row.logical_bytes ||
        asset.sanitizedDerivative.contentHash !== receipt.contentHash ||
        !(await authorized())
      )
        throw new LawyerError("ASSET_NOT_READY");
      if (!deps.openSanitized) throw new LawyerError("PROCESSING_UNAVAILABLE");
      const decoded = await deps.openSanitized({
        ownerId: row.owner_id,
        profileId: profile.profileId,
        assetId,
        assetRevision: row.revision,
        sourceBlobId: row.sanitized_blob_id,
      });
      if (
        decoded.byteLength !== row.logical_bytes ||
        decoded.contentHash !== receipt.contentHash ||
        !(await authorized())
      ) {
        await decoded.body.cancel().catch(() => {});
        throw new LawyerError("ASSET_NOT_READY");
      }
      const reader = boundedReader(decoded.body);
      const hash = sha256.create();
      let remaining = decoded.byteLength;
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              if (!(await authorized())) throw new LawyerError("NOT_FOUND");
              const chunk = await reader.exact(Math.min(remaining, V2_LIMITS.chunkBytes));
              hash.update(chunk);
              remaining -= chunk.length;
              if (!remaining) {
                await reader.end();
                if (hex(hash.digest()) !== receipt.contentHash)
                  throw new LawyerError("ASSET_NOT_READY");
              }
              if (!(await authorized())) throw new LawyerError("NOT_FOUND");
              controller.enqueue(chunk);
              if (!remaining) controller.close();
            } catch (error) {
              await reader.cancel();
              controller.error(error);
            }
          },
          cancel: () => reader.cancel(),
        },
        { highWaterMark: 0 },
      );
      return {
        body,
        byteLength: decoded.byteLength,
        contentType:
          asset.sanitizedDerivative.format === "pdf"
            ? "application/pdf"
            : `image/${asset.sanitizedDerivative.format}`,
      };
    },
  };
}
