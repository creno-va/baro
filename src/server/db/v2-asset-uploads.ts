import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import {
  v2LawyerAssetUploadRequestSchema,
  v2PortfolioAssetSchema,
  v2VerificationAssetSchema,
} from "../../contracts/v2";
import { type Actor, actorSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { findPendingSanitizedAssetBlob } from "./v2-sanitized-asset-blobs";
import { type BlobRegistration, blobSchema } from "./v2-storage";
import { isPreparedStoragePaidHold, type PreparedStoragePaidHold } from "./v2-storage-paid-runtime";
import { type JobLease, leaseSchema } from "./v2-workspace";

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
const capturedIntents = new WeakSet<object>();
export interface AssetUploadCleanupIntent {
  readonly ownerId: string;
  readonly principalId: string;
  readonly blobId: string;
  readonly reservationId: string;
  readonly objectKey: string;
  readonly logicalBytes: number;
  readonly keyVersion: string | null;
  readonly kind: string;
  readonly visibility: "private" | "public" | "staging";
  readonly cipherHash: string | null;
  readonly cipherBytes: number;
}
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

// A server-only capability captured before PUT. It cannot be reconstructed from
// request JSON, and remains bound to the retained billing owner after deletion.
export function captureAssetUploadIntent(core: V2Core, actor: Actor, blobId: string) {
  return captureUploadIntent(core, actor, blobId, false);
}
export function captureApprovedPublicCopyIntent(core: V2Core, actor: Actor, blobId: string) {
  return captureUploadIntent(core, actor, blobId, true);
}
function captureUploadIntent(core: V2Core, actor: Actor, blobId: string, publicCopy: boolean) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const captureFrom = publicCopy
      ? from.replace(" JOIN v2_operations o ON o.id=r.operation_id", "")
      : from;
    const row = await core
      .statement(
        `SELECT b.principal_id,b.reservation_id,b.object_key,b.logical_bytes,b.key_version,b.kind,b.visibility ${captureFrom} JOIN v2_blobs b ON b.reservation_id=r.id AND b.principal_id=p.id WHERE b.id=? AND a.owner_id=? AND profile.owner_id=a.owner_id AND p.owner_id=a.owner_id AND r.kind='lawyer_asset' AND r.state='reserved' AND r.byte_length=b.logical_bytes AND b.state='pending' AND b.cipher_hash IS NULL AND b.cipher_bytes=0 AND ${publicCopy ? "a.state='ready' AND r.target_id=b.id AND b.visibility='public' AND b.kind='public_copy' AND b.key_version IS NULL AND b.source_asset_revision=a.revision AND b.source_blob_id=a.sanitized_blob_id AND EXISTS(SELECT 1 FROM v2_profile_revisions revision WHERE revision.id=b.approved_revision_id AND revision.profile_id=profile.id AND revision.status='approved') AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=a.owner_id AND role='verified_lawyer')" : "a.state='reserved' AND a.original_blob_id IS NULL AND r.target_id=a.id AND b.visibility='private' AND b.kind IN ('verification','portfolio_original','profile_photo_original') AND b.key_version='asset_binary_v1'"} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=profile.id) OR (target_kind='asset' AND target_id=a.id))`,
        [blobId, actor.ownerId],
      )
      .first<{
        principal_id: string;
        reservation_id: string;
        object_key: string;
        logical_bytes: number;
        key_version: string | null;
        kind: string;
        visibility: "private" | "public";
      }>();
    if (!row) return null;
    const value: AssetUploadCleanupIntent = Object.freeze({
      ownerId: actor.ownerId,
      principalId: row.principal_id,
      blobId,
      reservationId: row.reservation_id,
      objectKey: row.object_key,
      logicalBytes: row.logical_bytes,
      keyVersion: row.key_version,
      kind: row.kind,
      visibility: row.visibility,
      cipherHash: null,
      cipherBytes: 0,
    });
    capturedIntents.add(value);
    return value;
  });
}

export function captureSanitizedAssetBlobIntent(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blobId: string,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(leaseSchema, lease);
    parse(opaqueIdSchema, blobId);
    const pending = await findPendingSanitizedAssetBlob(core, actor, lease, blobId);
    if (!pending || pending.preparedFencing !== lease.fencing) return null;
    const b = pending.blob;
    const row = await core
      .statement(
        `SELECT b.principal_id FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_assets a ON a.id=r.entity_id JOIN v2_profiles profile ON profile.id=a.profile_id JOIN v2_jobs j ON j.id=a.current_job_id JOIN v2_operations o ON o.id=j.operation_id WHERE b.id=? AND p.owner_id=? AND a.owner_id=p.owner_id AND profile.owner_id=p.owner_id AND r.principal_id=p.id AND r.kind='lawyer_asset' AND r.state='reserved' AND r.target_id=b.id AND r.id=? AND r.operation_id=j.operation_id AND r.byte_length=b.logical_bytes AND b.state='pending' AND b.visibility='staging' AND b.kind=? AND b.object_key=? AND b.key_version=? AND b.logical_bytes=? AND b.cipher_bytes=? AND b.cipher_hash=? AND b.source_blob_id=a.original_blob_id AND a.original_blob_id=? AND b.source_asset_revision=a.revision AND a.revision=? AND a.state='sanitizing' AND j.id=? AND j.profile_id=profile.id AND j.target_kind='profile_asset' AND j.target_id=a.id AND j.target_revision=a.revision AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND o.owner_id=p.owner_id AND o.state IN ('admitted','ambiguous') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=profile.id))`,
        [
          b.id,
          actor.ownerId,
          b.reservationId,
          b.kind,
          `private/${b.id}`,
          b.keyVersion,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          pending.sourceBlobId,
          pending.assetRevision,
          lease.jobId,
          lease.token,
          lease.fencing,
          actor.now,
        ],
      )
      .first<{ principal_id: string }>();
    if (!row) return null;
    const captured: AssetUploadCleanupIntent = Object.freeze({
      ownerId: actor.ownerId,
      principalId: row.principal_id,
      blobId: b.id,
      reservationId: b.reservationId,
      objectKey: `private/${b.id}`,
      logicalBytes: b.logicalBytes,
      keyVersion: b.keyVersion,
      kind: b.kind,
      visibility: "staging",
      cipherHash: b.cipherHash,
      cipherBytes: b.cipherBytes,
    });
    capturedIntents.add(captured);
    return captured;
  });
}

// Called after a sent PUT settles, including an unknown transport outcome.
// The captured intent restores cleanup exposure, never an existence/deletion receipt.
// A fresh journal preserves previous deletion receipts without an extra R2 HEAD.
export function requeueAssetUploadCleanup(
  core: V2Core,
  actor: Actor,
  captured: AssetUploadCleanupIntent,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    if (!capturedIntents.has(captured) || actor.ownerId !== captured.ownerId) return null;
    const values = [
      captured.blobId,
      captured.principalId,
      captured.reservationId,
      captured.objectKey,
      captured.logicalBytes,
      captured.keyVersion,
      captured.kind,
      captured.visibility,
      captured.cipherHash,
      captured.cipherBytes,
      actor.ownerId,
      actor.ownerId,
    ];
    const guard = `b.id=? AND b.principal_id=? AND r.id=? AND b.object_key=? AND b.logical_bytes=? AND b.key_version IS ? AND b.kind=? AND b.visibility=? AND b.cipher_hash IS ? AND b.cipher_bytes=? AND b.state IN ('deleting','deleted') AND r.kind='lawyer_asset' AND r.byte_length=b.logical_bytes AND (p.owner_id=? OR (p.owner_id IS NULL AND EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?)))`;
    const source =
      "FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id";
    if (!(await core.statement(`SELECT b.id ${source} WHERE ${guard}`, values).first()))
      return null;
    const pending = await core
      .statement(
        `SELECT j.id FROM v2_deletion_journals j JOIN v2_deletion_targets t ON t.journal_id=j.id WHERE t.kind='blob' AND t.target_id=? AND t.state='pending' AND j.target_kind='blob' AND j.state!='completed' AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets other WHERE other.journal_id=j.id AND other.kind!='blob') AND NOT EXISTS(SELECT 1 FROM v2_cleanup_receipts WHERE journal_id=j.id AND kind='blob' AND target_id=?) ORDER BY j.created_at DESC,j.id LIMIT 1`,
        [captured.blobId, captured.blobId],
      )
      .first<{ id: string }>();
    if (pending) {
      const token = crypto.randomUUID();
      const claim = "EXISTS(SELECT 1 FROM v2_deletion_journals WHERE id=? AND lease_token=?)";
      const args = [pending.id, token];
      const updated = await core.binding.batch([
        core.statement(
          `UPDATE v2_deletion_journals SET state='pending',lease_token=?,lease_until=NULL,fencing=fencing+1,next_attempt_at=? WHERE id=? AND state!='completed' AND EXISTS(SELECT 1 ${source} WHERE ${guard}) AND EXISTS(SELECT 1 FROM v2_deletion_targets WHERE journal_id=v2_deletion_journals.id AND kind='blob' AND target_id=? AND state='pending') AND NOT EXISTS(SELECT 1 FROM v2_cleanup_receipts WHERE journal_id=v2_deletion_journals.id AND kind='blob' AND target_id=?)`,
          [token, actor.now, pending.id, ...values, captured.blobId, captured.blobId],
        ),
        core.statement(
          `UPDATE v2_storage_usage SET stored_bytes=stored_bytes+? WHERE principal_id=? AND EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=? AND state='released') AND ${claim}`,
          [captured.logicalBytes, captured.principalId, captured.reservationId, ...args],
        ),
        core.statement(
          `UPDATE v2_storage_reservations SET state='stored' WHERE id=? AND state='released' AND ${claim}`,
          [captured.reservationId, ...args],
        ),
        core.statement(
          `UPDATE v2_blobs SET state='deleting',deleted_at=NULL WHERE id=? AND ${claim}`,
          [captured.blobId, ...args],
        ),
        core.statement(
          `UPDATE v2_deletion_journals SET lease_token=NULL WHERE id=? AND lease_token=?`,
          args,
        ),
      ]);
      return updated[0]?.meta.changes === 1 ? pending.id : null;
    }
    const journalId = crypto.randomUUID(),
      generationId = crypto.randomUUID();
    const claim = `EXISTS(SELECT 1 FROM v2_deletion_journals WHERE id=? AND target_kind='blob' AND target_id=?)`;
    const args = [journalId, generationId];
    const result = await core.binding.batch([
      core.statement(
        `INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? ${source} WHERE ${guard} AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets t JOIN v2_deletion_journals j ON j.id=t.journal_id WHERE t.kind='blob' AND t.target_id=b.id AND t.state='pending' AND j.target_kind='blob' AND j.state!='completed' AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets other WHERE other.journal_id=j.id AND other.kind!='blob') AND NOT EXISTS(SELECT 1 FROM v2_cleanup_receipts WHERE journal_id=j.id AND kind='blob' AND target_id=b.id))`,
        [journalId, generationId, actor.now, actor.now, ...values],
      ),
      core.statement(
        `INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT ?,0,'blob',? WHERE ${claim}`,
        [journalId, captured.blobId, ...args],
      ),
      core.statement(
        `UPDATE v2_deletion_journals SET lease_token=NULL,lease_until=NULL,fencing=fencing+1 WHERE id!=? AND state!='completed' AND id IN (SELECT journal_id FROM v2_deletion_targets WHERE kind='blob' AND target_id=?) AND ${claim}`,
        [journalId, captured.blobId, ...args],
      ),
      core.statement(
        `UPDATE v2_storage_usage SET stored_bytes=stored_bytes+? WHERE principal_id=? AND EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=? AND state='released') AND ${claim}`,
        [captured.logicalBytes, captured.principalId, captured.reservationId, ...args],
      ),
      core.statement(
        `UPDATE v2_storage_reservations SET state='stored' WHERE id=? AND state='released' AND ${claim}`,
        [captured.reservationId, ...args],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='deleting',deleted_at=NULL WHERE id=? AND ${claim}`,
        [captured.blobId, ...args],
      ),
    ]);
    return result[0]?.meta.changes === 1 ? journalId : null;
  });
}

export function prepareAssetUpload(
  core: V2Core,
  actor: Actor,
  input: AssetUploadIntent,
  paid?: PreparedStoragePaidHold,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    for (const id of [input.assetId, input.blobId, input.reservationId]) parse(opaqueIdSchema, id);
    parse(revisionSchema, input.assetRevision);
    if (input.keyVersion !== "asset_binary_v1") return false;
    if (
      paid &&
      (!isPreparedStoragePaidHold(paid) ||
        paid.actor.ownerId !== actor.ownerId ||
        paid.actor.now !== actor.now ||
        paid.request.intent.kind !== "lawyer_original" ||
        paid.request.targetKind !== "profile_asset" ||
        paid.request.targetId !== input.assetId ||
        paid.request.targetRevision !== input.assetRevision ||
        paid.request.blobId !== input.blobId ||
        paid.request.reservationId !== input.reservationId ||
        paid.request.pending.cipherBytes !== 0 ||
        paid.request.pending.cipherHash !== null ||
        paid.request.pending.keyVersion !== input.keyVersion)
    )
      return false;
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
    if (paid && paid.request.pending.logicalBytes !== row.byte_length) return false;
    const envelope = await core.encrypt("v2_blobs", input.blobId, actor.ownerId, 1, {
      assetId: input.assetId,
      assetRevision: input.assetRevision,
      profileId: row.profile_id,
      assetPayload: row.encrypted_payload,
    });
    if (paid) {
      const claim = crypto.randomUUID();
      const anchor =
        "a.encrypted_payload=? AND a.purpose=? AND a.profile_id=? AND r.byte_length=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted')";
      const anchorValues = [
        row.encrypted_payload,
        row.purpose,
        row.profile_id,
        row.byte_length,
        input.blobId,
      ];
      return core.changed([
        core.statement(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision ${from} WHERE ${eligible} AND ${anchor} AND (${paid.predicate.sql})`,
          [claim, ...values, ...anchorValues, ...paid.predicate.values],
        ),
        core.statement(
          `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,?,'private','pending',?,r.byte_length,0,NULL,?,?,? ${from} WHERE ${eligible} AND ${anchor} AND ${sqlClaim}`,
          [
            input.blobId,
            kind(row.purpose),
            `private/${input.blobId}`,
            input.keyVersion,
            envelope,
            actor.now,
            ...values,
            ...anchorValues,
            claim,
          ],
        ),
        ...(await paid.statements(core, paid.actor, claim, envelope)),
        core.finish(claim),
      ]);
    }
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
