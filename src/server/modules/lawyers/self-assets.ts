import { v2PortfolioAssetSchema } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { createStorageMaintenance } from "../budget/storage-maintenance";
import { createAssetProcessingService } from "../file-processing/assets";
import { authorize } from "../file-processing/transport";
import type { PrivateBucket } from "../files/service";
import type { OpenSanitizedAsset } from "./sanitized";
import type { SelfProfile } from "./self-profile-contract";
import { LawyerError } from "./service";

export function selfAssetReferences(profile: SelfProfile) {
  return [
    ...(profile.photoAssetId ? [{ id: profile.photoAssetId, purpose: "profile_photo" }] : []),
    ...profile.portfolio.flatMap((p) =>
      p.assetId ? [{ id: p.assetId, purpose: "portfolio" }] : [],
    ),
  ];
}
const readyAsset = (
  correlated = false,
) => `SELECT a.revision,a.encrypted_payload,a.sanitized_blob_id,b.logical_bytes FROM v2_assets a
JOIN v2_blobs b ON b.id=a.sanitized_blob_id JOIN v2_billing_principals principal ON principal.id=b.principal_id
WHERE a.id=? AND ${correlated ? "a.owner_id=p.owner_id AND a.profile_id=p.id" : "a.owner_id=? AND a.profile_id=?"} AND a.purpose=? AND a.state='ready'
AND b.state='stored' AND b.visibility='staging' AND principal.owner_id=a.owner_id
AND ((a.purpose='profile_photo' AND b.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND b.kind='portfolio_sanitized'))
AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='asset' AND target_id=a.id) OR (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=a.profile_id))`;
async function source(
  core: V2Core,
  ownerId: string,
  profile: SelfProfile,
  assetId: string,
  purpose?: string,
) {
  const ref = selfAssetReferences(profile).find(
    (a) => a.id === assetId && (!purpose || a.purpose === purpose),
  );
  if (!ref) throw new LawyerError("NOT_FOUND");
  const row = await core.statement(readyAsset(), [ref.id, ownerId, profile.id, ref.purpose]).first<{
    revision: number;
    encrypted_payload: string;
    sanitized_blob_id: string;
    logical_bytes: number;
  }>();
  if (!row) throw new LawyerError("ASSET_NOT_READY");
  const asset = await core.decrypt(
    "v2_assets",
    ref.id,
    ownerId,
    row.revision,
    row.encrypted_payload,
    v2PortfolioAssetSchema,
  );
  if (
    asset.status !== "ready" ||
    asset.sanitizedDerivative?.id !== row.sanitized_blob_id ||
    asset.sanitizedDerivative.byteLength !== row.logical_bytes
  )
    throw new LawyerError("ASSET_NOT_READY");
  return { row, asset };
}
/** Save/publication checks use existing #58/#59 ready receipts; original or pending assets never become public. */
export async function requireSelfAssets(core: V2Core, ownerId: string, profile: SelfProfile) {
  for (const ref of selfAssetReferences(profile))
    await source(core, ownerId, profile, ref.id, ref.purpose);
}
/** Final mutation CAS also checks ready pointers, closing deletion/processing races after decryption. */
export function selfAssetClaim(profile: SelfProfile) {
  const refs = selfAssetReferences(profile);
  return {
    sql: refs.map(() => ` AND EXISTS(${readyAsset(true)})`).join(""),
    args: refs.flatMap((ref) => [ref.id, ref.purpose]),
  };
}
export function createSelfAssetReader(
  core: V2Core,
  options: {
    environment: "preview" | "production";
    bucket: PrivateBucket;
    clock?: () => string;
    /** Explicit offline decoder injection, never client-controlled. */
    openSanitized?: OpenSanitizedAsset;
  },
) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const maintenance = createStorageMaintenance(core, options.environment, clock);
  return async (
    ownerId: string,
    profile: SelfProfile,
    assetId: string,
    current: () => Promise<boolean>,
  ) => {
    const { row, asset } = await source(core, ownerId, profile, assetId);
    const valid = async () => {
      if (!(await current())) return false;
      try {
        const next = await source(core, ownerId, profile, assetId);
        return (
          next.row.revision === row.revision &&
          next.row.encrypted_payload === row.encrypted_payload &&
          next.row.sanitized_blob_id === row.sanitized_blob_id
        );
      } catch {
        return false;
      }
    };
    if (!(await valid())) throw new LawyerError("NOT_FOUND");
    // The existing storage maintenance allowance is consumed before GET. This read creates no processing job or new funding proof.
    const decoder =
      options.openSanitized ??
      createAssetProcessingService(core, {
        environment: options.environment,
        instanceId: "self-profile-ready-reader",
        bucket: options.bucket,
        clock,
        costs: {
          async before(input, access) {
            if (
              input.service !== "requests" ||
              input.action !== "r2_get" ||
              !(await authorize(access)) ||
              !(await valid())
            )
              return null;
            if (
              !(await maintenance.admit(
                row.sanitized_blob_id,
                `private/${row.sanitized_blob_id}`,
                "get",
                async () => (await authorize(access)) && (await valid()),
              ))
            )
              return null;
            // Local port marker for an already consumed maintenance allowance; no billing receipt is asserted.
            return { attemptId: row.sanitized_blob_id, dispatchToken: null };
          },
          async after() {},
        },
      }).openSanitized;
    const decoded = await decoder({
      ownerId,
      profileId: profile.id,
      assetId,
      assetRevision: row.revision,
      sourceBlobId: row.sanitized_blob_id,
    });
    if (
      decoded.byteLength !== row.logical_bytes ||
      decoded.contentHash !== asset.sanitizedDerivative?.contentHash ||
      !(await valid())
    ) {
      await decoded.body.cancel().catch(() => {});
      throw new LawyerError("ASSET_NOT_READY");
    }
    const reader = decoded.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          let bytes: Uint8Array | undefined;
          try {
            if (!(await valid())) throw new LawyerError("NOT_FOUND");
            const chunk = await reader.read();
            bytes = chunk.value;
            if (!(await valid())) throw new LawyerError("NOT_FOUND");
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch (error) {
            bytes?.fill(0);
            await reader.cancel().catch(() => {});
            controller.error(error);
          }
        },
        cancel: () => reader.cancel(),
      },
      { highWaterMark: 0 },
    );
    return {
      body,
      size: decoded.byteLength,
      type: asset.kind === "pdf" ? "application/pdf" : `image/${asset.sanitizedDerivative?.format}`,
      kind: asset.kind,
    };
  };
}
export function selfAssetResponse(
  asset: Awaited<ReturnType<ReturnType<typeof createSelfAssetReader>>>,
) {
  return new Response(asset.body, {
    headers: {
      "content-type": asset.type,
      "content-length": String(asset.size),
      "cache-control": "no-store",
      "content-disposition":
        asset.kind === "pdf" ? 'attachment; filename="portfolio.pdf"' : "inline",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
