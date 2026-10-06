import { opaqueIdSchema } from "../../../contracts";
import type { V2PublicLawyer } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { hex } from "../files/binary";
import { DirectoryError } from "./directory";

export type PublicAssetReads = {
  bucket?: Pick<R2Bucket, "get">;
  /** Trusted root port admits one bounded GET before R2 dispatch. */
  admitGet?: (blobId: string, objectKey: string) => Promise<boolean>;
};

export async function readPublicAsset(
  core: V2Core,
  profile: (id: string) => Promise<V2PublicLawyer>,
  deps: PublicAssetReads,
  profileId: string,
  assetId: string,
) {
  opaqueIdSchema.parse(assetId);
  const published = await profile(profileId);
  const asset = published.assets.find((entry) => entry.id === assetId);
  if (!asset) throw new DirectoryError("NOT_FOUND");
  const binding = async () =>
    core
      .statement(
        `SELECT b.id,b.object_key FROM v2_public_assets a JOIN v2_profiles p ON p.id=a.profile_id
        JOIN v2_profile_revisions r ON r.id=a.revision_id JOIN v2_blobs b ON b.id=a.public_blob_id
        WHERE a.profile_id=? AND a.asset_id=? AND a.revision_id=p.approved_revision_id
        AND r.revision=? AND r.status='approved' AND b.kind='public_copy' AND b.visibility='public'
        AND b.state='stored' AND b.cipher_bytes=? AND b.cipher_hash=?`,
        [profileId, assetId, published.approvedRevision, asset.byteLength, asset.contentHash],
      )
      .first<{ id: string; object_key: string }>();
  const selected = await binding();
  if (!selected || selected.object_key !== `public/${selected.id}`)
    throw new DirectoryError("NOT_FOUND");
  const current = async () => {
    try {
      const latest = await profile(profileId);
      const row = await binding();
      return (
        JSON.stringify(latest) === JSON.stringify(published) &&
        row?.id === selected.id &&
        row.object_key === selected.object_key
      );
    } catch {
      return false;
    }
  };
  if (!deps.bucket || !deps.admitGet || !(await current()))
    throw new DirectoryError("STORAGE_UNAVAILABLE");
  if (!(await deps.admitGet(selected.id, selected.object_key)) || !(await current()))
    throw new DirectoryError("STORAGE_UNAVAILABLE");
  const object = await deps.bucket.get(selected.object_key);
  if (!object || !("body" in object)) throw new DirectoryError("NOT_FOUND");
  const type = object.httpMetadata?.contentType;
  const checksum = object.checksums.sha256;
  if (
    typeof type !== "string" ||
    object.size !== asset.byteLength ||
    !checksum ||
    hex(new Uint8Array(checksum)) !== asset.contentHash ||
    !(asset.kind === "pdf"
      ? type === "application/pdf"
      : type === "image/jpeg" || type === "image/png" || type === "image/webp") ||
    !(await current())
  ) {
    await object.body.cancel();
    throw new DirectoryError("NOT_FOUND");
  }
  const reader = object.body.getReader();
  let remaining = asset.byteLength;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (!(await current())) throw new Error("PUBLIC_ASSET_WITHDRAWN");
          const chunk = await reader.read();
          if (chunk.done) {
            if (remaining !== 0) throw new Error("PUBLIC_ASSET_TRUNCATED");
            controller.close();
            return;
          }
          if (chunk.value.byteLength > remaining) throw new Error("PUBLIC_ASSET_SIZE_INVALID");
          remaining -= chunk.value.byteLength;
          if (!(await current())) throw new Error("PUBLIC_ASSET_WITHDRAWN");
          controller.enqueue(chunk.value);
        } catch (error) {
          await reader.cancel().catch(() => {});
          controller.error(error);
        }
      },
      cancel: () => reader.cancel(),
    },
    { highWaterMark: 0 },
  );
  return { body, type, size: asset.byteLength, kind: asset.kind };
}
