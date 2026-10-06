import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { type Actor, actorSchema, hashSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import {
  type BlobRegistration,
  blobSchema,
  storagePredicate,
  storageReservationStatements,
} from "./v2-storage";
import { type JobLease, leaseSchema } from "./v2-workspace";

const from = `FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_assets a ON a.id=j.target_id JOIN v2_profiles profile ON profile.id=a.profile_id JOIN v2_blobs original ON original.id=a.original_blob_id JOIN v2_storage_reservations original_res ON original_res.id=original.reservation_id JOIN v2_billing_principals principal ON principal.id=original.principal_id`;
function alive() {
  return `j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND j.target_kind='profile_asset' AND j.kind='portfolio_sanitize' AND o.kind='profile_asset' AND o.state IN ('admitted','ambiguous') AND ${jobAlive} AND a.owner_id=o.owner_id AND profile.owner_id=o.owner_id AND j.profile_id=profile.id AND a.state='sanitizing' AND a.purpose IN ('profile_photo','portfolio') AND original.state='stored' AND original.visibility='private' AND ((a.purpose='profile_photo' AND original.kind='profile_photo_original') OR (a.purpose='portfolio' AND original.kind='portfolio_original')) AND principal.owner_id=a.owner_id AND original_res.principal_id=principal.id AND original_res.kind='lawyer_asset' AND original_res.entity_id=a.id AND original_res.target_id=a.id AND original_res.state='stored'`;
}
type Source = {
  target_id: string;
  target_revision: number;
  operation_id: string;
  profile_id: string;
  purpose: string;
  asset_payload: string;
  original_id: string;
  original_payload: string;
  principal_id: string;
};
const select = `SELECT j.target_id,j.target_revision,j.operation_id,a.profile_id,a.purpose,a.encrypted_payload AS asset_payload,original.id AS original_id,original.encrypted_payload AS original_payload,principal.id AS principal_id ${from}`;
const metadataSchema = z.strictObject({
  contentHash: hashSchema,
  jobId: opaqueIdSchema,
  fencing: revisionSchema,
  targetId: opaqueIdSchema,
  targetRevision: revisionSchema,
  operationId: opaqueIdSchema,
  sourceBlobId: opaqueIdSchema,
  sourcePayload: z.string(),
  assetPayload: z.string(),
  purpose: z.enum(["profile_photo", "portfolio"]),
});
function values(actor: Actor, lease: JobLease) {
  return [lease.jobId, actor.ownerId, lease.token, lease.fencing, actor.now];
}
function sanitizedKind(purpose: string) {
  return purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized";
}
function valid(b: BlobRegistration) {
  return (
    b.visibility === "staging" &&
    b.keyVersion === "asset_sanitized_v1" &&
    b.logicalBytes <= 100000000 &&
    (b.kind === "profile_photo_sanitized" || b.kind === "portfolio_sanitized")
  );
}
export function prepareSanitizedAssetBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  input: BlobRegistration,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(leaseSchema, lease);
    const b = parse(blobSchema, input);
    if (!valid(b)) return false;
    const source = await core
      .statement(`${select} WHERE ${alive()}`, values(actor, lease))
      .first<Source>();
    if (!source || b.kind !== sanitizedKind(source.purpose)) return false;
    const payload = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
      contentHash: b.contentHash,
      jobId: lease.jobId,
      fencing: lease.fencing,
      targetId: source.target_id,
      targetRevision: source.target_revision,
      operationId: source.operation_id,
      sourceBlobId: source.original_id,
      sourcePayload: source.original_payload,
      assetPayload: source.asset_payload,
      purpose: source.purpose,
    });
    const claimId = crypto.randomUUID(),
      capacity = storagePredicate(actor.ownerId, b.logicalBytes);
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${from} WHERE ${alive()} AND a.encrypted_payload=? AND a.purpose=? AND original.id=? AND original.encrypted_payload=? AND ${capacity.sql} AND NOT EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=? OR target_id=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?)`,
        [
          claimId,
          ...values(actor, lease),
          source.asset_payload,
          source.purpose,
          source.original_id,
          source.original_payload,
          ...capacity.values,
          b.reservationId,
          b.id,
          b.id,
        ],
      ),
      ...storageReservationStatements(
        core,
        actor,
        {
          id: b.reservationId,
          kind: "lawyer_asset",
          profileId: source.profile_id,
          assetId: source.target_id,
          byteLength: b.logicalBytes,
          state: "reserved",
        },
        source.operation_id,
        claimId,
        b.id,
      ),
      core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at,source_blob_id,source_asset_revision) SELECT ?,principal_id,id,?,'staging','pending',?,?,?,?,?,?,?,?,? FROM v2_storage_reservations WHERE id=? AND ${sqlClaim}`,
        [
          b.id,
          b.kind,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          payload,
          actor.now,
          source.original_id,
          source.target_revision,
          b.reservationId,
          claimId,
        ],
      ),
      core.finish(claimId),
    ]);
  });
}
function readPendingSanitizedAssetBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blobId: string,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(leaseSchema, lease);
    parse(opaqueIdSchema, blobId);
    // Keep all identity columns and authorization in each bounded query.
    const query = `SELECT j.target_id,j.target_revision,j.operation_id,a.profile_id,a.purpose,a.encrypted_payload AS asset_payload,original.id AS original_id,original.encrypted_payload AS original_payload,principal.id AS principal_id,b.id,b.reservation_id,b.kind,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.key_version,b.encrypted_payload AS blob_payload,b.created_at ${from} JOIN v2_storage_reservations r ON r.entity_id=a.id AND r.operation_id=o.id JOIN v2_blobs b ON b.reservation_id=r.id AND b.principal_id=principal.id WHERE ${alive()} AND b.id=? AND b.state='pending' AND b.visibility='staging' AND b.object_key='private/'||b.id AND b.kind=CASE a.purpose WHEN 'profile_photo' THEN 'profile_photo_sanitized' ELSE 'portfolio_sanitized' END AND b.key_version='asset_sanitized_v1' AND b.cipher_hash IS NOT NULL AND b.source_blob_id=original.id AND b.source_asset_revision=a.revision AND r.principal_id=principal.id AND r.kind='lawyer_asset' AND r.state='reserved' AND r.workspace_id IS NULL AND r.target_id=b.id AND r.byte_length=b.logical_bytes AND b.logical_bytes BETWEEN 1 AND 100000000 AND b.created_at<=?`;
    type Pending = Source & {
      id: string;
      reservation_id: string;
      kind: BlobRegistration["kind"];
      logical_bytes: number;
      cipher_bytes: number;
      cipher_hash: string;
      key_version: string;
      blob_payload: string;
      created_at: string;
    };
    const args = [...values(actor, lease), blobId, actor.now],
      row = await core.statement(query, args).first<Pending>();
    if (!row) return null;
    const metadata = await core.decrypt(
      "v2_blobs",
      blobId,
      actor.ownerId,
      1,
      row.blob_payload,
      metadataSchema,
    );
    if (
      metadata.jobId !== lease.jobId ||
      metadata.fencing > lease.fencing ||
      metadata.targetId !== row.target_id ||
      metadata.targetRevision !== row.target_revision ||
      metadata.operationId !== row.operation_id ||
      metadata.sourceBlobId !== row.original_id ||
      metadata.sourcePayload !== row.original_payload ||
      metadata.assetPayload !== row.asset_payload ||
      metadata.purpose !== row.purpose
    )
      return null;
    const blob = parse(blobSchema, {
      id: row.id,
      reservationId: row.reservation_id,
      kind: row.kind,
      visibility: "staging",
      logicalBytes: row.logical_bytes,
      cipherBytes: row.cipher_bytes,
      cipherHash: row.cipher_hash,
      contentHash: metadata.contentHash,
      keyVersion: row.key_version,
    });
    const final = await core.statement(query, args).first<Pending>();
    return final && JSON.stringify(final) === JSON.stringify(row)
      ? {
          blob,
          preparedFencing: metadata.fencing,
          sourceBlobId: row.original_id,
          assetRevision: row.target_revision,
          anchor: row.blob_payload,
          source: row,
        }
      : null;
  });
}
export async function findPendingSanitizedAssetBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blobId: string,
) {
  const value = await readPendingSanitizedAssetBlob(core, actor, lease, blobId);
  return value
    ? {
        blob: value.blob,
        preparedFencing: value.preparedFencing,
        sourceBlobId: value.sourceBlobId,
        assetRevision: value.assetRevision,
      }
    : null;
}
export function commitSanitizedAssetBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  input: BlobRegistration,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(leaseSchema, lease);
    const b = parse(blobSchema, input);
    if (!valid(b)) return false;
    const pending = await readPendingSanitizedAssetBlob(core, actor, lease, b.id);
    if (
      !pending ||
      pending.preparedFencing !== lease.fencing ||
      JSON.stringify(pending.blob) !== JSON.stringify(b)
    )
      return false;
    const payload = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
        contentHash: b.contentHash,
      }),
      claimId = crypto.randomUUID(),
      source = pending.source;
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${from} WHERE ${alive()} AND a.encrypted_payload=? AND a.purpose=? AND original.id=? AND original.encrypted_payload=? AND EXISTS(SELECT 1 FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND r.id=? AND r.principal_id=principal.id AND b.principal_id=principal.id AND r.entity_id=a.id AND r.target_id=b.id AND r.kind='lawyer_asset' AND r.state='reserved' AND r.operation_id=o.id AND r.byte_length=? AND b.state='pending' AND b.kind=? AND b.visibility='staging' AND b.object_key=? AND b.logical_bytes=? AND b.cipher_bytes=? AND b.cipher_hash=? AND b.key_version=? AND b.encrypted_payload=? AND b.source_blob_id=original.id AND b.source_asset_revision=a.revision)`,
        [
          claimId,
          ...values(actor, lease),
          source.asset_payload,
          source.purpose,
          source.original_id,
          source.original_payload,
          b.id,
          b.reservationId,
          b.logicalBytes,
          b.kind,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          pending.anchor,
        ],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='stored',encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
        [payload, b.id, claimId],
      ),
      core.statement(
        `UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes-?,stored_bytes=stored_bytes+? WHERE principal_id=? AND ${sqlClaim}`,
        [b.logicalBytes, b.logicalBytes, source.principal_id, claimId],
      ),
      core.statement(
        `UPDATE v2_storage_reservations SET state='stored' WHERE id=? AND ${sqlClaim}`,
        [b.reservationId, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}
export function abandonSanitizedAssetBlob(core: V2Core, actor: Actor, blobId: string) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const claimId = crypto.randomUUID(),
      journalId = crypto.randomUUID();
    return core.changed([
      core.statement(
        "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,b.id,1 FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND p.owner_id=? AND r.principal_id=p.id AND r.kind='lawyer_asset' AND r.target_id=b.id AND b.state='pending' AND b.visibility='staging' AND b.kind IN ('profile_photo_sanitized','portfolio_sanitized') AND b.key_version='asset_sanitized_v1'",
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
