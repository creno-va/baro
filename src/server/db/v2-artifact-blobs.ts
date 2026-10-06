import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { type Actor, actorSchema, hashSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import { type BlobRegistration, blobSchema } from "./v2-storage";
import { type JobLease, leaseSchema } from "./v2-workspace";

const metadataSchema = z.strictObject({
  contentHash: hashSchema,
  jobId: opaqueIdSchema,
  fencing: revisionSchema,
  targetId: opaqueIdSchema,
  targetRevision: revisionSchema,
  operationId: opaqueIdSchema,
});
const from =
  "FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_files f ON f.id=j.target_id JOIN v2_storage_reservations r ON r.entity_id=f.id JOIN v2_billing_principals p ON p.id=r.principal_id";
function eligibility() {
  return `j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND j.target_kind='file' AND o.state IN ('admitted','ambiguous') AND ${jobAlive} AND f.state IN ('queued','processing') AND r.id=? AND r.target_id=? AND r.kind='derived_report' AND r.state='reserved' AND r.workspace_id=f.workspace_id AND r.operation_id=o.id AND p.owner_id=o.owner_id AND r.byte_length=? AND EXISTS(SELECT 1 FROM v2_consents c WHERE c.file_id=f.id AND c.owner_id=o.owner_id AND c.kind='auto_processing')`;
}
type Target = { target_id: string; target_revision: number; operation_id: string };
function input(actor: Actor, lease: JobLease, blob: BlobRegistration) {
  const a = parse(actorSchema, actor),
    b = parse(blobSchema, blob);
  parse(leaseSchema, lease);
  return {
    a,
    b,
    valid: b.kind === "derivative" && b.visibility === "private" && b.keyVersion !== null,
    values: [
      lease.jobId,
      a.ownerId,
      lease.token,
      lease.fencing,
      a.now,
      b.reservationId,
      b.id,
      b.logicalBytes,
    ],
  };
}
export function prepareArtifactBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blob: BlobRegistration,
) {
  return safe(async () => {
    const { a, b, valid, values } = input(actor, lease, blob);
    if (!valid) return false;
    const row = await core
      .statement(
        `SELECT j.target_id,j.target_revision,j.operation_id ${from} WHERE ${eligibility()}`,
        values,
      )
      .first<Target>();
    if (!row) return false;
    const payload = await core.encrypt("v2_blobs", b.id, a.ownerId, 1, {
      contentHash: b.contentHash,
      jobId: lease.jobId,
      fencing: lease.fencing,
      targetId: row.target_id,
      targetRevision: row.target_revision,
      operationId: row.operation_id,
    });
    return (
      (
        await core
          .statement(
            `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,'derivative','private','pending',?,?,?,?,?,?,? ${from} WHERE ${eligibility()} AND j.target_id=? AND j.target_revision=? AND j.operation_id=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted')`,
            [
              b.id,
              `private/${b.id}`,
              b.logicalBytes,
              b.cipherBytes,
              b.cipherHash,
              b.keyVersion,
              payload,
              a.now,
              ...values,
              row.target_id,
              row.target_revision,
              row.operation_id,
              b.id,
            ],
          )
          .run()
      ).meta.changes === 1
    );
  });
}
export function commitArtifactBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blob: BlobRegistration,
) {
  return safe(async () => {
    const { a, b, valid, values } = input(actor, lease, blob);
    if (!valid) return false;
    const row = await core
      .statement(
        `SELECT j.target_id,j.target_revision,j.operation_id ${from} WHERE ${eligibility()}`,
        values,
      )
      .first<Target>();
    if (!row) return false;
    const pending = await core
      .statement(
        "SELECT b.encrypted_payload,b.created_at FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.reservation_id=? AND b.state='pending' AND b.kind='derivative' AND b.visibility='private' AND b.object_key=? AND b.logical_bytes=? AND b.cipher_bytes=? AND b.cipher_hash=? AND b.key_version=?",
        [
          b.id,
          a.ownerId,
          b.reservationId,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
        ],
      )
      .first<{ encrypted_payload: string; created_at: string }>();
    if (!pending || Date.parse(pending.created_at) > Date.parse(a.now)) return false;
    const metadata = await core.decrypt(
      "v2_blobs",
      b.id,
      a.ownerId,
      1,
      pending.encrypted_payload,
      metadataSchema,
    );
    if (
      metadata.contentHash !== b.contentHash ||
      metadata.jobId !== lease.jobId ||
      metadata.fencing !== lease.fencing ||
      metadata.targetId !== row.target_id ||
      metadata.targetRevision !== row.target_revision ||
      metadata.operationId !== row.operation_id
    )
      return false;
    const payload = await core.encrypt("v2_blobs", b.id, a.ownerId, 1, {
      contentHash: b.contentHash,
    });
    const claimId = crypto.randomUUID();
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,f.id,f.revision ${from} WHERE ${eligibility()} AND j.target_id=? AND j.target_revision=? AND j.operation_id=? AND EXISTS(SELECT 1 FROM v2_blobs WHERE id=? AND principal_id=r.principal_id AND reservation_id=r.id AND state='pending' AND kind='derivative' AND visibility='private' AND object_key=? AND logical_bytes=? AND cipher_bytes=? AND cipher_hash=? AND key_version=? AND encrypted_payload=? AND created_at=?) AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted' AND id!=?)`,
        [
          claimId,
          ...values,
          row.target_id,
          row.target_revision,
          row.operation_id,
          b.id,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          pending.encrypted_payload,
          pending.created_at,
          b.id,
        ],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='stored',encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
        [payload, b.id, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}
// Recovery reads the originally prepared tuple. A newer lease can abandon it,
// but commit still requires the original fencing value and exact ciphertext.
export function findPendingArtifactBlob(
  core: V2Core,
  actor: Actor,
  lease: JobLease,
  blobId: string,
) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(leaseSchema, lease);
    parse(opaqueIdSchema, blobId);
    const sql = `SELECT b.id,b.reservation_id,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.key_version,b.encrypted_payload,b.created_at,j.target_id,j.target_revision,j.operation_id ${from} JOIN v2_blobs b ON b.reservation_id=r.id AND b.principal_id=p.id WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND j.target_kind='file' AND o.state IN ('admitted','ambiguous') AND ${jobAlive} AND f.state IN ('queued','processing') AND r.target_id=b.id AND r.kind='derived_report' AND r.state='reserved' AND r.workspace_id=f.workspace_id AND r.operation_id=o.id AND p.owner_id=o.owner_id AND r.byte_length=b.logical_bytes AND b.id=? AND b.state='pending' AND b.kind='derivative' AND b.visibility='private' AND b.object_key='private/'||b.id AND b.key_version IS NOT NULL AND b.cipher_hash IS NOT NULL AND b.created_at<=? AND EXISTS(SELECT 1 FROM v2_consents c WHERE c.file_id=f.id AND c.owner_id=o.owner_id AND c.kind='auto_processing')`;
    const values = [
      lease.jobId,
      actor.ownerId,
      lease.token,
      lease.fencing,
      actor.now,
      blobId,
      actor.now,
    ];
    type Pending = Target & {
      id: string;
      reservation_id: string;
      logical_bytes: number;
      cipher_bytes: number;
      cipher_hash: string;
      key_version: string;
      encrypted_payload: string;
      created_at: string;
    };
    const row = await core.statement(sql, values).first<Pending>();
    if (!row) return null;
    const metadata = await core.decrypt(
      "v2_blobs",
      blobId,
      actor.ownerId,
      1,
      row.encrypted_payload,
      metadataSchema,
    );
    if (
      metadata.jobId !== lease.jobId ||
      metadata.fencing > lease.fencing ||
      metadata.targetId !== row.target_id ||
      metadata.targetRevision !== row.target_revision ||
      metadata.operationId !== row.operation_id
    )
      return null;
    const b = parse(blobSchema, {
      id: row.id,
      reservationId: row.reservation_id,
      kind: "derivative",
      visibility: "private",
      logicalBytes: row.logical_bytes,
      cipherBytes: row.cipher_bytes,
      cipherHash: row.cipher_hash,
      contentHash: metadata.contentHash,
      keyVersion: row.key_version,
    });
    const current = await core.statement(sql, values).first<Pending>();
    return current && JSON.stringify(current) === JSON.stringify(row)
      ? { blob: b, preparedFencing: metadata.fencing }
      : null;
  });
}
export function abandonArtifactBlob(core: V2Core, actor: Actor, blobId: string) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const claimId = crypto.randomUUID(),
      journalId = crypto.randomUUID();
    return core.changed([
      core.statement(
        "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,b.id,1 FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND p.owner_id=? AND b.state='pending' AND b.kind='derivative' AND b.visibility='private' AND r.kind='derived_report' AND r.target_id=b.id",
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
