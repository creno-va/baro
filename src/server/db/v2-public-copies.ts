import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { v2PortfolioAssetSchema } from "../../contracts/v2";
import { type Actor, actorSchema, hashSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import {
  type BlobRegistration,
  blobSchema,
  storagePredicate,
  storageReservationStatements,
} from "./v2-storage";
import { isPreparedStoragePaidHold, type PreparedStoragePaidHold } from "./v2-storage-paid-runtime";

export interface PublicCopyIntent {
  assetId: string;
  assetRevision: number;
  approvedRevisionId: string;
  sourceBlobId: string;
  blobId: string;
  reservationId: string;
}
const sourceFrom = `FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_profile_revision_assets ra ON ra.asset_id=a.id AND ra.asset_revision=a.revision JOIN v2_profile_revisions revision ON revision.id=ra.revision_id JOIN v2_blobs source ON source.id=a.sanitized_blob_id JOIN v2_storage_reservations original ON original.id=source.reservation_id JOIN v2_billing_principals principal ON principal.id=source.principal_id`;
const sourceGuard = `a.id=? AND a.revision=? AND a.owner_id=? AND p.owner_id=a.owner_id AND a.state='ready' AND a.current_job_id IS NULL AND a.purpose IN ('profile_photo','portfolio') AND revision.id=? AND revision.profile_id=p.id AND revision.status='approved' AND source.id=? AND source.state='stored' AND source.visibility='staging' AND ((a.purpose='profile_photo' AND source.kind='profile_photo_sanitized') OR (a.purpose='portfolio' AND source.kind='portfolio_sanitized')) AND principal.owner_id=a.owner_id AND original.principal_id=principal.id AND original.entity_id=a.id AND original.kind='lawyer_asset' AND original.state='stored' AND original.target_id=source.id AND source.logical_bytes BETWEEN 1 AND 100000000 AND EXISTS(SELECT 1 FROM v2_moderation_decisions d WHERE d.target_kind='profile' AND d.target_id=revision.id AND d.target_revision=revision.revision AND d.decision='approve') AND NOT EXISTS(SELECT 1 FROM v2_profile_revisions newer WHERE newer.profile_id=p.id AND newer.status='approved' AND newer.revision>revision.revision) AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=a.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=revision.application_id AND owner_id=a.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`;
type Source = {
  profile_id: string;
  asset_payload: string;
  revision_payload: string;
  source_payload: string;
  logical_bytes: number;
  operation_id: string;
};
const sourceSelect = `SELECT p.id AS profile_id,a.encrypted_payload AS asset_payload,revision.encrypted_payload AS revision_payload,source.encrypted_payload AS source_payload,source.logical_bytes,original.operation_id ${sourceFrom} WHERE ${sourceGuard}`;
const anchorSchema = z.strictObject({
  assetId: opaqueIdSchema,
  assetRevision: revisionSchema,
  approvedRevisionId: opaqueIdSchema,
  sourceBlobId: opaqueIdSchema,
  contentHash: hashSchema,
  assetPayload: z.string(),
  revisionPayload: z.string(),
  sourcePayload: z.string(),
});
function validate(actor: Actor, input: PublicCopyIntent) {
  actor = parse(actorSchema, actor);
  for (const id of [
    input.assetId,
    input.approvedRevisionId,
    input.sourceBlobId,
    input.blobId,
    input.reservationId,
  ])
    parse(opaqueIdSchema, id);
  parse(revisionSchema, input.assetRevision);
  return {
    actor,
    values: [
      input.assetId,
      input.assetRevision,
      actor.ownerId,
      input.approvedRevisionId,
      input.sourceBlobId,
    ],
  };
}
export function prepareApprovedPublicCopy(
  core: V2Core,
  actor: Actor,
  input: PublicCopyIntent,
  paid?: PreparedStoragePaidHold,
) {
  return safe(async () => {
    const validated = validate(actor, input);
    actor = validated.actor;
    if (
      paid &&
      (!isPreparedStoragePaidHold(paid) ||
        paid.actor.ownerId !== actor.ownerId ||
        paid.actor.now !== actor.now ||
        paid.request.intent.kind !== "approved_public_copy" ||
        paid.request.intent.approvedRevisionId !== input.approvedRevisionId ||
        paid.request.intent.sourceBlobId !== input.sourceBlobId ||
        paid.request.targetKind !== "profile_asset" ||
        paid.request.targetId !== input.assetId ||
        paid.request.targetRevision !== input.assetRevision ||
        paid.request.blobId !== input.blobId ||
        paid.request.reservationId !== input.reservationId ||
        paid.request.pending.cipherBytes !== 0 ||
        paid.request.pending.cipherHash !== null ||
        paid.request.pending.keyVersion !== null)
    )
      return false;
    const source = await core.statement(sourceSelect, validated.values).first<Source>();
    if (!source) return false;
    if (paid && paid.request.pending.logicalBytes !== source.logical_bytes) return false;
    const { contentHash } = await core.decrypt(
      "v2_blobs",
      input.sourceBlobId,
      actor.ownerId,
      1,
      source.source_payload,
      z.strictObject({ contentHash: hashSchema }),
    );
    const asset = await core.decrypt(
      "v2_assets",
      input.assetId,
      actor.ownerId,
      input.assetRevision,
      source.asset_payload,
      v2PortfolioAssetSchema,
    );
    if (
      asset.id !== input.assetId ||
      asset.revision !== input.assetRevision ||
      asset.status !== "ready" ||
      asset.sanitizedDerivative?.id !== input.sourceBlobId ||
      asset.sanitizedDerivative.contentHash !== contentHash ||
      asset.sanitizedDerivative.byteLength !== source.logical_bytes
    )
      return false;
    const anchor = await core.encrypt("v2_blobs", input.blobId, actor.ownerId, 1, {
      assetId: input.assetId,
      assetRevision: input.assetRevision,
      approvedRevisionId: input.approvedRevisionId,
      sourceBlobId: input.sourceBlobId,
      contentHash,
      assetPayload: source.asset_payload,
      revisionPayload: source.revision_payload,
      sourcePayload: source.source_payload,
    });
    const claimId = crypto.randomUUID(),
      capacity = storagePredicate(actor.ownerId, source.logical_bytes);
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${sourceFrom} WHERE ${sourceGuard} AND a.encrypted_payload=? AND revision.encrypted_payload=? AND source.encrypted_payload=? AND source.logical_bytes=? AND ${capacity.sql} AND NOT EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=? OR target_id=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) ${paid ? `AND (${paid.predicate.sql})` : ""}`,
        [
          claimId,
          ...validated.values,
          source.asset_payload,
          source.revision_payload,
          source.source_payload,
          source.logical_bytes,
          ...capacity.values,
          input.reservationId,
          input.blobId,
          input.blobId,
          ...(paid ? paid.predicate.values : []),
        ],
      ),
      ...storageReservationStatements(
        core,
        actor,
        {
          id: input.reservationId,
          kind: "lawyer_asset",
          profileId: source.profile_id,
          assetId: input.assetId,
          byteLength: source.logical_bytes,
          state: "reserved",
        },
        paid?.request.plan.operationId ?? source.operation_id,
        claimId,
        input.blobId,
      ),
      core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at,source_blob_id,source_asset_revision,approved_revision_id) SELECT ?,r.principal_id,r.id,'public_copy','public','pending',?,r.byte_length,0,NULL,NULL,?,?,?, ?,? FROM v2_storage_reservations r WHERE r.id=? AND ${sqlClaim}`,
        [
          input.blobId,
          `public/${input.blobId}`,
          anchor,
          actor.now,
          input.sourceBlobId,
          input.assetRevision,
          input.approvedRevisionId,
          input.reservationId,
          claimId,
        ],
      ),
      ...(paid ? await paid.statements(core, paid.actor, claimId, anchor) : []),
      core.finish(claimId),
    ]);
  });
}
// Only called after the public bucket's actual key, size and full hash match.
export function commitPreparedPublicCopy(
  core: V2Core,
  actor: Actor,
  input: BlobRegistration,
  provenance: Omit<PublicCopyIntent, "blobId" | "reservationId">,
) {
  return safe(async () => {
    const b = parse(blobSchema, input),
      validated = validate(actor, { ...provenance, blobId: b.id, reservationId: b.reservationId });
    actor = validated.actor;
    if (
      b.kind !== "public_copy" ||
      b.visibility !== "public" ||
      b.keyVersion !== null ||
      b.cipherBytes !== b.logicalBytes ||
      b.cipherHash !== b.contentHash
    )
      return false;
    const source = await core.statement(sourceSelect, validated.values).first<Source>();
    if (!source || source.logical_bytes !== b.logicalBytes) return false;
    const row = await core
      .statement(
        "SELECT b.encrypted_payload,b.created_at FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.id=? AND r.kind='lawyer_asset' AND r.state='reserved' AND r.target_id=b.id AND r.entity_id=? AND r.principal_id=b.principal_id AND r.byte_length=? AND b.state='pending' AND b.kind='public_copy' AND b.visibility='public' AND b.object_key=? AND b.logical_bytes=? AND b.cipher_bytes=0 AND b.cipher_hash IS NULL AND b.key_version IS NULL AND b.source_blob_id=? AND b.source_asset_revision=? AND b.approved_revision_id=?",
        [
          b.id,
          actor.ownerId,
          b.reservationId,
          provenance.assetId,
          b.logicalBytes,
          `public/${b.id}`,
          b.logicalBytes,
          provenance.sourceBlobId,
          provenance.assetRevision,
          provenance.approvedRevisionId,
        ],
      )
      .first<{ encrypted_payload: string; created_at: string }>();
    if (
      !row ||
      Date.parse(row.created_at) > Date.parse(actor.now) ||
      Date.parse(row.created_at) + 300000 <= Date.parse(actor.now)
    )
      return false;
    const anchor = await core.decrypt(
      "v2_blobs",
      b.id,
      actor.ownerId,
      1,
      row.encrypted_payload,
      anchorSchema,
    );
    if (
      anchor.assetId !== provenance.assetId ||
      anchor.assetRevision !== provenance.assetRevision ||
      anchor.approvedRevisionId !== provenance.approvedRevisionId ||
      anchor.sourceBlobId !== provenance.sourceBlobId ||
      anchor.contentHash !== b.contentHash ||
      anchor.assetPayload !== source.asset_payload ||
      anchor.revisionPayload !== source.revision_payload ||
      anchor.sourcePayload !== source.source_payload
    )
      return false;
    const payload = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
        contentHash: b.contentHash,
      }),
      claimId = crypto.randomUUID();
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${sourceFrom} WHERE ${sourceGuard} AND a.encrypted_payload=? AND revision.encrypted_payload=? AND source.encrypted_payload=? AND source.logical_bytes=? AND EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND b.principal_id=principal.id AND r.principal_id=principal.id AND r.id=? AND r.kind='lawyer_asset' AND r.state='reserved' AND r.entity_id=a.id AND r.target_id=b.id AND r.byte_length=? AND b.state='pending' AND b.object_key=? AND b.kind='public_copy' AND b.visibility='public' AND b.logical_bytes=? AND b.cipher_bytes=0 AND b.cipher_hash IS NULL AND b.key_version IS NULL AND b.source_blob_id=source.id AND b.source_asset_revision=a.revision AND b.approved_revision_id=revision.id AND b.encrypted_payload=? AND b.created_at=?)`,
        [
          claimId,
          ...validated.values,
          source.asset_payload,
          source.revision_payload,
          source.source_payload,
          source.logical_bytes,
          b.id,
          b.reservationId,
          b.logicalBytes,
          `public/${b.id}`,
          b.logicalBytes,
          row.encrypted_payload,
          row.created_at,
        ],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='stored',cipher_bytes=?,cipher_hash=?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
        [b.cipherBytes, b.cipherHash, payload, b.id, claimId],
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
export function abandonApprovedPublicCopy(core: V2Core, actor: Actor, blobId: string) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const claimId = crypto.randomUUID(),
      journalId = crypto.randomUUID();
    return core.changed([
      core.statement(
        "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,b.id,1 FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND p.owner_id=? AND r.principal_id=p.id AND r.kind='lawyer_asset' AND r.target_id=b.id AND b.state='pending' AND b.kind='public_copy' AND b.visibility='public' AND b.cipher_hash IS NULL AND b.cipher_bytes=0 AND b.key_version IS NULL",
        [claimId, blobId, actor.ownerId],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='deleting',encrypted_payload='removed' WHERE id=? AND ${sqlClaim}`,
        [blobId, claimId],
      ),
      core.statement(
        `INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? WHERE ${sqlClaim}`,
        [journalId, blobId, actor.now, actor.now, claimId],
      ),
      core.statement(
        `INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT ?,0,'blob',? WHERE ${sqlClaim}`,
        [journalId, blobId, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}
