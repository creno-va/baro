import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import {
  v2LawyerAssetUploadRequestSchema,
  v2PortfolioAssetSchema,
  v2VerificationAssetSchema,
} from "../../contracts/v2";
import { type Actor, actorSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { type BlobRegistration, blobSchema } from "./v2-storage";

export interface AssetUploadIntent {
  assetId: string;
  assetRevision: number;
  blobId: string;
  reservationId: string;
  keyVersion: string;
}
const intentSchema = z.strictObject({
  assetId: opaqueIdSchema,
  assetRevision: revisionSchema,
  profileId: opaqueIdSchema,
  assetPayload: z.string(),
});
const requestSchema = z.strictObject({ request: v2LawyerAssetUploadRequestSchema });
const from =
  "FROM v2_assets a JOIN v2_profiles profile ON profile.id=a.profile_id JOIN v2_storage_reservations r ON r.entity_id=a.id JOIN v2_billing_principals p ON p.id=r.principal_id JOIN v2_operations o ON o.id=r.operation_id";
const eligible = `a.id=? AND a.revision=? AND a.owner_id=? AND profile.owner_id=a.owner_id AND a.state='reserved' AND a.current_job_id IS NULL AND a.original_blob_id IS NULL AND r.id=? AND r.kind='lawyer_asset' AND r.state='reserved' AND r.workspace_id IS NULL AND r.target_id=a.id AND p.owner_id=a.owner_id AND o.owner_id=a.owner_id AND o.kind='profile_asset' AND o.state='admitted' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=profile.id) OR (target_kind='asset' AND target_id=a.id))`;
type Row = { purpose: string; profile_id: string; encrypted_payload: string; byte_length: number };
function kind(purpose: string) {
  return purpose === "profile_photo"
    ? "profile_photo_original"
    : purpose === "portfolio"
      ? "portfolio_original"
      : "verification";
}

export function prepareAssetUpload(core: V2Core, actor: Actor, input: AssetUploadIntent) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    for (const id of [input.assetId, input.blobId, input.reservationId]) parse(opaqueIdSchema, id);
    parse(revisionSchema, input.assetRevision);
    if (input.keyVersion !== "asset_binary_v1") return false;
    const values = [input.assetId, input.assetRevision, actor.ownerId, input.reservationId];
    const row = await core
      .statement(
        `SELECT a.purpose,a.profile_id,a.encrypted_payload,r.byte_length ${from} WHERE ${eligible}`,
        values,
      )
      .first<Row>();
    if (!row) return false;
    const { request } = await core.decrypt(
      "v2_assets",
      input.assetId,
      actor.ownerId,
      input.assetRevision,
      row.encrypted_payload,
      requestSchema,
    );
    if (request.purpose !== row.purpose || request.byteLength !== row.byte_length) return false;
    const envelope = await core.encrypt("v2_blobs", input.blobId, actor.ownerId, 1, {
      assetId: input.assetId,
      assetRevision: input.assetRevision,
      profileId: row.profile_id,
      assetPayload: row.encrypted_payload,
    });
    return (
      (
        await core
          .statement(
            `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,?,'private','pending',?,r.byte_length,0,NULL,?,?,? ${from} WHERE ${eligible} AND a.encrypted_payload=? AND a.purpose=? AND a.profile_id=? AND r.byte_length=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted')`,
            [
              input.blobId,
              kind(row.purpose),
              `private/${input.blobId}`,
              input.keyVersion,
              envelope,
              actor.now,
              ...values,
              row.encrypted_payload,
              row.purpose,
              row.profile_id,
              row.byte_length,
              input.blobId,
            ],
          )
          .run()
      ).meta.changes === 1
    );
  });
}

// Caller supplies a server-verified R2 receipt, never client success or hashes.
export function commitAssetUpload(
  core: V2Core,
  actor: Actor,
  input: { assetId: string; assetRevision: number; blob: BlobRegistration },
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, input.assetId);
    parse(revisionSchema, input.assetRevision);
    const b = parse(blobSchema, input.blob);
    if (b.keyVersion !== "asset_binary_v1" || b.visibility !== "private") return false;
    const values = [input.assetId, input.assetRevision, actor.ownerId, b.reservationId];
    const row = await core
      .statement(
        `SELECT a.purpose,a.profile_id,a.encrypted_payload,r.byte_length ${from} WHERE ${eligible}`,
        values,
      )
      .first<Row>();
    if (!row || kind(row.purpose) !== b.kind || row.byte_length !== b.logicalBytes) return false;
    const pending = await core
      .statement(
        "SELECT b.encrypted_payload,b.created_at FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.reservation_id=? AND b.state='pending' AND b.kind=? AND b.visibility='private' AND b.object_key=? AND b.logical_bytes=? AND b.cipher_bytes=0 AND b.cipher_hash IS NULL AND b.key_version=?",
        [
          b.id,
          actor.ownerId,
          b.reservationId,
          b.kind,
          `private/${b.id}`,
          b.logicalBytes,
          b.keyVersion,
        ],
      )
      .first<{ encrypted_payload: string; created_at: string }>();
    if (
      !pending ||
      Date.parse(pending.created_at) > Date.parse(actor.now) ||
      Date.parse(pending.created_at) + 300000 <= Date.parse(actor.now)
    )
      return false;
    const intent = await core.decrypt(
      "v2_blobs",
      b.id,
      actor.ownerId,
      1,
      pending.encrypted_payload,
      intentSchema,
    );
    if (
      intent.assetId !== input.assetId ||
      intent.assetRevision !== input.assetRevision ||
      intent.profileId !== row.profile_id ||
      intent.assetPayload !== row.encrypted_payload
    )
      return false;
    const { request } = await core.decrypt(
      "v2_assets",
      input.assetId,
      actor.ownerId,
      input.assetRevision,
      row.encrypted_payload,
      requestSchema,
    );
    if (request.purpose !== row.purpose || request.byteLength !== b.logicalBytes) return false;
    const next = input.assetRevision + 1;
    const value =
      row.purpose === "portfolio" || row.purpose === "profile_photo"
        ? parse(v2PortfolioAssetSchema, {
            id: input.assetId,
            revision: next,
            kind: request.mediaType === "application/pdf" ? "pdf" : "image",
            status: "uploaded",
            byteLength: b.logicalBytes,
            originalHash: b.contentHash,
            sanitizedDerivative: null,
            currentJobId: null,
            failure: null,
          })
        : parse(v2VerificationAssetSchema, {
            id: input.assetId,
            purpose: row.purpose,
            status: "uploaded",
            byteLength: b.logicalBytes,
            contentHash: b.contentHash,
          });
    const metadata = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
      contentHash: b.contentHash,
    });
    const assetEnvelope = await core.encrypt(
      "v2_assets",
      input.assetId,
      actor.ownerId,
      next,
      value,
    );
    const claimId = crypto.randomUUID();
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${from} WHERE ${eligible} AND a.encrypted_payload=? AND a.profile_id=? AND a.purpose=? AND r.byte_length=? AND EXISTS(SELECT 1 FROM v2_blobs WHERE id=? AND reservation_id=r.id AND principal_id=r.principal_id AND state='pending' AND kind=? AND visibility='private' AND object_key=? AND logical_bytes=? AND cipher_bytes=0 AND cipher_hash IS NULL AND key_version=? AND encrypted_payload=? AND created_at=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted' AND id!=?)`,
        [
          claimId,
          ...values,
          row.encrypted_payload,
          row.profile_id,
          row.purpose,
          row.byte_length,
          b.id,
          b.kind,
          `private/${b.id}`,
          b.logicalBytes,
          b.keyVersion,
          pending.encrypted_payload,
          pending.created_at,
          b.id,
        ],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='stored',cipher_bytes=?,cipher_hash=?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
        [b.cipherBytes, b.cipherHash, metadata, b.id, claimId],
      ),
      core.statement(
        `UPDATE v2_assets SET state='uploaded',revision=?,encrypted_payload=?,original_blob_id=? WHERE id=? AND ${sqlClaim}`,
        [next, assetEnvelope, b.id, input.assetId, claimId],
      ),
      core.statement(
        `UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes-?,stored_bytes=stored_bytes+? WHERE principal_id=(SELECT principal_id FROM v2_storage_reservations WHERE id=?) AND ${sqlClaim}`,
        [b.logicalBytes, b.logicalBytes, b.reservationId, claimId],
      ),
      core.statement(
        `UPDATE v2_storage_reservations SET state='stored' WHERE id=? AND ${sqlClaim}`,
        [b.reservationId, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}

export function abandonAssetUpload(core: V2Core, actor: Actor, blobId: string) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const claimId = crypto.randomUUID(),
      journalId = crypto.randomUUID();
    return core.changed([
      core.statement(
        "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,b.id,1 FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND p.owner_id=? AND b.state='pending' AND b.kind IN ('verification','profile_photo_original','portfolio_original') AND b.visibility='private' AND r.kind='lawyer_asset'",
        [claimId, blobId, actor.ownerId],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id=? AND ${sqlClaim}`,
        [blobId, claimId],
      ),
      core.statement(
        `INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? WHERE ${sqlClaim} ON CONFLICT(target_kind,target_id) DO NOTHING`,
        [journalId, blobId, actor.now, actor.now, claimId],
      ),
      core.statement(
        `INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT id,0,'blob',? FROM v2_deletion_journals WHERE target_kind='blob' AND target_id=? AND ${sqlClaim} ON CONFLICT(journal_id,kind,target_id) DO NOTHING`,
        [blobId, blobId, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}
