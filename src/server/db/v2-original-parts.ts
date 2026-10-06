import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
} from "./v2-core";
import { type BlobRegistration, blobSchema } from "./v2-storage";
import { isPreparedStoragePaidHold, type PreparedStoragePaidHold } from "./v2-storage-paid-runtime";

export interface OriginalPartRegistration {
  uploadId: string;
  uploadRevision: number;
  ordinal: number;
  blob: BlobRegistration;
}

const pendingMetadataSchema = z.strictObject({
  contentHash: hashSchema,
  uploadId: opaqueIdSchema,
  uploadRevision: z.number().int().positive(),
  ordinal: z.number().int().min(0).max(119),
});
function originalPartGuard(actor: Actor, input: OriginalPartRegistration, b: BlobRegistration) {
  const eligibility = `u.id=? AND u.revision=? AND u.state='open' AND u.encrypted_payload IS NULL AND u.expires_at>? AND w.owner_id=? AND ${aliveWorkspace} AND f.state IN ('reserved','uploading') AND r.id=? AND r.kind='case_original' AND r.state='reserved' AND r.entity_id=f.id AND r.target_id=f.id AND r.workspace_id=w.id AND r.operation_id=f.operation_id AND p.owner_id=w.owner_id AND o.owner_id=w.owner_id AND o.state='admitted' AND u.reserved_bytes=f.declared_bytes AND r.byte_length=u.reserved_bytes AND EXISTS(SELECT 1 FROM v2_consents c WHERE c.file_id=f.id AND c.owner_id=w.owner_id AND c.kind='auto_processing') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id) AND ?<ceil(u.reserved_bytes/8388608.0) AND ?=min(8388608,u.reserved_bytes-?*8388608) AND NOT EXISTS(SELECT 1 FROM v2_upload_parts WHERE upload_id=u.id AND ordinal=?) AND coalesce((SELECT sum(logical_bytes) FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted' AND id!=?),0)+?<=r.byte_length`;
  const values = [
    input.uploadId,
    input.uploadRevision,
    actor.now,
    actor.ownerId,
    b.reservationId,
    input.ordinal,
    b.logicalBytes,
    input.ordinal,
    input.ordinal,
    b.id,
    b.logicalBytes,
  ];
  const from =
    "FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_storage_reservations r ON r.entity_id=f.id JOIN v2_billing_principals p ON p.id=r.principal_id JOIN v2_operations o ON o.id=f.operation_id";
  return { eligibility, values, from };
}
function originalInput(actor: Actor, input: OriginalPartRegistration) {
  const a = parse(actorSchema, actor);
  parse(opaqueIdSchema, input.uploadId);
  parse(z.number().int().positive(), input.uploadRevision);
  parse(z.number().int().min(0).max(119), input.ordinal);
  const b = parse(blobSchema, input.blob);
  return {
    a,
    b,
    valid: b.kind === "original" && b.visibility === "private" && b.keyVersion === "binary_v1",
  };
}
// A pending row is a cleanup intent, never proof that R2 contains the object.
export function prepareOriginalPart(
  core: V2Core,
  actor: Actor,
  input: OriginalPartRegistration,
  paid?: PreparedStoragePaidHold,
) {
  return safe(async () => {
    const { a, b, valid } = originalInput(actor, input);
    if (!valid) return false;
    if (paid) {
      const r = paid.request;
      if (
        !isPreparedStoragePaidHold(paid) ||
        paid.actor.ownerId !== a.ownerId ||
        paid.actor.now !== a.now ||
        r.intent.kind !== "case_original" ||
        r.intent.uploadId !== input.uploadId ||
        r.intent.uploadRevision !== input.uploadRevision ||
        r.intent.ordinal !== input.ordinal ||
        r.blobId !== b.id ||
        r.reservationId !== b.reservationId ||
        r.targetKind !== "file" ||
        r.pending.logicalBytes !== b.logicalBytes ||
        r.pending.cipherBytes !== b.cipherBytes ||
        r.pending.cipherHash !== b.cipherHash ||
        r.pending.keyVersion !== b.keyVersion
      )
        return false;
    }
    const { eligibility, values, from } = originalPartGuard(a, input, b);
    if (!(await core.statement(`SELECT u.id ${from} WHERE ${eligibility}`, values).first()))
      return false;
    const metadata = await core.encrypt("v2_blobs", b.id, a.ownerId, 1, {
      contentHash: b.contentHash,
      uploadId: input.uploadId,
      uploadRevision: input.uploadRevision,
      ordinal: input.ordinal,
    });
    if (paid) {
      const claim = crypto.randomUUID();
      return core.changed([
        core.statement(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,w.owner_id,u.id,u.revision ${from} WHERE ${eligibility} AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) AND (${paid.predicate.sql})`,
          [claim, ...values, b.id, ...paid.predicate.values],
        ),
        core.statement(
          `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,'original','private','pending',?,?,?,?,?,?,? ${from} WHERE ${eligibility} AND ${sqlClaim}`,
          [
            b.id,
            `private/${b.id}`,
            b.logicalBytes,
            b.cipherBytes,
            b.cipherHash,
            b.keyVersion,
            metadata,
            a.now,
            ...values,
            claim,
          ],
        ),
        ...(await paid.statements(core, paid.actor, claim, metadata)),
        core.finish(claim),
      ]);
    }
    const result = await core
      .statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,'original','private','pending',?,?,?,?,?,?,? ${from} WHERE ${eligibility} AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?)`,
        [
          b.id,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          metadata,
          a.now,
          ...values,
          b.id,
        ],
      )
      .run();
    return result.meta.changes === 1;
  });
}
// Called after a definitive local upload failure; exposure stays reserved until
// actual R2 absence/deletion is verified by the existing cleanup receipt path.
export function abandonOriginalPart(core: V2Core, actor: Actor, blobId: string) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, blobId);
    const claimId = crypto.randomUUID(),
      journalId = crypto.randomUUID();
    return core.changed([
      core.statement(
        "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,b.id,1 FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND b.state='pending' AND b.kind='original' AND b.visibility='private'",
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

// Internal persistence boundary: blob describes an actual verified R2 put,
// never an anticipated object or a client-supplied successful receipt.
export function registerOriginalPart(core: V2Core, actor: Actor, input: OriginalPartRegistration) {
  return safe(async () => {
    actor = parse(actorSchema, actor);
    parse(opaqueIdSchema, input.uploadId);
    parse(z.number().int().positive(), input.uploadRevision);
    parse(z.number().int().min(0).max(119), input.ordinal);
    const b = parse(blobSchema, input.blob);
    if (b.kind !== "original" || b.visibility !== "private" || b.keyVersion !== "binary_v1")
      return false;
    const { eligibility, values, from } = originalPartGuard(actor, input, b);
    if (!(await core.statement(`SELECT u.id ${from} WHERE ${eligibility}`, values).first()))
      return false;
    const existing = await core
      .statement(
        "SELECT b.* FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=?",
        [b.id, actor.ownerId],
      )
      .first<{
        reservation_id: string;
        kind: string;
        visibility: string;
        state: string;
        object_key: string;
        logical_bytes: number;
        cipher_bytes: number;
        cipher_hash: string;
        key_version: string;
        encrypted_payload: string;
        created_at: string;
      }>();
    if (existing) {
      if (
        existing.reservation_id !== b.reservationId ||
        existing.kind !== b.kind ||
        existing.visibility !== b.visibility ||
        !["pending", "stored"].includes(existing.state) ||
        existing.object_key !== `private/${b.id}` ||
        existing.logical_bytes !== b.logicalBytes ||
        existing.cipher_bytes !== b.cipherBytes ||
        existing.cipher_hash !== b.cipherHash ||
        existing.key_version !== b.keyVersion
      )
        return false;
      const metadata = await core.decrypt(
        "v2_blobs",
        b.id,
        actor.ownerId,
        1,
        existing.encrypted_payload,
        existing.state === "pending"
          ? pendingMetadataSchema
          : z.strictObject({ contentHash: hashSchema }),
      );
      if (metadata.contentHash !== b.contentHash) return false;
      if (existing.state === "pending") {
        const intent = parse(pendingMetadataSchema, metadata);
        if (
          intent.uploadId !== input.uploadId ||
          intent.uploadRevision !== input.uploadRevision ||
          intent.ordinal !== input.ordinal ||
          Date.parse(existing.created_at) > Date.parse(actor.now) ||
          Date.parse(existing.created_at) + 300000 <= Date.parse(actor.now)
        )
          return false;
      }
    } else if (await core.statement("SELECT id FROM v2_blobs WHERE id=?", [b.id]).first())
      return false;
    const metadata = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
      contentHash: b.contentHash,
    });
    const payload = await core.encrypt(
      "v2_upload_parts",
      `${input.uploadId}-${input.ordinal}`,
      actor.ownerId,
      input.uploadRevision,
      {
        blobId: b.id,
        keyVersion: b.keyVersion,
        contentHash: b.contentHash,
        index: input.ordinal,
        byteLength: b.logicalBytes,
      },
    );
    const claimId = crypto.randomUUID();
    const anchor = existing
      ? "EXISTS(SELECT 1 FROM v2_blobs WHERE id=? AND reservation_id=r.id AND kind='original' AND visibility='private' AND state=? AND object_key=? AND logical_bytes=? AND cipher_bytes=? AND cipher_hash=? AND key_version=? AND encrypted_payload=? AND created_at=?)"
      : "NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?)";
    const anchorValues = existing
      ? [
          b.id,
          existing.state,
          existing.object_key,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          existing.encrypted_payload,
          existing.created_at,
        ]
      : [b.id];
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,w.owner_id,u.id,u.revision ${from} WHERE ${eligibility} AND ${anchor}`,
        [claimId, ...values, ...anchorValues],
      ),
      core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,'original','private','stored',?,?,?,?,?,?,? FROM v2_storage_reservations r WHERE r.id=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?) AND ${sqlClaim}`,
        [
          b.id,
          `private/${b.id}`,
          b.logicalBytes,
          b.cipherBytes,
          b.cipherHash,
          b.keyVersion,
          metadata,
          actor.now,
          b.reservationId,
          b.id,
          claimId,
        ],
      ),
      core.statement(
        `UPDATE v2_blobs SET state='stored',encrypted_payload=? WHERE id=? AND state='pending' AND ${sqlClaim}`,
        [metadata, b.id, claimId],
      ),
      core.statement(
        `INSERT INTO v2_upload_parts(upload_id,ordinal,blob_id,byte_length,cipher_hash,encrypted_payload) SELECT ?,?,id,?,?,? FROM v2_blobs WHERE id=? AND state='stored' AND ${sqlClaim}`,
        [input.uploadId, input.ordinal, b.logicalBytes, b.cipherHash, payload, b.id, claimId],
      ),
      core.statement(
        "UPDATE v2_mutation_claims SET verified=CASE WHEN EXISTS(SELECT 1 FROM v2_upload_parts WHERE upload_id=? AND ordinal=? AND blob_id=? AND byte_length=? AND cipher_hash=?) THEN 1 ELSE 0 END WHERE id=?",
        [input.uploadId, input.ordinal, b.id, b.logicalBytes, b.cipherHash, claimId],
      ),
      core.finish(claimId),
    ]);
  });
}
