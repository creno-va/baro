import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import {
  V2_LIMITS,
  type V2StorageReservation,
  v2StorageReservationSchema,
} from "../../contracts/v2";
import { createV2AccountingRepository } from "./v2-accounting";
import {
  abandonArtifactBlob,
  commitArtifactBlob,
  findPendingArtifactBlob,
  prepareArtifactBlob,
} from "./v2-artifact-blobs";
import {
  type AssetUploadCleanupIntent,
  type AssetUploadIntent,
  abandonAssetUpload,
  captureApprovedPublicCopyIntent,
  captureAssetUploadIntent,
  captureSanitizedAssetBlobIntent,
  commitAssetUpload,
  prepareAssetUpload,
  requeueAssetUploadCleanup,
} from "./v2-asset-uploads";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";
import { type CleanupLease, cleanupLeaseSchema } from "./v2-deletion";
import {
  abandonApprovedPublicCopy,
  commitPreparedPublicCopy,
  type PublicCopyIntent,
  prepareApprovedPublicCopy,
} from "./v2-public-copies";
import {
  abandonSanitizedAssetBlob,
  commitSanitizedAssetBlob,
  findPendingSanitizedAssetBlob,
  prepareSanitizedAssetBlob,
} from "./v2-sanitized-asset-blobs";
import type { PreparedStoragePaidHold } from "./v2-storage-paid-runtime";
import type { JobLease } from "./v2-workspace";

export function storagePredicate(
  ownerId: string,
  bytes: number,
  workspaceId?: string,
  original = false,
): { sql: string; values: unknown[] } {
  return {
    sql: `EXISTS(SELECT 1 FROM v2_billing_principals p JOIN v2_storage_usage s ON s.principal_id=p.id WHERE p.owner_id=? AND s.stored_bytes+s.reserved_bytes+?<=10000000000)${original ? " AND EXISTS(SELECT 1 FROM v2_case_original_usage c WHERE c.workspace_id=? AND c.stored_count+c.reserved_count<100 AND c.stored_bytes+c.reserved_bytes+?<=5000000000)" : ""}`,
    values: [ownerId, bytes, ...(original ? [workspaceId, bytes] : [])],
  };
}
export function storageReservationStatements(
  core: V2Core,
  actor: Actor,
  reservation: V2StorageReservation,
  operationId: string,
  claimId: string,
  artifactId?: string,
  entityId?: string,
): D1PreparedStatement[] {
  const r = parse(v2StorageReservationSchema, reservation);
  const targetId =
    r.kind === "case_original" ? r.fileId : r.kind === "lawyer_asset" ? r.assetId : r.operationId;
  return [
    core.statement(
      `INSERT INTO v2_storage_reservations(id,principal_id,operation_id,workspace_id,target_id,entity_id,kind,byte_length,created_at) SELECT ?,p.id,?,?,?,?,?,?,? FROM v2_billing_principals p WHERE p.owner_id=? AND ${sqlClaim}`,
      [
        r.id,
        operationId,
        r.kind === "lawyer_asset" ? null : r.caseId,
        artifactId ?? targetId,
        entityId ?? targetId,
        r.kind === "derived_or_report" ? "derived_report" : r.kind,
        r.byteLength,
        actor.now,
        actor.ownerId,
        claimId,
      ],
    ),
    core.statement(
      `UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes+? WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?) AND ${sqlClaim}`,
      [r.byteLength, actor.ownerId, claimId],
    ),
    ...(r.kind === "case_original"
      ? [
          core.statement(
            `UPDATE v2_case_original_usage SET reserved_count=reserved_count+1,reserved_bytes=reserved_bytes+? WHERE workspace_id=? AND ${sqlClaim}`,
            [r.byteLength, r.caseId, claimId],
          ),
        ]
      : []),
  ];
}
export const blobSchema = z.strictObject({
  id: opaqueIdSchema,
  reservationId: opaqueIdSchema,
  kind: z.enum([
    "original",
    "derivative",
    "report_pdf",
    "original_zip",
    "verification",
    "portfolio_original",
    "portfolio_sanitized",
    "profile_photo_original",
    "profile_photo_sanitized",
    "public_copy",
  ]),
  visibility: z.enum(["private", "staging", "public"]),
  logicalBytes: z.number().int().positive().max(V2_LIMITS.accountStorageBytes),
  cipherBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cipherHash: hashSchema,
  contentHash: hashSchema,
  keyVersion: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .nullable(),
});
export type BlobRegistration = z.infer<typeof blobSchema>;
const reservationAlive = `((r.kind='case_original' AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=r.entity_id AND f.workspace_id=r.workspace_id AND f.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id))) OR
 (r.kind='lawyer_asset' AND EXISTS(SELECT 1 FROM v2_assets a JOIN v2_profiles profile ON profile.id=a.profile_id WHERE a.id=r.entity_id AND a.owner_id=p.owner_id AND a.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=profile.id)))) OR
 (r.kind='derived_report' AND EXISTS(SELECT 1 FROM v2_operations o WHERE o.id=r.operation_id AND o.owner_id=p.owner_id AND o.state IN ('admitted','ambiguous','completed') AND (r.entity_id=o.id OR EXISTS(SELECT 1 FROM v2_files f WHERE f.id=r.entity_id AND f.workspace_id=r.workspace_id AND f.state!='deleting') OR EXISTS(SELECT 1 FROM v2_reports report WHERE report.id=r.entity_id AND report.workspace_id=r.workspace_id)) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind IN ('file','report') AND target_id=r.entity_id))))`;
export function createV2StorageRepository(core: V2Core) {
  const accounting = createV2AccountingRepository(core);
  return {
    captureSanitizedAssetBlobIntent(actor: Actor, lease: JobLease, blobId: string) {
      return captureSanitizedAssetBlobIntent(core, actor, lease, blobId);
    },
    requeueSanitizedAssetBlobCleanup(actor: Actor, captured: AssetUploadCleanupIntent) {
      return captured.visibility === "staging" &&
        ["profile_photo_sanitized", "portfolio_sanitized"].includes(captured.kind)
        ? requeueAssetUploadCleanup(core, actor, captured)
        : Promise.resolve(null);
    },
    prepareSanitizedAssetBlob(actor: Actor, lease: JobLease, blob: BlobRegistration) {
      return prepareSanitizedAssetBlob(core, actor, lease, blob);
    },
    commitSanitizedAssetBlob(actor: Actor, lease: JobLease, blob: BlobRegistration) {
      return commitSanitizedAssetBlob(core, actor, lease, blob);
    },
    abandonSanitizedAssetBlob(actor: Actor, blobId: string) {
      return abandonSanitizedAssetBlob(core, actor, blobId);
    },
    findPendingSanitizedAssetBlob(actor: Actor, lease: JobLease, blobId: string) {
      return findPendingSanitizedAssetBlob(core, actor, lease, blobId);
    },
    prepareApprovedPublicCopy(actor: Actor, input: PublicCopyIntent) {
      return prepareApprovedPublicCopy(core, actor, input);
    },
    abandonApprovedPublicCopy(actor: Actor, blobId: string) {
      return abandonApprovedPublicCopy(core, actor, blobId);
    },
    prepareAssetUpload(actor: Actor, input: AssetUploadIntent, paid?: PreparedStoragePaidHold) {
      return prepareAssetUpload(core, actor, input, paid);
    },
    commitAssetUpload(
      actor: Actor,
      input: { assetId: string; assetRevision: number; blob: BlobRegistration },
    ) {
      return commitAssetUpload(core, actor, input);
    },
    abandonAssetUpload(actor: Actor, blobId: string) {
      return abandonAssetUpload(core, actor, blobId);
    },
    captureAssetUploadIntent(actor: Actor, blobId: string) {
      return captureAssetUploadIntent(core, actor, blobId);
    },
    captureApprovedPublicCopyIntent(actor: Actor, blobId: string) {
      return captureApprovedPublicCopyIntent(core, actor, blobId);
    },
    requeueApprovedPublicCopyCleanup(actor: Actor, captured: AssetUploadCleanupIntent) {
      return captured.kind === "public_copy" && captured.visibility === "public"
        ? requeueAssetUploadCleanup(core, actor, captured)
        : Promise.resolve(null);
    },
    requeueAssetUploadCleanup(actor: Actor, captured: AssetUploadCleanupIntent) {
      return requeueAssetUploadCleanup(core, actor, captured);
    },
    reserveArtifact(
      g: WorkspaceGuard,
      input: {
        id: string;
        artifactId: string;
        target: { kind: "file" | "report"; id: string; revision: number };
        operationId: string;
        byteLength: number;
      },
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        for (const id of [input.id, input.artifactId, input.target.id, input.operationId])
          parse(opaqueIdSchema, id);
        parse(z.number().int().positive(), input.target.revision);
        parse(z.number().int().positive().max(10000000000), input.byteLength);
        if (!(await accounting.ensurePrincipal(g))) return false;
        const predicate = storagePredicate(g.ownerId, input.byteLength);
        const claimId = crypto.randomUUID();
        const targetSql =
          input.target.kind === "file"
            ? "EXISTS(SELECT 1 FROM v2_files WHERE id=? AND workspace_id=w.id AND revision=? AND operation_id=? AND state IN ('uploaded','queued','processing'))"
            : "EXISTS(SELECT 1 FROM v2_reports WHERE id=? AND workspace_id=w.id AND workspace_revision=? AND operation_id=? AND state IN ('queued','building'))";
        return core.changed([
          core.claim(
            g,
            claimId,
            `${predicate.sql} AND ${targetSql} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind=? AND target_id=?)`,
            [
              ...predicate.values,
              input.target.id,
              input.target.revision,
              input.operationId,
              input.target.kind,
              input.target.id,
            ],
          ),
          ...storageReservationStatements(
            core,
            g,
            {
              id: input.id,
              kind: "derived_or_report",
              caseId: g.workspaceId,
              operationId: input.operationId,
              byteLength: input.byteLength,
              state: "reserved",
            },
            input.operationId,
            claimId,
            input.artifactId,
            input.target.id,
          ),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    reserve(g: WorkspaceGuard, reservation: V2StorageReservation, operationId: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const r = parse(v2StorageReservationSchema, reservation);
        parse(opaqueIdSchema, operationId);
        if (r.state !== "reserved" || r.kind === "lawyer_asset" || r.caseId !== g.workspaceId)
          return false;
        if (!(await accounting.ensurePrincipal(g))) return false;
        const claimId = crypto.randomUUID();
        const predicate = storagePredicate(
          g.ownerId,
          r.byteLength,
          g.workspaceId,
          r.kind === "case_original",
        );
        return core.changed([
          core.claim(
            g,
            claimId,
            `${predicate.sql} AND EXISTS(SELECT 1 FROM v2_operations WHERE id=? AND owner_id=w.owner_id AND workspace_id=w.id)`,
            [...predicate.values, operationId],
          ),
          ...storageReservationStatements(core, g, r, operationId, claimId),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    prepareArtifactBlob(actor: Actor, lease: JobLease, blob: BlobRegistration) {
      return prepareArtifactBlob(core, actor, lease, blob);
    },
    commitArtifactBlob(actor: Actor, lease: JobLease, blob: BlobRegistration) {
      return commitArtifactBlob(core, actor, lease, blob);
    },
    abandonArtifactBlob(actor: Actor, blobId: string) {
      return abandonArtifactBlob(core, actor, blobId);
    },
    findPendingArtifactBlob(actor: Actor, lease: JobLease, blobId: string) {
      return findPendingArtifactBlob(core, actor, lease, blobId);
    },
    registerBlob(actor: Actor, input: BlobRegistration) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const b = parse(blobSchema, input);
        if (b.visibility === "public" || b.keyVersion === null) return false;
        const metadata = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
          contentHash: b.contentHash,
        });
        const result = await core
          .statement(
            `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,r.principal_id,r.id,?,?,'stored',?,?,?,?,?,?,? FROM v2_storage_reservations r JOIN v2_billing_principals p ON p.id=r.principal_id WHERE r.id=? AND p.owner_id=? AND r.state IN ('reserved','stored') AND ${reservationAlive} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=p.owner_id) AND (r.workspace_id IS NULL OR EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=r.workspace_id AND w.owner_id=p.owner_id AND ${aliveWorkspace})) AND coalesce((SELECT sum(logical_bytes) FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted'),0)+?<=r.byte_length`,
            [
              b.id,
              b.kind,
              b.visibility,
              `${b.visibility}/${b.id}`,
              b.logicalBytes,
              b.cipherBytes,
              b.cipherHash,
              b.keyVersion,
              metadata,
              actor.now,
              b.reservationId,
              actor.ownerId,
              b.logicalBytes,
            ],
          )
          .run();
        return result.meta.changes === 1;
      });
    },
    reserveAssetCopy(
      actor: Actor,
      input: {
        id: string;
        assetId: string;
        profileId: string;
        assetRevision: number;
        byteLength: number;
        artifactId: string;
      },
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        for (const id of [input.id, input.assetId, input.profileId, input.artifactId])
          parse(opaqueIdSchema, id);
        parse(z.number().int().positive(), input.assetRevision);
        parse(z.number().int().positive().max(100000000), input.byteLength);
        const source = await core
          .statement(
            "SELECT r.operation_id FROM v2_storage_reservations r JOIN v2_billing_principals p ON p.id=r.principal_id WHERE r.entity_id=? AND r.kind='lawyer_asset' AND p.owner_id=? ORDER BY r.created_at LIMIT 1",
            [input.assetId, actor.ownerId],
          )
          .first<{ operation_id: string }>();
        if (!source) return false;
        const claimId = crypto.randomUUID();
        const predicate = storagePredicate(actor.ownerId, input.byteLength);
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,a.owner_id,a.id,a.revision FROM v2_assets a JOIN v2_profiles p ON p.id=a.profile_id WHERE a.id=? AND a.owner_id=? AND a.profile_id=? AND a.revision=? AND a.state!='deleting' AND ${predicate.sql} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=p.id))`,
            [
              claimId,
              input.assetId,
              actor.ownerId,
              input.profileId,
              input.assetRevision,
              ...predicate.values,
            ],
          ),
          ...storageReservationStatements(
            core,
            actor,
            {
              id: input.id,
              kind: "lawyer_asset",
              profileId: input.profileId,
              assetId: input.assetId,
              byteLength: input.byteLength,
              state: "reserved",
            },
            source.operation_id,
            claimId,
            input.artifactId,
          ),
          core.finish(claimId),
        ]);
      });
    },
    registerApprovedPublicCopy(
      actor: Actor,
      input: BlobRegistration,
      provenance: {
        assetId: string;
        assetRevision: number;
        approvedRevisionId: string;
        sourceBlobId: string;
      },
    ) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        const b = parse(blobSchema, input);
        for (const id of [
          provenance.assetId,
          provenance.approvedRevisionId,
          provenance.sourceBlobId,
        ])
          parse(opaqueIdSchema, id);
        parse(z.number().int().positive(), provenance.assetRevision);
        if (b.kind !== "public_copy" || b.visibility !== "public") return false;
        const existing = await core
          .statement("SELECT state FROM v2_blobs WHERE id=?", [b.id])
          .first<{ state: string }>();
        if (existing)
          return existing.state === "pending"
            ? commitPreparedPublicCopy(core, actor, b, provenance)
            : false;
        const source = await core
          .statement(
            "SELECT b.encrypted_payload,b.logical_bytes FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_assets a ON a.id=r.entity_id WHERE b.id=? AND p.owner_id=? AND a.id=? AND a.revision=? AND a.sanitized_blob_id=b.id AND b.visibility='staging' AND b.state='stored'",
            [provenance.sourceBlobId, actor.ownerId, provenance.assetId, provenance.assetRevision],
          )
          .first<{ encrypted_payload: string; logical_bytes: number }>();
        if (!source || source.logical_bytes !== b.logicalBytes) return false;
        const sourceHash = await core.decrypt(
          "v2_blobs",
          provenance.sourceBlobId,
          actor.ownerId,
          1,
          source.encrypted_payload,
          z.strictObject({ contentHash: hashSchema }),
        );
        if (sourceHash.contentHash !== b.contentHash) return false;
        const metadata = await core.encrypt("v2_blobs", b.id, actor.ownerId, 1, {
          contentHash: b.contentHash,
        });
        return (
          (
            await core
              .statement(
                `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at,source_blob_id,source_asset_revision,approved_revision_id) SELECT ?,reservation.principal_id,reservation.id,'public_copy','public','stored',?,?,?,?,?,?,?,a.sanitized_blob_id,a.revision,revision.id FROM v2_storage_reservations reservation JOIN v2_billing_principals principal ON principal.id=reservation.principal_id JOIN v2_assets a ON a.id=reservation.entity_id JOIN v2_profiles p ON p.id=a.profile_id JOIN v2_profile_revision_assets ra ON ra.asset_id=a.id AND ra.asset_revision=a.revision JOIN v2_profile_revisions revision ON revision.id=ra.revision_id JOIN v2_blobs source ON source.id=a.sanitized_blob_id WHERE reservation.id=? AND reservation.kind='lawyer_asset' AND reservation.state='reserved' AND principal.owner_id=? AND a.owner_id=principal.owner_id AND a.id=? AND a.revision=? AND a.state='ready' AND revision.id=? AND revision.status='approved' AND source.id=? AND source.state='stored' AND source.visibility='staging' AND source.encrypted_payload=? AND source.logical_bytes=? AND reservation.byte_length=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=reservation.id AND state!='deleted') AND EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=a.owner_id AND role='verified_lawyer') AND EXISTS(SELECT 1 FROM v2_applications WHERE id=revision.application_id AND owner_id=a.owner_id AND status='approved') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='profile' AND target_id=p.id) OR (target_kind='asset' AND target_id=a.id))`,
                [
                  b.id,
                  `public/${b.id}`,
                  b.logicalBytes,
                  b.cipherBytes,
                  b.cipherHash,
                  b.keyVersion,
                  metadata,
                  actor.now,
                  b.reservationId,
                  actor.ownerId,
                  provenance.assetId,
                  provenance.assetRevision,
                  provenance.approvedRevisionId,
                  provenance.sourceBlobId,
                  source.encrypted_payload,
                  b.logicalBytes,
                  b.logicalBytes,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    commitReservation(actor: Actor, reservationId: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, reservationId);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,p.owner_id,r.id,1 FROM v2_storage_reservations r JOIN v2_billing_principals p ON p.id=r.principal_id WHERE r.id=? AND p.owner_id=? AND r.state='reserved' AND ${reservationAlive} AND (SELECT sum(logical_bytes) FROM v2_blobs WHERE reservation_id=r.id AND state='stored')=r.byte_length AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=p.owner_id) AND (r.workspace_id IS NULL OR EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=r.workspace_id AND w.owner_id=p.owner_id AND ${aliveWorkspace}))`,
            [claimId, reservationId, actor.ownerId],
          ),
          core.statement(
            `UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes-(SELECT byte_length FROM v2_storage_reservations WHERE id=?),stored_bytes=stored_bytes+(SELECT byte_length FROM v2_storage_reservations WHERE id=?) WHERE principal_id=(SELECT principal_id FROM v2_storage_reservations WHERE id=?) AND ${sqlClaim}`,
            [reservationId, reservationId, reservationId, claimId],
          ),
          core.statement(
            `UPDATE v2_case_original_usage SET reserved_count=reserved_count-1,stored_count=stored_count+1,reserved_bytes=reserved_bytes-(SELECT byte_length FROM v2_storage_reservations WHERE id=?),stored_bytes=stored_bytes+(SELECT byte_length FROM v2_storage_reservations WHERE id=?) WHERE workspace_id=(SELECT workspace_id FROM v2_storage_reservations WHERE id=? AND kind='case_original') AND ${sqlClaim}`,
            [reservationId, reservationId, reservationId, claimId],
          ),
          core.statement(
            `UPDATE v2_storage_reservations SET state='stored' WHERE id=? AND ${sqlClaim}`,
            [reservationId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    findBlob(actor: Actor, blobId: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, blobId);
        return core
          .statement(
            `SELECT b.id,b.object_key,b.kind,b.visibility,b.logical_bytes,b.cipher_bytes,b.cipher_hash,b.key_version FROM v2_blobs b JOIN v2_billing_principals p ON p.id=b.principal_id JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE b.id=? AND p.owner_id=? AND b.state='stored' AND ${reservationAlive} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=p.owner_id) AND (r.workspace_id IS NULL OR EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=r.workspace_id AND w.owner_id=p.owner_id AND ${aliveWorkspace}))`,
            [blobId, actor.ownerId],
          )
          .first<{
            id: string;
            object_key: string;
            kind: string;
            visibility: string;
            logical_bytes: number;
            cipher_bytes: number;
            cipher_hash: string;
            key_version: string | null;
          }>();
      });
    },
    caseUsage(actor: Actor, workspaceId: string) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, workspaceId);
        const row = await core
          .statement(
            `SELECT c.* FROM v2_case_original_usage c JOIN v2_workspaces w ON w.id=c.workspace_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
            [workspaceId, actor.ownerId],
          )
          .first<{
            stored_count: number;
            reserved_count: number;
            stored_bytes: number;
            reserved_bytes: number;
          }>();
        if (!row) return null;
        return {
          count: {
            limit: 100 as const,
            used: row.stored_count,
            reserved: row.reserved_count,
            remaining: Math.max(0, 100 - row.stored_count - row.reserved_count),
          },
          originalBytes: {
            limit: 5000000000 as const,
            used: row.stored_bytes,
            reserved: row.reserved_bytes,
            remaining: Math.max(0, 5000000000 - row.stored_bytes - row.reserved_bytes),
          },
        };
      });
    },
    recordLateBlobForCleanup(input: BlobRegistration, now: string) {
      return safe(async () => {
        const b = parse(blobSchema, input);
        const time = parse(actorSchema, { ownerId: "cleanup", now }).now;
        const source = await core
          .statement("SELECT principal_id,entity_id FROM v2_storage_reservations WHERE id=?", [
            b.reservationId,
          ])
          .first<{ principal_id: string; entity_id: string }>();
        if (!source) return false;
        const reservationId = crypto.randomUUID();
        const journalId = crypto.randomUUID();
        const results = await core.binding.batch([
          core.statement(
            "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) SELECT ?,?,?,?,?,'derived_report',?,'stored',? WHERE NOT EXISTS(SELECT 1 FROM v2_blobs WHERE id=?)",
            [
              reservationId,
              source.principal_id,
              "orphan",
              b.id,
              source.entity_id,
              b.logicalBytes,
              time,
              b.id,
            ],
          ),
          core.statement(
            "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,?,?,?,?,'deleting',?,?,?,?,?,'removed',? WHERE EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=?)",
            [
              b.id,
              source.principal_id,
              reservationId,
              b.kind,
              b.visibility,
              `${b.visibility}/${b.id}`,
              b.logicalBytes,
              b.cipherBytes,
              b.cipherHash,
              b.keyVersion,
              time,
              reservationId,
            ],
          ),
          core.statement(
            "UPDATE v2_storage_usage SET stored_bytes=stored_bytes+? WHERE principal_id=? AND EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=?)",
            [b.logicalBytes, source.principal_id, reservationId],
          ),
          core.statement(
            "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) SELECT ?,'blob',?,?,? WHERE EXISTS(SELECT 1 FROM v2_storage_reservations WHERE id=?)",
            [journalId, b.id, time, time, reservationId],
          ),
          core.statement(
            "INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) SELECT ?,0,'blob',? WHERE EXISTS(SELECT 1 FROM v2_deletion_journals WHERE id=?)",
            [journalId, b.id, journalId],
          ),
        ]);
        return results[0]?.meta.changes === 1;
      });
    },
    // Internal adapter only: the caller has already verified actual object deletion.
    confirmBlobDeleted(
      blobId: string,
      now: string,
      confirmation?: {
        lease: CleanupLease;
        receiptId: string;
        objectKey: string;
        cipherHash: string | null;
      },
    ) {
      return safe(async () => {
        parse(opaqueIdSchema, blobId);
        const actor = parse(actorSchema, { ownerId: "cleanup", now });
        if (!confirmation) return false;
        const { lease } = confirmation;
        const receiptClaim = crypto.randomUUID();
        parse(cleanupLeaseSchema, lease);
        parse(opaqueIdSchema, confirmation.receiptId);
        parse(hashSchema.nullable(), confirmation.cipherHash);
        const row = await core
          .statement(
            "SELECT reservation_id FROM v2_blobs WHERE id=? AND state='deleting' AND object_key=? AND cipher_hash IS ? AND (cipher_hash IS NOT NULL OR (cipher_bytes=0 AND ((visibility='private' AND kind IN ('verification','profile_photo_original','portfolio_original')) OR (visibility='public' AND kind='public_copy' AND key_version IS NULL AND source_blob_id IS NOT NULL AND approved_revision_id IS NOT NULL))))",
            [blobId, confirmation.objectKey, confirmation.cipherHash],
          )
          .first<{ reservation_id: string }>();
        if (!row) return false;
        const receiptGuard =
          "EXISTS(SELECT 1 FROM v2_cleanup_receipts r JOIN v2_deletion_journals j ON j.id=r.journal_id WHERE r.id=? AND r.journal_id=? AND r.kind='blob' AND r.target_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running')";
        const args = [
          confirmation.receiptId,
          lease.journalId,
          blobId,
          receiptClaim,
          lease.fencing,
          actor.now,
        ];
        // Removing a failed pending chunk does not cancel its live file upload.
        // Preserve the original reservation until that file is actually deleted.
        const releasable = `NOT EXISTS(SELECT 1 FROM v2_storage_reservations original LEFT JOIN v2_files f ON f.id=original.entity_id LEFT JOIN v2_workspaces w ON w.id=f.workspace_id LEFT JOIN v2_assets a ON a.id=original.entity_id LEFT JOIN v2_profiles profile ON profile.id=a.profile_id WHERE original.id=? AND ((original.kind='case_original' AND f.state!='deleting' AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)) OR (original.kind='lawyer_asset' AND original.target_id=a.id AND a.state!='deleting' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=a.owner_id) OR (target_kind='asset' AND target_id=a.id) OR (target_kind='profile' AND target_id=profile.id)))))`;
        const results = await core.binding.batch([
          // Temporary lease-token CAS is confined to this atomic batch. It gates
          // every write on a newly admitted receipt, including deleted accounts
          // that cannot own an ephemeral user-FK mutation claim anymore.
          core.statement(
            "UPDATE v2_deletion_journals SET lease_token=? WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND state='running' AND EXISTS(SELECT 1 FROM v2_deletion_targets t JOIN v2_blobs b ON b.id=t.target_id WHERE t.journal_id=v2_deletion_journals.id AND t.kind='blob' AND t.state='pending' AND b.id=? AND b.state='deleting' AND b.object_key=? AND b.cipher_hash IS ? AND (b.cipher_hash IS NOT NULL OR (b.cipher_bytes=0 AND ((b.visibility='private' AND b.kind IN ('verification','profile_photo_original','portfolio_original')) OR (b.visibility='public' AND b.kind='public_copy' AND b.key_version IS NULL AND b.source_blob_id IS NOT NULL AND b.approved_revision_id IS NOT NULL))))) AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets WHERE journal_id=v2_deletion_journals.id AND kind IN ('job','legacy_workflow') AND state='pending') AND NOT EXISTS(SELECT 1 FROM v2_cleanup_receipts WHERE id=? OR (journal_id=v2_deletion_journals.id AND kind='blob' AND target_id=?))",
            [
              receiptClaim,
              lease.journalId,
              lease.token,
              lease.fencing,
              actor.now,
              blobId,
              confirmation.objectKey,
              confirmation.cipherHash,
              confirmation.receiptId,
              blobId,
            ],
          ),
          core.statement(
            "INSERT INTO v2_cleanup_receipts(id,journal_id,kind,target_id,confirmed_at) SELECT ?,j.id,'blob',b.id,? FROM v2_deletion_journals j JOIN v2_deletion_targets t ON t.journal_id=j.id JOIN v2_blobs b ON b.id=t.target_id WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running' AND t.kind='blob' AND t.state='pending' AND b.id=? AND b.state='deleting' AND b.object_key=? AND b.cipher_hash IS ? AND (b.cipher_hash IS NOT NULL OR (b.cipher_bytes=0 AND ((b.visibility='private' AND b.kind IN ('verification','profile_photo_original','portfolio_original')) OR (b.visibility='public' AND b.kind='public_copy' AND b.key_version IS NULL AND b.source_blob_id IS NOT NULL AND b.approved_revision_id IS NOT NULL)))) AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets WHERE journal_id=j.id AND kind IN ('job','legacy_workflow') AND state='pending') ON CONFLICT(journal_id,kind,target_id) DO NOTHING",
            [
              confirmation.receiptId,
              actor.now,
              lease.journalId,
              receiptClaim,
              lease.fencing,
              actor.now,
              blobId,
              confirmation.objectKey,
              confirmation.cipherHash,
            ],
          ),
          core.statement(
            `UPDATE v2_blobs SET state='deleted',deleted_at=? WHERE id=? AND state='deleting' AND ${receiptGuard}`,
            [actor.now, blobId, ...args],
          ),
          core.statement(
            `UPDATE v2_storage_usage SET stored_bytes=stored_bytes-coalesce((SELECT byte_length FROM v2_storage_reservations WHERE id=? AND state='stored'),0),reserved_bytes=reserved_bytes-coalesce((SELECT byte_length FROM v2_storage_reservations WHERE id=? AND state='reserved'),0) WHERE principal_id=(SELECT principal_id FROM v2_storage_reservations WHERE id=? AND state!='released') AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=? AND state!='deleted') AND ${releasable} AND ${receiptGuard}`,
            [
              row.reservation_id,
              row.reservation_id,
              row.reservation_id,
              row.reservation_id,
              row.reservation_id,
              ...args,
            ],
          ),
          core.statement(
            `UPDATE v2_case_original_usage SET stored_count=stored_count-CASE WHEN r.state='stored' THEN 1 ELSE 0 END,reserved_count=reserved_count-CASE WHEN r.state='reserved' THEN 1 ELSE 0 END,stored_bytes=stored_bytes-CASE WHEN r.state='stored' THEN r.byte_length ELSE 0 END,reserved_bytes=reserved_bytes-CASE WHEN r.state='reserved' THEN r.byte_length ELSE 0 END FROM v2_storage_reservations r WHERE r.id=? AND r.workspace_id=v2_case_original_usage.workspace_id AND r.kind='case_original' AND r.state!='released' AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted') AND ${releasable} AND ${receiptGuard}`,
            [row.reservation_id, row.reservation_id, ...args],
          ),
          core.statement(
            `UPDATE v2_storage_reservations SET state='released' WHERE id=? AND state!='released' AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=? AND state!='deleted') AND ${releasable} AND ${receiptGuard}`,
            [row.reservation_id, row.reservation_id, row.reservation_id, ...args],
          ),
          core.statement(
            `UPDATE v2_deletion_targets SET state='completed' WHERE journal_id=? AND kind='blob' AND target_id=? AND ${receiptGuard}`,
            [lease.journalId, blobId, ...args],
          ),
          core.statement(
            "UPDATE v2_deletion_journals SET lease_token=? WHERE id=? AND lease_token=? AND fencing=?",
            [lease.token, lease.journalId, receiptClaim, lease.fencing],
          ),
        ]);
        return results[0]?.meta.changes === 1;
      });
    },
    // Inventory verification happens after every admitted workflow has stopped.
    confirmEmptyReservation(
      lease: CleanupLease,
      input: { receiptId: string; reservationId: string; now: string; inventoryVerified: true },
    ) {
      return safe(async () => {
        parse(cleanupLeaseSchema, lease);
        parse(opaqueIdSchema, input.receiptId);
        parse(opaqueIdSchema, input.reservationId);
        parse(z.literal(true), input.inventoryVerified);
        const now = parse(actorSchema, { ownerId: "cleanup", now: input.now }).now;
        const receiptGuard =
          "EXISTS(SELECT 1 FROM v2_cleanup_receipts r JOIN v2_deletion_journals j ON j.id=r.journal_id WHERE r.id=? AND r.journal_id=? AND r.kind='reservation' AND r.target_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running')";
        const args = [
          input.receiptId,
          lease.journalId,
          input.reservationId,
          lease.token,
          lease.fencing,
          now,
        ];
        const results = await core.binding.batch([
          core.statement(
            "INSERT INTO v2_cleanup_receipts(id,journal_id,kind,target_id,confirmed_at) SELECT ?,j.id,'reservation',r.id,? FROM v2_deletion_journals j JOIN v2_deletion_targets t ON t.journal_id=j.id JOIN v2_storage_reservations r ON r.id=t.target_id WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.state='running' AND t.kind='reservation' AND t.state='pending' AND r.id=? AND NOT EXISTS(SELECT 1 FROM v2_blobs WHERE reservation_id=r.id AND state!='deleted') AND NOT EXISTS(SELECT 1 FROM v2_deletion_targets WHERE journal_id=j.id AND kind IN ('job','legacy_workflow','blob') AND state='pending') ON CONFLICT(journal_id,kind,target_id) DO NOTHING",
            [
              input.receiptId,
              now,
              lease.journalId,
              lease.token,
              lease.fencing,
              now,
              input.reservationId,
            ],
          ),
          core.statement(
            `UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes-coalesce((SELECT byte_length FROM v2_storage_reservations WHERE id=? AND state='reserved'),0),stored_bytes=stored_bytes-coalesce((SELECT byte_length FROM v2_storage_reservations WHERE id=? AND state='stored'),0) WHERE principal_id=(SELECT principal_id FROM v2_storage_reservations WHERE id=? AND state!='released') AND ${receiptGuard}`,
            [input.reservationId, input.reservationId, input.reservationId, ...args],
          ),
          core.statement(
            `UPDATE v2_case_original_usage SET stored_count=stored_count-CASE WHEN r.state='stored' THEN 1 ELSE 0 END,reserved_count=reserved_count-CASE WHEN r.state='reserved' THEN 1 ELSE 0 END,stored_bytes=stored_bytes-CASE WHEN r.state='stored' THEN r.byte_length ELSE 0 END,reserved_bytes=reserved_bytes-CASE WHEN r.state='reserved' THEN r.byte_length ELSE 0 END FROM v2_storage_reservations r WHERE r.id=? AND r.workspace_id=v2_case_original_usage.workspace_id AND r.kind='case_original' AND r.state!='released' AND ${receiptGuard}`,
            [input.reservationId, ...args],
          ),
          core.statement(
            `UPDATE v2_storage_reservations SET state='released' WHERE id=? AND ${receiptGuard}`,
            [input.reservationId, ...args],
          ),
          core.statement(
            `UPDATE v2_deletion_targets SET state='completed' WHERE journal_id=? AND kind='reservation' AND target_id=? AND ${receiptGuard}`,
            [lease.journalId, input.reservationId, ...args],
          ),
        ]);
        return results[0]?.meta.changes === 1;
      });
    },
  };
}
